/**
 * Protocol decoder — parses received QR data into frames.
 */

import { FRAME_TYPE_MANIFEST, FRAME_TYPE_DATA, type Manifest, type DataFrame } from './types'
import { decodeFrame, dataStringToFrame } from './frame'
import { decodeManifest } from './manifest'

export type DecodeResult =
  | { type: 'manifest'; frame: DataFrame; manifest: Manifest }
  | { type: 'data'; frame: DataFrame }
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

  if (frame.header.frameType === FRAME_TYPE_MANIFEST) {
    try {
      const manifest = decodeManifest(frame.payload)
      return { type: 'manifest', frame, manifest }
    } catch {
      return { type: 'invalid', reason: 'Invalid manifest payload' }
    }
  }

  if (frame.header.frameType === FRAME_TYPE_DATA) {
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
 */
export function isDuplicate(frame: DataFrame, receivedFrames: Set<number>): boolean {
  return receivedFrames.has(frame.header.frameNumber)
}