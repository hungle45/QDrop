/**
 * Sender — manages file transfer state and produces frames.
 */

import {
  type Manifest,
  type FolderManifest,
  type ManifestFileEntry,
  type EncodedFrame,
} from '@/protocol'
import {
  createManifestFrame,
  createDataFrame,
  createV2ManifestFrame,
  createV2DataFrame,
} from '@/protocol'
import { sha256 } from '@/protocol'
import { chunkFile, type Chunk } from './chunker'
import { serializeFolderManifest, fragmentManifest } from '@/protocol/manifest-v2'

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
  files: File[] | null // for folder transfer
  manifest: Manifest | null
  folderManifest: FolderManifest | null
  frames: EncodedFrame[]
  currentFrameIndex: number
  totalFrames: number
  cyclesCompleted: number
  error: string | null
  isFolder: boolean
  /** When set, the sender is in retransmit mode showing only missing frames */
  retransmitFrameCount: number | null
  /** Human-readable description of current retransmit target */
  retransmitLabel: string | null
  /** Whether frame calculation is in progress. When true, the UI should show a
   *  local loading indicator on the frame count rather than a full-page spinner. */
  framesLoading: boolean
}

export function createSenderState(): SenderTransfer {
  return {
    state: 'idle',
    file: null,
    files: null,
    manifest: null,
    folderManifest: null,
    frames: [],
    currentFrameIndex: 0,
    totalFrames: 0,
    cyclesCompleted: 0,
    error: null,
    isFolder: false,
    retransmitFrameCount: null,
    retransmitLabel: null,
    framesLoading: false,
  }
}

/**
 * Prepare a single file for transfer (Phase 1 compatible).
 */
export async function prepareTransfer(file: File): Promise<{
  manifest: Manifest
  frames: EncodedFrame[]
}> {
  const chunks = await chunkFile(file)
  const transferId = crypto.getRandomValues(new Uint8Array(16))
  const fileHash = await sha256(file)

  const manifest: Manifest = {
    transferId,
    filename: file.name,
    fileSize: file.size,
    totalFrames: chunks.length,
    fileHash,
    protocolVersion: 1,
  }

  const manifestFrame = createManifestFrame(manifest)
  const dataFrames = chunks.map((chunk: Chunk) =>
    createDataFrame(transferId, chunk.index, chunks.length, chunk.data),
  )

  const frames = [manifestFrame, ...dataFrames]
  return { manifest, frames }
}

/**
 * Prepare a folder for transfer.
 */
export async function prepareFolderTransfer(
  files: File[],
  maxPayloadBytes: number,
): Promise<{
  folderManifest: FolderManifest
  frames: EncodedFrame[]
}> {
  const transferId = crypto.getRandomValues(new Uint8Array(16))

  // Build the folder manifest
  let fileIdCounter = 0
  const manifestFiles: ManifestFileEntry[] = []
  const allChunks: { fileId: number; chunks: Chunk[]; file: File }[] = []

  for (const file of files) {
    const fileId = fileIdCounter++
    const chunks = await chunkFile(file, maxPayloadBytes)
    const fileHash = await sha256(file)

    manifestFiles.push({
      fileId,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      size: file.size,
      frameCount: chunks.length,
      sha256: fileHash,
    })

    allChunks.push({ fileId, chunks, file })
  }

  const rootName = deriveRootName(files)

  const folderManifest: FolderManifest = {
    transferId,
    rootName,
    files: manifestFiles,
  }

  // Serialize and fragment the manifest
  const manifestBytes = serializeFolderManifest(folderManifest)
  const maxManifestFragmentSize = Math.min(maxPayloadBytes, 800) // keep manifest fragments small for reliability
  const manifestFragments = fragmentManifest(manifestBytes, maxManifestFragmentSize)

  // Create manifest fragment frames (v2)
  const manifestFrames: EncodedFrame[] = manifestFragments.map((frag, i) =>
    createV2ManifestFrame(transferId, i, manifestFragments.length, frag),
  )

  // Create data frames (v2) for each file
  const dataFrames: EncodedFrame[] = []
  for (const { fileId, chunks } of allChunks) {
    for (const chunk of chunks) {
      dataFrames.push(
        createV2DataFrame(transferId, fileId, chunk.index, chunks.length, chunk.data),
      )
    }
  }

  // Interleave: all manifest frames first, then all data frames
  const frames = [...manifestFrames, ...dataFrames]

  return { folderManifest, frames }
}

/**
 * Derive a root folder name from a list of files with webkitRelativePath.
 */
function deriveRootName(files: File[]): string {
  if (files.length === 0) return 'folder'

  // Check if all files share the same top-level directory via webkitRelativePath
  const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
  if (firstPath) {
    const topDir = firstPath.split('/')[0]
    if (topDir) return topDir
  }

  return 'folder'
}

/**
 * Generate frames for one display cycle.
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