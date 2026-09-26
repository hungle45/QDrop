/** Protocol types and constants */

export const MAGIC = 0x5144524f // "QDRO" in ASCII
export const PROTOCOL_VERSION = 1

export const FRAME_TYPE_MANIFEST = 0
export const FRAME_TYPE_DATA = 1

export const MAGIC_SIZE = 4
export const VERSION_SIZE = 1
export const TRANSFER_ID_SIZE = 16
export const FRAME_TYPE_SIZE = 1
export const FRAME_NUMBER_SIZE = 4
export const TOTAL_FRAMES_SIZE = 4
export const PAYLOAD_LENGTH_SIZE = 4
export const CRC32_SIZE = 4

export const HEADER_SIZE =
  MAGIC_SIZE +
  VERSION_SIZE +
  TRANSFER_ID_SIZE +
  FRAME_TYPE_SIZE +
  FRAME_NUMBER_SIZE +
  TOTAL_FRAMES_SIZE +
  PAYLOAD_LENGTH_SIZE +
  CRC32_SIZE

export type FrameType = typeof FRAME_TYPE_MANIFEST | typeof FRAME_TYPE_DATA

export interface FrameHeader {
  magic: number
  version: number
  transferId: Uint8Array
  frameType: FrameType
  frameNumber: number
  totalFrames: number
  payloadLength: number
  crc32: number
}

/** Header without CRC — used when encoding frames (CRC is computed internally). */
export interface EncodeHeader extends Omit<FrameHeader, 'crc32'> {}

export interface Manifest {
  transferId: Uint8Array
  filename: string
  fileSize: number
  totalFrames: number
  fileHash: Uint8Array
  protocolVersion: number
}

export interface DataFrame {
  header: FrameHeader
  payload: Uint8Array
}