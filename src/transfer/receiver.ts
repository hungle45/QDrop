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

export interface FrameLogEntry {
  /** Frame number (0 = manifest) */
  frameNumber: number
  /** Type of event */
  type: 'manifest' | 'new' | 'duplicate' | 'invalid'
  /** Timestamp */
  time: number
}

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
  /** Recent scan events for the log display */
  frameLog: FrameLogEntry[]
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
    frameLog: [],
  }
}

const MAX_LOG_ENTRIES = 100

export function addToLog(log: FrameLogEntry[], entry: FrameLogEntry): FrameLogEntry[] {
  return [...log.slice(-(MAX_LOG_ENTRIES - 1)), entry]
}

/**
 * Check whether a frame is a duplicate.
 * Pure — does not mutate state.
 */
export function isDuplicateFrame(
  receivedFrames: Map<number, Uint8Array>,
  frame: DataFrame,
): boolean {
  if (frame.header.frameType === 0) return false // manifest
  return receivedFrames.has(frame.header.frameNumber)
}

/**
 * Check whether the transfer is complete.
 */
export function isTransferComplete(
  receivedFrames: Map<number, Uint8Array>,
  totalFrames: number,
): boolean {
  return receivedFrames.size >= totalFrames
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