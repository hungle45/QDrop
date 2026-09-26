/**
 * Protocol encoder — creates frames from file data.
 */

import { FRAME_TYPE_MANIFEST, FRAME_TYPE_DATA, PROTOCOL_VERSION, type Manifest, type EncodeHeader } from './types'
import { encodeFrame, frameToDataString } from './frame'
import { encodeManifest } from './manifest'

export interface EncodedFrame {
  /** Raw binary frame bytes */
  bytes: Uint8Array
  /** Frame number (0 = manifest, 1+ = data) */
  number: number
  /** Whether this is the manifest frame */
  isManifest: boolean
}

/**
 * Create the manifest frame for a transfer.
 */
export function createManifestFrame(manifest: Manifest): EncodedFrame {
  const manifestBytes = encodeManifest(manifest)
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION,
    transferId: manifest.transferId,
    frameType: FRAME_TYPE_MANIFEST,
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
 * Create a data frame.
 */
export function createDataFrame(
  transferId: Uint8Array,
  frameNumber: number,
  totalFrames: number,
  chunk: Uint8Array,
): EncodedFrame {
  const header: EncodeHeader = {
    magic: 0x5144524f,
    version: PROTOCOL_VERSION,
    transferId,
    frameType: FRAME_TYPE_DATA,
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
 * Convert a raw frame to a QR-code-ready string.
 */
export function frameToQrData(bytes: Uint8Array): string {
  return frameToDataString(bytes)
}