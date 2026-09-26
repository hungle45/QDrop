import { describe, it, expect } from 'vitest'
import { encodeManifest, decodeManifest, encodeManifestAsString, decodeManifestFromString } from '../../protocol/manifest'
import { type Manifest } from '../../protocol/types'

describe('Manifest', () => {
  const testManifest: Manifest = {
    transferId: new Uint8Array(16).fill(1),
    filename: 'test.txt',
    fileSize: 1024,
    totalFrames: 10,
    fileHash: new Uint8Array(32).fill(0xAB),
    protocolVersion: 1,
  }

  it('should encode and decode a manifest', () => {
    const bytes = encodeManifest(testManifest)
    const decoded = decodeManifest(bytes)

    expect(new Uint8Array(decoded.transferId)).toEqual(testManifest.transferId)
    expect(decoded.filename).toBe('test.txt')
    expect(decoded.fileSize).toBe(1024)
    expect(decoded.totalFrames).toBe(10)
    expect(new Uint8Array(decoded.fileHash)).toEqual(testManifest.fileHash)
    expect(decoded.protocolVersion).toBe(1)
  })

  it('should handle filenames with special characters', () => {
    const manifest = {
      ...testManifest,
      filename: 'my file (v2).txt',
    }
    const bytes = encodeManifest(manifest)
    const decoded = decodeManifest(bytes)
    expect(decoded.filename).toBe('my file (v2).txt')
  })

  it('should handle empty filename', () => {
    const manifest = {
      ...testManifest,
      filename: '',
    }
    const bytes = encodeManifest(manifest)
    const decoded = decodeManifest(bytes)
    expect(decoded.filename).toBe('')
  })

  it('should encode/decode via base64 string', () => {
    const str = encodeManifestAsString(testManifest)
    const decoded = decodeManifestFromString(str)
    expect(decoded.filename).toBe('test.txt')
    expect(decoded.fileSize).toBe(1024)
  })

  it('should handle large file sizes', () => {
    const manifest = {
      ...testManifest,
      fileSize: 4_294_967_296, // 4GB
    }
    const bytes = encodeManifest(manifest)
    const decoded = decodeManifest(bytes)
    expect(decoded.fileSize).toBe(4_294_967_296)
  })

  it('should handle long filenames', () => {
    const longName = 'a'.repeat(200)
    const manifest = {
      ...testManifest,
      filename: longName,
    }
    const bytes = encodeManifest(manifest)
    const decoded = decodeManifest(bytes)
    expect(decoded.filename).toBe(longName)
  })
})