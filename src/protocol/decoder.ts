/**
 * Protocol decoder — parses received QR data into frames.
 */

import {
  FRAME_TYPE_MANIFEST, FRAME_TYPE_DATA,
  PROTOCOL_VERSION_V2,
  type Manifest, type DataFrame,
} from './types'
import { decodeFrame, dataStringToFrame } from './frame'
import { decodeManifest } from './manifest'

export type DecodeResult =
  | { type: 'manifest'; frame: DataFrame; manifest: Manifest }
  | { type: 'manifest-v2'; frame: DataFrame; manifestFragmentIndex: number; manifestTotalFrames: number; fragmentPayload: Uint8Array }
  | { type: 'data'; frame: DataFrame }
  | { type: 'data-v2'; frame: DataFrame; fileId: number; fileFrameNumber: number; fileTotalFrames: number }
  | { type: 'invalid'; reason: string }

/**
 * Decode a QR data string into a protocol frame.
 */
export function decodeQrData(data: string): DecodeResult {
  let bytes: Uint8Array
  try {
    bytes = dataStringToFrame(data)
  } catch {
    return { type: 'invalid', reason: 'Invalid base64' }
  }

  const frame = decodeFrame(bytes)
  if (!frame) {
    return { type: 'invalid', reason: 'CRC32 mismatch or invalid frame' }
  }

  const { header } = frame

  if (header.frameType === FRAME_TYPE_MANIFEST) {
    if (header.version >= PROTOCOL_VERSION_V2) {
      // v2 manifest fragment
      return {
        type: 'manifest-v2',
        frame,
        manifestFragmentIndex: header.fileIdOrManifestFrag,
        manifestTotalFrames: header.totalFrames,
        fragmentPayload: frame.payload,
      }
    }

    // v1 manifest (single file)
    try {
      const manifest = decodeManifest(frame.payload)
      return { type: 'manifest', frame, manifest }
    } catch {
      return { type: 'invalid', reason: 'Invalid manifest payload' }
    }
  }

  if (header.frameType === FRAME_TYPE_DATA) {
    if (header.version >= PROTOCOL_VERSION_V2) {
      // v2 data frame with file_id
      return {
        type: 'data-v2',
        frame,
        fileId: header.fileIdOrManifestFrag,
        fileFrameNumber: header.frameNumber,
        fileTotalFrames: header.totalFrames,
      }
    }

    // v1 data frame
    return { type: 'data', frame }
  }

  return { type: 'invalid', reason: 'Unknown frame type' }
}

/**
 * Validate frame CRC without full decode.
 */
export function validateFrameCrc(data: Uint8Array): boolean {
  const frame = decodeFrame(data)
  return frame !== null
}

/**
 * Check if a decoded data frame is a duplicate of one we already have.
 * Works for both v1 (global frame numbers) and v2 (per-file frame numbers).
 */
export function isDuplicate(
  frame: DataFrame,
  receivedFrames: Map<number, Uint8Array>,
): boolean {
  return receivedFrames.has(frame.header.frameNumber)
}

/**
 * Check if a v2 data frame is a duplicate for a specific file.
 */
export function isFileFrameDuplicate(
  fileId: number,
  frameNumber: number,
  fileFrames: Map<string, Set<number>>,
): boolean {
  const key = `${fileId}`
  const existing = fileFrames.get(key)
  if (!existing) return false
  return existing.has(frameNumber)
}