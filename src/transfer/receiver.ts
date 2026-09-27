/**
 * Receiver — manages receiving state and frame collection.
 * Supports both single-file (Phase 1) and folder (Phase 2) transfers.
 */

import { type Manifest, type FolderManifest, type DataFrame } from '@/protocol'

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
  /** Frame number (0 = manifest, -1 = invalid) */
  frameNumber: number
  /** Type of event */
  type: 'manifest' | 'manifest-fragment' | 'new' | 'duplicate' | 'invalid'
  /** Human-readable description */
  message: string
  /** Timestamp */
  time: number
}

/** Per-file tracking during folder reception. */
export interface FileProgress {
  fileId: number
  path: string
  size: number
  frameCount: number
  sha256: Uint8Array
  /** Set of received frame numbers for this file. */
  receivedFrames: Set<number>
  /** Whether the file has been fully received and verified. */
  verified: boolean
  /** Error state if verification failed. */
  error?: string
}

export interface ReceiverTransfer {
  state: ReceiverState
  manifest: Manifest | null
  folderManifest: FolderManifest | null
  receivedFrames: Map<number, Uint8Array>
  /** For folder transfers: per-file frame tracking */
  fileProgress: Map<number, FileProgress>
  /** For folder transfers: collected file payloads (by fileId) */
  fileData: Map<number, Map<number, Uint8Array>>
  totalFrames: number
  duplicateCount: number
  invalidCount: number
  error: string | null
  /** The final reconstructed blob (single file), available when state is 'complete' */
  blob: Blob | null
  /** For folder transfers: map of output files */
  outputFiles: Map<string, Blob>
  /** Recent scan events for the log display */
  frameLog: FrameLogEntry[]
  /** Manifest fragment tracking */
  manifestFragments: Map<number, Uint8Array>
  manifestTotalFragments: number
}

export function createReceiverState(): ReceiverTransfer {
  return {
    state: 'idle',
    manifest: null,
    folderManifest: null,
    receivedFrames: new Map(),
    fileProgress: new Map(),
    fileData: new Map(),
    totalFrames: 0,
    duplicateCount: 0,
    invalidCount: 0,
    error: null,
    blob: null,
    outputFiles: new Map(),
    frameLog: [],
    manifestFragments: new Map(),
    manifestTotalFragments: 0,
  }
}

const MAX_LOG_ENTRIES = 100

export function addToLog(log: FrameLogEntry[], entry: FrameLogEntry): FrameLogEntry[] {
  return [...log.slice(-(MAX_LOG_ENTRIES - 1)), entry]
}

/**
 * Check whether a frame is a duplicate (v1 single-file).
 */
export function isDuplicateFrame(
  receivedFrames: Map<number, Uint8Array>,
  frame: DataFrame,
): boolean {
  if (frame.header.frameType === 0) return false // manifest
  return receivedFrames.has(frame.header.frameNumber)
}

/**
 * Check whether the transfer is complete (v1 single-file).
 */
export function isTransferComplete(
  receivedFrames: Map<number, Uint8Array>,
  totalFrames: number,
): boolean {
  return receivedFrames.size >= totalFrames
}

/**
 * Check whether all files in a folder transfer are complete.
 */
export function isFolderTransferComplete(fileProgress: Map<number, FileProgress>): boolean {
  if (fileProgress.size === 0) return false
  for (const [, progress] of fileProgress) {
    if (!isFileComplete(progress)) return false
  }
  return true
}

/**
 * Check whether a single file's reception is complete.
 */
export function isFileComplete(progress: FileProgress): boolean {
  return progress.receivedFrames.size >= progress.frameCount
}

/**
 * Get total expected frames across all files (folder transfer).
 */
export function getFolderTotalFrames(fileProgress: Map<number, FileProgress>): number {
  let total = 0
  for (const [, progress] of fileProgress) {
    total += progress.frameCount
  }
  return total
}

/**
 * Get total received frames across all files, deduplicated.
 */
export function getFolderReceivedFrames(fileProgress: Map<number, FileProgress>): number {
  let total = 0
  for (const [, progress] of fileProgress) {
    total += progress.receivedFrames.size
  }
  return total
}

/**
 * Reconstruct a single file from received frames (v1).
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

/**
 * Reconstruct all files in a folder transfer from per-file frame data.
 */
export function reconstructFolderFiles(
  fileProgress: Map<number, FileProgress>,
  fileData: Map<number, Map<number, Uint8Array>>,
): Map<string, Blob> {
  const outputFiles = new Map<string, Blob>()

  for (const [, progress] of fileProgress) {
    if (!isFileComplete(progress)) continue

    const frames = fileData.get(progress.fileId)
    if (!frames) continue

    const parts: Uint8Array[] = []
    for (let i = 0; i < progress.frameCount; i++) {
      const chunk = frames.get(i)
      if (!chunk) break
      parts.push(chunk)
    }

    if (parts.length !== progress.frameCount) continue

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      combined.set(part, offset)
      offset += part.length
    }

    outputFiles.set(progress.path, new Blob([combined], { type: 'application/octet-stream' }))
  }

  return outputFiles
}