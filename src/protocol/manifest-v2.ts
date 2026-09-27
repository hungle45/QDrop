/**
 * Folder manifest serialization and fragmentation.
 *
 * The folder manifest describes the complete folder structure for a transfer.
 * Since it may be larger than a single QR payload, it is split into
 * multiple fragments, each carried in a MANIFEST frame.
 *
 * Binary format (per fragment frame payload):
 *   This is a compact representation of the full manifest.
 *
 * Full manifest binary layout (serialized then fragmented):
 *   Root name length:    2 bytes (uint16, big-endian)
 *   Root name:           N bytes (UTF-8)
 *   File count:          4 bytes (uint32, big-endian)
 *   Files[]:
 *     File ID:           4 bytes (uint32, big-endian)
 *     Path length:       2 bytes (uint16, big-endian)
 *     Path:              M bytes (UTF-8)
 *     Size:              8 bytes (uint64, big-endian)
 *     Frame count:       4 bytes (uint32, big-endian)
 *     SHA-256:          32 bytes
 */

import { type ManifestFileEntry, type FolderManifest } from './types'
import { sha256 } from './hash'

/**
 * Fragment metadata embedded in each manifest fragment.
 */
export interface ManifestFragmentInfo {
  transferId: Uint8Array
  manifestFrameNumber: number
  manifestTotalFrames: number
  manifestHash: Uint8Array // SHA-256 of the full serialized manifest
  payloadFragment: Uint8Array
}

/**
 * Serialize a FolderManifest into a compact binary blob.
 */
export function serializeFolderManifest(manifest: FolderManifest): Uint8Array {
  const encoder = new TextEncoder()
  const rootNameBytes = encoder.encode(manifest.rootName)

  // Calculate total size
  let size = 2 + rootNameBytes.length + 4 // root name length + root name + file count
  for (const file of manifest.files) {
    const pathBytes = encoder.encode(file.path)
    size += 4 + 2 + pathBytes.length + 8 + 4 + 32
  }

  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let offset = 0

  // Root name length
  dv.setUint16(offset, rootNameBytes.length)
  offset += 2

  // Root name
  buf.set(rootNameBytes, offset)
  offset += rootNameBytes.length

  // File count
  dv.setUint32(offset, manifest.files.length)
  offset += 4

  // Files
  for (const file of manifest.files) {
    const pathBytes = encoder.encode(file.path)
    if (pathBytes.length > 65535) {
      throw new Error(`Path too long: ${file.path}`)
    }

    // File ID
    dv.setUint32(offset, file.fileId)
    offset += 4

    // Path length
    dv.setUint16(offset, pathBytes.length)
    offset += 2

    // Path
    buf.set(pathBytes, offset)
    offset += pathBytes.length

    // Size
    dv.setBigUint64(offset, BigInt(file.size))
    offset += 8

    // Frame count
    dv.setUint32(offset, file.frameCount)
    offset += 4

    // SHA-256
    buf.set(file.sha256, offset)
    offset += 32
  }

  return buf
}

/**
 * Deserialize a binary blob into a FolderManifest.
 */
export function deserializeFolderManifest(data: Uint8Array): FolderManifest {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  let offset = 0

  // Root name length
  const rootNameLength = dv.getUint16(offset)
  offset += 2

  // Root name
  const rootName = decoder.decode(data.slice(offset, offset + rootNameLength))
  offset += rootNameLength

  // File count
  const fileCount = dv.getUint32(offset)
  offset += 4

  const files: ManifestFileEntry[] = []

  for (let i = 0; i < fileCount; i++) {
    // File ID
    const fileId = dv.getUint32(offset)
    offset += 4

    // Path length
    const pathLength = dv.getUint16(offset)
    offset += 2

    // Path
    const path = decoder.decode(data.slice(offset, offset + pathLength))
    offset += pathLength

    // Size
    const size = Number(dv.getBigUint64(offset))
    offset += 8

    // Frame count
    const frameCount = dv.getUint32(offset)
    offset += 4

    // SHA-256
    const sha256Bytes = data.slice(offset, offset + 32)
    offset += 32

    files.push({ fileId, path, size, frameCount, sha256: sha256Bytes })
  }

  return { transferId: new Uint8Array(16), rootName, files }
}

/**
 * Split a serialized manifest into fragments of at most maxFragmentSize bytes each.
 * Returns fragment payloads ready to be placed into MANIFEST frames.
 */
export function fragmentManifest(
  fullManifestBytes: Uint8Array,
  maxFragmentSize: number,
): Uint8Array[] {
  const fragments: Uint8Array[] = []

  for (let offset = 0; offset < fullManifestBytes.length; offset += maxFragmentSize) {
    const end = Math.min(offset + maxFragmentSize, fullManifestBytes.length)
    fragments.push(fullManifestBytes.slice(offset, end))
  }

  return fragments
}

/**
 * Prepare manifest frames data for a folder transfer.
 * Returns the serialized full manifest and its fragments.
 */
export async function prepareManifestFragments(
  manifest: FolderManifest,
  maxFragmentSize: number,
): Promise<{
  fullManifestBytes: Uint8Array
  fragments: Uint8Array[]
  manifestHash: Uint8Array
}> {
  const fullManifestBytes = serializeFolderManifest(manifest)
  const manifestHash = await sha256(fullManifestBytes)
  const fragments = fragmentManifest(fullManifestBytes, maxFragmentSize)
  return { fullManifestBytes, fragments, manifestHash }
}

/**
 * Reconstruct a FolderManifest from its fragments.
 * Returns null if not all fragments are available.
 */
export function reconstructFolderManifest(
  fragments: Map<number, Uint8Array>,
  totalFragments: number,
): FolderManifest | null {
  if (fragments.size !== totalFragments) return null

  // Assemble in order
  const parts: Uint8Array[] = []
  for (let i = 0; i < totalFragments; i++) {
    const frag = fragments.get(i)
    if (!frag) return null
    parts.push(frag)
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }

  return deserializeFolderManifest(combined)
}

/**
 * Validate that a path is safe (no traversal, no absolute paths).
 */
export function isPathSafe(path: string): boolean {
  if (path.startsWith('/')) return false
  if (path.startsWith('../')) return false
  if (path === '..' || path === '.') return false
  // Check for any ".." path components
  const parts = path.split('/')
  for (const part of parts) {
    if (part === '..') return false
  }
  return true
}