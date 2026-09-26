import { describe, it, expect } from 'vitest'
import { createManifestFrame, createDataFrame, frameToQrData } from '../../protocol/encoder'
import { decodeQrData } from '../../protocol/decoder'
import { type Manifest } from '../../protocol/types'

describe('Encoder/Decoder integration', () => {
  const testManifest: Manifest = {
    transferId: new Uint8Array(16).fill(1),
    filename: 'test.bin',
    fileSize: 4096,
    totalFrames: 4,
    fileHash: new Uint8Array(32).fill(0xCD),
    protocolVersion: 1,
  }

  it('should encode and decode manifest frames via QR string', () => {
    const manifestFrame = createManifestFrame(testManifest)
    const qrData = frameToQrData(manifestFrame.bytes)
    const result = decodeQrData(qrData)

    expect(result.type).toBe('manifest')
    if (result.type === 'manifest') {
      expect(result.manifest.filename).toBe('test.bin')
      expect(result.manifest.fileSize).toBe(4096)
      expect(result.manifest.totalFrames).toBe(4)
    }
  })

  it('should encode and decode data frames via QR string', () => {
    const chunk = new Uint8Array([10, 20, 30, 40, 50])
    const dataFrame = createDataFrame(testManifest.transferId, 0, 5, chunk)
    const qrData = frameToQrData(dataFrame.bytes)
    const result = decodeQrData(qrData)

    expect(result.type).toBe('data')
    if (result.type === 'data') {
      expect(result.frame.header.frameNumber).toBe(1)
      expect(result.frame.header.frameType).toBe(1)
      expect(new Uint8Array(result.frame.payload)).toEqual(chunk)
    }
  })

  it('should reject invalid base64 data', () => {
    const result = decodeQrData('not valid base64!!!')
    expect(result.type).toBe('invalid')
  })

  it('should reject corrupted frame data', () => {
    const chunk = new Uint8Array([1, 2, 3])
    const dataFrame = createDataFrame(testManifest.transferId, 0, 5, chunk)

    // Corrupt the bytes (change a byte in the middle)
    const bytes = new Uint8Array(dataFrame.bytes)
    bytes[30] ^= 0xFF // Flip bits at position 30
    const newQrData = frameToQrData(bytes)
    const result = decodeQrData(newQrData)
    expect(result.type).toBe('invalid')
  })

  it('should handle out-of-order frame numbers', () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ]

    const frames = chunks.map((chunk, i) =>
      createDataFrame(testManifest.transferId, i, chunks.length, chunk),
    )

    // Decode in reverse order
    const results = frames.reverse().map((f) => {
      const qrData = frameToQrData(f.bytes)
      return decodeQrData(qrData)
    })

    const frameNumbers = results
      .filter((r) => r.type === 'data')
      .map((r) => (r as { frame: { header: { frameNumber: number } } }).frame.header.frameNumber)

    expect(frameNumbers).toEqual([3, 2, 1])
  })
})