/**
 * Receiver — manages receiving state and frame collection.
 */

import { type Manifest, type DataFrame } from '@/protocol'

export type ReceiverState =
  | 'idle'
  | 'camera_permission'
  | 'scanning'
  | 'receiving'
  | 'reconstructing'
  | 'verifying'
  | 'complete'
  | 'failed'

export interface ReceiverTransfer {
  state: ReceiverState
  manifest: Manifest | null
  receivedFrames: Map<number, Uint8Array>
  totalFrames: number
  duplicateCount: number
  invalidCount: number
  error: string | null
  /** The final reconstructed blob, available when state is 'complete' */
  blob: Blob | null
}

export function createReceiverState(): ReceiverTransfer {
  return {
    state: 'idle',
    manifest: null,
    receivedFrames: new Map(),
    totalFrames: 0,
    duplicateCount: 0,
    invalidCount: 0,
    error: null,
    blob: null,
  }
}

export function addFrame(
  state: ReceiverTransfer,
  frame: DataFrame,
): { added: boolean; isComplete: boolean } {
  if (frame.header.frameType === 0) {
    // Manifest frame — already handled separately
    return { added: false, isComplete: false }
  }

  if (state.receivedFrames.has(frame.header.frameNumber)) {
    state.duplicateCount++
    return { added: false, isComplete: false }
  }

  state.receivedFrames.set(frame.header.frameNumber, frame.payload)
  const isComplete = state.receivedFrames.size >= state.totalFrames
  return { added: true, isComplete }
}

/**
 * Reconstruct the file from received frames.
 */
export function reconstructFile(state: ReceiverTransfer): Blob | null {
  if (!state.manifest) return null
  if (state.receivedFrames.size !== state.totalFrames) return null

  const parts: Uint8Array[] = []

  for (let i = 1; i <= state.totalFrames; i++) {
    const chunk = state.receivedFrames.get(i)
    if (!chunk) return null
    parts.push(chunk)
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }

  return new Blob([combined], { type: 'application/octet-stream' })
}