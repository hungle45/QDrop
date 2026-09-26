/**
 * CRC32 implementation for frame-level integrity checking.
 * Uses the standard CRC-32 algorithm with polynomial 0xEDB88320.
 */

const CRC_TABLE = new Uint32Array(256)

function initCrcTable(): void {
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    }
    CRC_TABLE[i] = crc
  }
}

initCrcTable()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function crc32Buffer(data: ArrayBuffer): number {
  return crc32(new Uint8Array(data))
}

/**
 * Verify CRC32 of a buffer against a known checksum.
 */
export function verifyCrc32(data: Uint8Array, expected: number): boolean {
  return crc32(data) === expected
}