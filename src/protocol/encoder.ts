/**
 * Protocol encoder — creates frames from file data.
 */

import {
  FRAME_TYPE_MANIFEST, FRAME_TYPE_DATA,
  PROTOCOL_VERSION_V1, PROTOCOL_VERSION_V2,
  type Manifest, type EncodeHeader,
} from './types'
import { encodeFrame, frameToDataString } from './frame'
import { encodeManifest } from './manifest'
import type { FolderManifest } from './types'
import { prepareManifestFragments } from './manifest-v2'

export interface EncodedFrame {
  /** Raw binary frame bytes */
  bytes: Uint8Array
  /** Frame number (0 = manifest, 1+ = data) */
  number: number
  /** Whether this is a manifest frame of any kind */
  isManifest: boolean
  /** For v2 data frames: the file_id this payload belongs to */
  fileId?: number
  /** For v2 data frames: total frames for this file */
  totalFrames?: number
  /** For v2 manifest frames: the fragment index */
  manifestFragmentIndex?: number
  /** Total manifest fragments (for v2) */
  manifestTotalFrames?: number
}

/**
 * Create the manifest frame for a single-file transfer (v1).
 */
export function createManifestFrame(manifest: Manifest): EncodedFrame {
  const manifestBytes = encodeManifest(manifest)
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION_V1,
    transferId: manifest.transferId,
    frameType: FRAME_TYPE_MANIFEST,
    fileIdOrManifestFrag: 0,
    frameNumber: 0,
    totalFrames: manifest.totalFrames + 1,
    payloadLength: manifestBytes.length,
  }

  const bytes = encodeFrame(header, manifestBytes)

  return {
    bytes,
    number: 0,
    isManifest: true,
  }
}

/**
 * Create a data frame for a single-file transfer (v1).
 */
export function createDataFrame(
  transferId: Uint8Array,
  frameNumber: number,
  totalFrames: number,
  chunk: Uint8Array,
): EncodedFrame {
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION_V1,
    transferId,
    frameType: FRAME_TYPE_DATA,
    fileIdOrManifestFrag: 0,
    frameNumber: frameNumber + 1,
    totalFrames,
    payloadLength: chunk.length,
  }

  const bytes = encodeFrame(header, chunk)

  return {
    bytes,
    number: frameNumber + 1,
    isManifest: false,
  }
}

/**
 * Create a v2 manifest fragment frame.
 */
export function createV2ManifestFrame(
  transferId: Uint8Array,
  manifestFragmentIndex: number,
  manifestTotalFrames: number,
  fragmentPayload: Uint8Array,
): EncodedFrame {
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION_V2,
    transferId,
    frameType: FRAME_TYPE_MANIFEST,
    fileIdOrManifestFrag: manifestFragmentIndex,
    frameNumber: 0, // unused for manifest
    totalFrames: manifestTotalFrames,
    payloadLength: fragmentPayload.length,
  }

  const bytes = encodeFrame(header, fragmentPayload)

  return {
    bytes,
    number: manifestFragmentIndex,
    isManifest: true,
    manifestFragmentIndex,
    manifestTotalFrames,
  }
}

/**
 * Create a v2 data frame with file_id.
 */
export function createV2DataFrame(
  transferId: Uint8Array,
  fileId: number,
  frameNumber: number,
  totalFrames: number,
  chunk: Uint8Array,
): EncodedFrame {
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION_V2,
    transferId,
    frameType: FRAME_TYPE_DATA,
    fileIdOrManifestFrag: fileId,
    frameNumber,
    totalFrames,
    payloadLength: chunk.length,
  }

  const bytes = encodeFrame(header, chunk)

  return {
    bytes,
    number: frameNumber,
    isManifest: false,
    fileId,
    totalFrames,
  }
}

/**
 * Create all manifest fragment frames for a folder transfer.
 */
export async function createFolderManifestFrames(
  manifest: FolderManifest,
  maxFragmentSize: number,
): Promise<EncodedFrame[]> {
  const { fragments } = await prepareManifestFragments(manifest, maxFragmentSize)
  return fragments.map((frag, i) =>
    createV2ManifestFrame(manifest.transferId, i, fragments.length, frag),
  )
}

/**
 * Convert a raw frame to a QR-code-ready string.
 */
export function frameToQrData(bytes: Uint8Array): string {
  return frameToDataString(bytes)
}