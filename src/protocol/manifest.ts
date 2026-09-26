/**
 * Manifest encoding and decoding.
 *
 * Binary format:
 *   Transfer ID:       16 bytes (UUID v4)
 *   Filename length:   2 bytes (uint16, big-endian)
 *   Filename:          N bytes (UTF-8)
 *   File size:         8 bytes (uint64, big-endian)
 *   Total frames:      4 bytes (uint32, big-endian)
 *   File hash:         32 bytes (SHA-256)
 *   Protocol version:  1 byte
 */

import { TRANSFER_ID_SIZE, type Manifest } from './types'

export function encodeManifest(manifest: Manifest): Uint8Array {
  const encoder = new TextEncoder()
  const filenameBytes = encoder.encode(manifest.filename)
  if (filenameBytes.length > 65535) {
    throw new Error('Filename too long')
  }

  const size =
    TRANSFER_ID_SIZE +
    2 +
    filenameBytes.length +
    8 +
    4 +
    32 +
    1

  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer)

  let offset = 0

  // Transfer ID
  buf.set(manifest.transferId, offset)
  offset += TRANSFER_ID_SIZE

  // Filename length (uint16)
  dv.setUint16(offset, filenameBytes.length)
  offset += 2

  // Filename
  buf.set(filenameBytes, offset)
  offset += filenameBytes.length

  // File size (uint64)
  dv.setBigUint64(offset, BigInt(manifest.fileSize))
  offset += 8

  // Total frames (uint32)
  dv.setUint32(offset, manifest.totalFrames)
  offset += 4

  // File hash (32 bytes)
  buf.set(manifest.fileHash, offset)
  offset += 32

  // Protocol version
  buf[offset] = manifest.protocolVersion

  return buf
}

export function decodeManifest(data: Uint8Array): Manifest {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  const transferId = data.slice(offset, offset + TRANSFER_ID_SIZE)
  offset += TRANSFER_ID_SIZE

  const filenameLength = dv.getUint16(offset)
  offset += 2

  const filenameBytes = data.slice(offset, offset + filenameLength)
  const filename = new TextDecoder().decode(filenameBytes)
  offset += filenameLength

  const fileSize = Number(dv.getBigUint64(offset))
  offset += 8

  const totalFrames = dv.getUint32(offset)
  offset += 4

  const fileHash = data.slice(offset, offset + 32)
  offset += 32

  const protocolVersion = data[offset]

  return {
    transferId,
    filename,
    fileSize,
    totalFrames,
    fileHash,
    protocolVersion,
  }
}

export function encodeManifestAsString(manifest: Manifest): string {
  const bytes = encodeManifest(manifest)
  return uint8ArrayToBase64(bytes)
}

export function decodeManifestFromString(str: string): Manifest {
  const bytes = base64ToUint8Array(str)
  return decodeManifest(bytes)
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}