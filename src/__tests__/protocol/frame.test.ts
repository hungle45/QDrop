import { describe, it, expect } from 'vitest'
import { encodeFrame, decodeFrame, frameToDataString, dataStringToFrame } from '../../protocol/frame'
import { crc32 } from '../../protocol/crc'
import {
  MAGIC, PROTOCOL_VERSION,
  FRAME_TYPE_MANIFEST, FRAME_TYPE_DATA,
  HEADER_SIZE,
  type EncodeHeader,
} from '../../protocol/types'

function makeTestHeader(overrides: Partial<EncodeHeader> = {}): EncodeHeader {
  return {
    magic: MAGIC,
    version: PROTOCOL_VERSION,
    transferId: new Uint8Array(16).fill(42),
    frameType: FRAME_TYPE_DATA,
    frameNumber: 1,
    totalFrames: 10,
    payloadLength: 0,
    ...overrides,
  }
}

describe('Frame encoding/decoding', () => {
  it('should encode and decode a valid frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5])
    const header = makeTestHeader({ payloadLength: payload.length })
    const bytes = encodeFrame(header, payload)
    expect(bytes.length).toBe(HEADER_SIZE + payload.length)

    const decoded = decodeFrame(bytes)
    expect(decoded).not.toBeNull()
    if (!decoded) return

    expect(decoded.header.magic).toBe(MAGIC)
    expect(decoded.header.version).toBe(PROTOCOL_VERSION)
    expect(decoded.header.frameType).toBe(FRAME_TYPE_DATA)
    expect(decoded.header.frameNumber).toBe(1)
    expect(decoded.header.totalFrames).toBe(10)
    expect(new Uint8Array(decoded.header.transferId)).toEqual(new Uint8Array(16).fill(42))
    expect(new Uint8Array(decoded.payload)).toEqual(payload)
  })

  it('should encode and decode a manifest frame', () => {
    const payload = new Uint8Array([10, 20, 30])
    const header = makeTestHeader({
      frameType: FRAME_TYPE_MANIFEST,
      frameNumber: 0,
      payloadLength: payload.length,
    })
    const bytes = encodeFrame(header, payload)
    const decoded = decodeFrame(bytes)
    expect(decoded).not.toBeNull()
    expect(decoded!.header.frameType).toBe(FRAME_TYPE_MANIFEST)
    expect(decoded!.header.frameNumber).toBe(0)
  })

  it('should reject data that is too short', () => {
    const result = decodeFrame(new Uint8Array([1, 2, 3]))
    expect(result).toBeNull()
  })

  it('should reject data with invalid magic bytes', () => {
    const payload = new Uint8Array([1, 2, 3])
    const header = makeTestHeader({ payloadLength: payload.length, magic: 0 })
    const bytes = encodeFrame(header, payload)
    bytes[0] = 0xFF // Corrupt magic
    const result = decodeFrame(bytes)
    expect(result).toBeNull()
  })

  it('should reject data with invalid CRC32', () => {
    const payload = new Uint8Array([1, 2, 3])
    const header = makeTestHeader({ payloadLength: payload.length })
    const bytes = encodeFrame(header, payload)
    // Corrupt a byte in the payload area (which is before CRC)
    bytes[HEADER_SIZE] = 0xFF
    const result = decodeFrame(bytes)
    expect(result).toBeNull()
  })

  it('should reject invalid frame type', () => {
    const payload = new Uint8Array([1, 2, 3])
    const header = makeTestHeader({ payloadLength: payload.length, frameType: 99 as never })
    const bytes = encodeFrame(header, payload)
    // Corrupt the frame type byte in the encoded output
    const typeOffset = 4 + 1 + 16 // magic + version + transferId
    bytes[typeOffset] = 99
    // Recompute CRC with corrupted type
    const corruptedCrc = crc32(new Uint8Array(bytes.buffer, 0, bytes.length - 4))
    const dv = new DataView(bytes.buffer, bytes.byteLength - 4, 4)
    dv.setUint32(0, corruptedCrc)

    const result = decodeFrame(bytes)
    expect(result).toBeNull()
  })
})

describe('frameToDataString / dataStringToFrame', () => {
  it('should round-trip binary data through base64 string', () => {
    const original = new Uint8Array([0, 1, 255, 128, 64, 32, 16, 8, 4, 2])
    const str = frameToDataString(original)
    const decoded = dataStringToFrame(str)
    expect(new Uint8Array(decoded)).toEqual(original)
  })
})