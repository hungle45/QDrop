/**
 * Sender — manages file transfer state and produces frames.
 */

import { type Manifest, type EncodedFrame } from '@/protocol'
import { createManifestFrame, createDataFrame } from '@/protocol'
import { sha256 } from '@/protocol'
import { chunkFile, type Chunk } from './chunker'

export type SenderState =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'transmitting'
  | 'paused'
  | 'stopped'

export interface SenderTransfer {
  state: SenderState
  file: File | null
  manifest: Manifest | null
  frames: EncodedFrame[]
  currentFrameIndex: number
  totalFrames: number
  cyclesCompleted: number
  error: string | null
}

export function createSenderState(): SenderTransfer {
  return {
    state: 'idle',
    file: null,
    manifest: null,
    frames: [],
    currentFrameIndex: 0,
    totalFrames: 0,
    cyclesCompleted: 0,
    error: null,
  }
}

/**
 * Prepare a file for transfer. Generates all frames including manifest.
 */
export async function prepareTransfer(file: File): Promise<{
  manifest: Manifest
  frames: EncodedFrame[]
}> {
  const chunks = await chunkFile(file)

  const transferId = crypto.getRandomValues(new Uint8Array(16))

  // Compute file hash
  const fileHash = await sha256(file)

  const manifest: Manifest = {
    transferId,
    filename: file.name,
    fileSize: file.size,
    totalFrames: chunks.length,
    fileHash,
    protocolVersion: 1,
  }

  // Create manifest frame (frame 0)
  const manifestFrame = createManifestFrame(manifest)

  // Create data frames (frame 1..N)
  const dataFrames = chunks.map((chunk: Chunk) =>
    createDataFrame(transferId, chunk.index, chunks.length, chunk.data),
  )

  const frames = [manifestFrame, ...dataFrames]

  return { manifest, frames }
}

/**
 * Generate frames for one display cycle.
 * Returns frames starting from currentIndex, wrapping around if needed.
 */
export function getDisplayFrames(
  frames: EncodedFrame[],
  currentIndex: number,
  count: number,
): { frames: EncodedFrame[]; nextIndex: number; wrapped: boolean } {
  if (frames.length === 0) return { frames: [], nextIndex: 0, wrapped: false }

  const result: EncodedFrame[] = []
  let idx = currentIndex
  let wrapped = false

  for (let i = 0; i < count; i++) {
    if (idx >= frames.length) {
      idx = 0
      wrapped = true
    }
    result.push(frames[idx])
    idx++
  }

  return { frames: result, nextIndex: idx, wrapped }
}