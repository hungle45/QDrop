/** Protocol types and constants */

export const MAGIC = 0x5144524f // "QDRO" in ASCII
export const PROTOCOL_VERSION_V1 = 1
export const PROTOCOL_VERSION_V2 = 2

export const FRAME_TYPE_MANIFEST = 0
export const FRAME_TYPE_DATA = 1
export const TRANSFER_TYPE_FILE = 0
export const TRANSFER_TYPE_FOLDER = 1

export const MAGIC_SIZE = 4
export const VERSION_SIZE = 1
export const TRANSFER_ID_SIZE = 16
export const FRAME_TYPE_SIZE = 1
export const FILE_ID_SIZE = 4
export const FRAME_NUMBER_SIZE = 4
export const TOTAL_FRAMES_SIZE = 4
export const PAYLOAD_LENGTH_SIZE = 4
export const CRC32_SIZE = 4

export const HEADER_SIZE_V1 =
  MAGIC_SIZE +
  VERSION_SIZE +
  TRANSFER_ID_SIZE +
  FRAME_TYPE_SIZE +
  FRAME_NUMBER_SIZE +
  TOTAL_FRAMES_SIZE +
  PAYLOAD_LENGTH_SIZE +
  CRC32_SIZE

export const HEADER_SIZE_V2 =
  MAGIC_SIZE +
  VERSION_SIZE +
  TRANSFER_ID_SIZE +
  FRAME_TYPE_SIZE +
  FILE_ID_SIZE +
  FRAME_NUMBER_SIZE +
  TOTAL_FRAMES_SIZE +
  PAYLOAD_LENGTH_SIZE +
  CRC32_SIZE

export type FrameType = typeof FRAME_TYPE_MANIFEST | typeof FRAME_TYPE_DATA
export type TransferType = typeof TRANSFER_TYPE_FILE | typeof TRANSFER_TYPE_FOLDER

export interface FrameHeader {
  magic: number
  version: number
  transferId: Uint8Array
  frameType: FrameType
  /** For v2 MANIFEST frames: manifest fragment index. For v2 DATA frames: file_id. */
  fileIdOrManifestFrag: number
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

/** Entry in a folder manifest — describes one file in the folder tree. */
export interface ManifestFileEntry {
  fileId: number
  path: string
  size: number
  frameCount: number
  sha256: Uint8Array
}

/**
 * Folder manifest — the complete description of a folder transfer.
 * This is serialized, split into fragments, and sent as MANIFEST frames.
 */
export interface FolderManifest {
  transferId: Uint8Array
  rootName: string
  files: ManifestFileEntry[]
}

export interface DataFrame {
  header: FrameHeader
  payload: Uint8Array
}