import { describe, it, expect } from 'vitest'
import { crc32, verifyCrc32 } from '../../protocol/crc'

describe('CRC32', () => {
  it('should compute a valid CRC32 for empty data', () => {
    const data = new Uint8Array([])
    const result = crc32(data)
    expect(result).toBe(0)
  })

  it('should compute a valid CRC32 for non-empty data', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const result = crc32(data)
    expect(result).toBeTypeOf('number')
    expect(result).toBeGreaterThan(0)
  })

  it('should produce different checksums for different data', () => {
    const a = crc32(new Uint8Array([1, 2, 3]))
    const b = crc32(new Uint8Array([4, 5, 6]))
    expect(a).not.toBe(b)
  })

  it('should verify CRC32 correctly', () => {
    const data = new Uint8Array([10, 20, 30, 40])
    const checksum = crc32(data)
    expect(verifyCrc32(data, checksum)).toBe(true)
  })

  it('should reject incorrect CRC32', () => {
    const data = new Uint8Array([10, 20, 30, 40])
    expect(verifyCrc32(data, 0xdeadbeef)).toBe(false)
  })
})