/**
 * Frame encoding and decoding.
 *
 * Binary frame format (v1 — backward compatible, single file):
 *   Magic:           4 bytes ("QDRO")
 *   Version:         1 byte  (1)
 *   Transfer ID:    16 bytes
 *   Frame type:      1 byte  (0 = manifest, 1 = data)
 *   Frame number:    4 bytes (uint32, big-endian)
 *   Total frames:    4 bytes (uint32, big-endian)
 *   Payload length:  4 bytes (uint32, big-endian)
 *   Payload:         N bytes
 *   CRC32:           4 bytes (uint32, big-endian)
 *
 * Binary frame format (v2 — folder transfer):
 *   Magic:           4 bytes ("QDRO")
 *   Version:         1 byte  (2)
 *   Transfer ID:    16 bytes
 *   Frame type:      1 byte  (0 = manifest, 1 = data)
 *   File ID / MF:    4 bytes (uint32, big-endian)
 *     For MANIFEST frames: manifest fragment index
 *     For DATA frames:     file_id of the file this data belongs to
 *   Frame number:    4 bytes (uint32, big-endian)
 *     For MANIFEST frames: unused (0)
 *     For DATA frames:     per-file frame number
 *   Total frames:    4 bytes (uint32, big-endian)
 *     For MANIFEST frames: total manifest fragments
 *     For DATA frames:     per-file total frames
 *   Payload length:  4 bytes (uint32, big-endian)
 *   Payload:         N bytes
 *   CRC32:           4 bytes (uint32, big-endian)
 */

import {
  MAGIC,
  MAGIC_SIZE,
  VERSION_SIZE,
  TRANSFER_ID_SIZE,
  FRAME_TYPE_SIZE,
  FILE_ID_SIZE,
  FRAME_NUMBER_SIZE,
  TOTAL_FRAMES_SIZE,
  PAYLOAD_LENGTH_SIZE,
  CRC32_SIZE,
  HEADER_SIZE_V1,
  HEADER_SIZE_V2,
  FRAME_TYPE_MANIFEST,
  FRAME_TYPE_DATA,
  PROTOCOL_VERSION_V1,
  PROTOCOL_VERSION_V2,
  type EncodeHeader,
  type FrameHeader,
  type DataFrame,
  type FrameType,
} from './types'
import { crc32 } from './crc'

/**
 * Get the header size for a given protocol version.
 */
function headerSizeForVersion(version: number): number {
  return version >= PROTOCOL_VERSION_V2 ? HEADER_SIZE_V2 : HEADER_SIZE_V1
}

/**
 * Encode a frame into binary format. CRC32 is computed automatically.
 */
export function encodeFrame(header: EncodeHeader, payload: Uint8Array): Uint8Array {
  const hdrSize = headerSizeForVersion(header.version)
  const totalSize = hdrSize + payload.length
  const buf = new Uint8Array(totalSize)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  let offset = 0

  // Magic
  dv.setUint32(offset, header.magic)
  offset += MAGIC_SIZE

  // Version
  buf[offset] = header.version
  offset += VERSION_SIZE

  // Transfer ID
  buf.set(header.transferId, offset)
  offset += TRANSFER_ID_SIZE

  // Frame type
  buf[offset] = header.frameType
  offset += FRAME_TYPE_SIZE

  if (header.version >= PROTOCOL_VERSION_V2) {
    // File ID (data frames) or manifest fragment index (manifest frames)
    dv.setUint32(offset, header.fileIdOrManifestFrag)
    offset += FILE_ID_SIZE
  }

  // Frame number
  dv.setUint32(offset, header.frameNumber)
  offset += FRAME_NUMBER_SIZE

  // Total frames
  dv.setUint32(offset, header.totalFrames)
  offset += TOTAL_FRAMES_SIZE

  // Payload length
  dv.setUint32(offset, payload.length)
  offset += PAYLOAD_LENGTH_SIZE

  // Payload
  buf.set(payload, offset)
  offset += payload.length

  // CRC32 (computed over everything before CRC)
  const crc = crc32(new Uint8Array(buf.buffer, buf.byteOffset, offset))
  dv.setUint32(offset, crc)

  return buf
}

export function decodeFrame(data: Uint8Array): DataFrame | null {
  if (data.length < HEADER_SIZE_V1) return null

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  const magic = dv.getUint32(offset)
  if (magic !== MAGIC) return null
  offset += MAGIC_SIZE

  const version = data[offset]
  offset += VERSION_SIZE

  if (version !== PROTOCOL_VERSION_V1 && version !== PROTOCOL_VERSION_V2) return null

  const hdrSize = headerSizeForVersion(version)

  if (data.length < hdrSize) return null

  const transferId = data.slice(offset, offset + TRANSFER_ID_SIZE)
  offset += TRANSFER_ID_SIZE

  const frameType = data[offset] as FrameType
  offset += FRAME_TYPE_SIZE

  if (frameType !== FRAME_TYPE_MANIFEST && frameType !== FRAME_TYPE_DATA) return null

  let fileIdOrManifestFrag = 0
  if (version >= PROTOCOL_VERSION_V2) {
    fileIdOrManifestFrag = dv.getUint32(offset)
    offset += FILE_ID_SIZE
  }

  const frameNumber = dv.getUint32(offset)
  offset += FRAME_NUMBER_SIZE

  const totalFrames = dv.getUint32(offset)
  offset += TOTAL_FRAMES_SIZE

  const payloadLength = dv.getUint32(offset)
  offset += PAYLOAD_LENGTH_SIZE

  if (data.length < offset + payloadLength + CRC32_SIZE) return null

  const payload = data.slice(offset, offset + payloadLength)
  offset += payloadLength

  const storedCrc = dv.getUint32(offset)

  // Verify CRC32 (over everything up to this point)
  const crcData = new Uint8Array(data.buffer, data.byteOffset, offset)
  const computedCrc = crc32(crcData)
  if (computedCrc !== storedCrc) return null

  const header: FrameHeader = {
    magic,
    version,
    transferId,
    frameType,
    fileIdOrManifestFrag,
    frameNumber,
    totalFrames,
    payloadLength,
    crc32: storedCrc,
  }

  return { header, payload }
}

/**
 * Convert a frame to a string for QR encoding.
 */
export function frameToDataString(frame: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < frame.length; i++) {
    binary += String.fromCharCode(frame[i])
  }
  return btoa(binary)
}

/**
 * Convert a data string (from QR) back to a frame.
 */
export function dataStringToFrame(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}