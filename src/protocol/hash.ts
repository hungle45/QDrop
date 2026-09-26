/**
 * SHA-256 hashing using the Web Crypto API.
 */

/**
 * Compute SHA-256 hash of a blob/file.
 */
export async function sha256(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  let buffer: ArrayBuffer
  if (data instanceof Blob) {
    buffer = await data.arrayBuffer()
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  } else {
    buffer = data
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return new Uint8Array(hashBuffer)
}

/**
 * Compare two Uint8Arrays for equality.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Format bytes as hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}