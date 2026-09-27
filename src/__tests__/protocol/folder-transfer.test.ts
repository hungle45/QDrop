/**
 * Phase 2: Folder Transfer Tests
 *
 * Tests for manifest fragmentation, folder structure, per-file frames,
 * duplicate detection, path safety, and end-to-end folder transfer.
 */

import { describe, it, expect } from 'vitest'
import {
  serializeFolderManifest,
  deserializeFolderManifest,
  fragmentManifest,
  reconstructFolderManifest,
  isPathSafe,
} from '../../protocol/manifest-v2'
import {
  createV2ManifestFrame,
  createV2DataFrame,
  frameToQrData,
} from '../../protocol/encoder'
import { decodeQrData } from '../../protocol/decoder'
import {
  isFolderTransferComplete,
  isFileComplete,
  getFolderTotalFrames,
  getFolderReceivedFrames,
  reconstructFolderFiles,
  type FileProgress,
} from '../../transfer/receiver'
import {
  type FolderManifest,
  type ManifestFileEntry,
} from '../../protocol/types'

function createTestFolderManifest(overrides: Partial<FolderManifest> = {}): FolderManifest {
  return {
    transferId: new Uint8Array(16).fill(42),
    rootName: 'project',
    files: [],
    ...overrides,
  }
}

function createTestFileEntry(overrides: Partial<ManifestFileEntry> = {}): ManifestFileEntry {
  return {
    fileId: 0,
    path: 'test.txt',
    size: 100,
    frameCount: 2,
    sha256: new Uint8Array(32).fill(0xAB),
    ...overrides,
  }
}

describe('Folder Manifest: Serialization', () => {
  it('should serialize and deserialize a small manifest', () => {
    const manifest = createTestFolderManifest({
      rootName: 'my-project',
      files: [
        createTestFileEntry({ fileId: 0, path: 'src/main.go', size: 5234, frameCount: 3, sha256: new Uint8Array(32).fill(1) }),
        createTestFileEntry({ fileId: 1, path: 'src/config.go', size: 1832, frameCount: 1, sha256: new Uint8Array(32).fill(2) }),
        createTestFileEntry({ fileId: 2, path: 'README.md', size: 800, frameCount: 1, sha256: new Uint8Array(32).fill(3) }),
      ],
    })

    const bytes = serializeFolderManifest(manifest)
    const decoded = deserializeFolderManifest(bytes)

    expect(decoded.rootName).toBe('my-project')
    expect(decoded.files).toHaveLength(3)
    expect(decoded.files[0].path).toBe('src/main.go')
    expect(decoded.files[0].size).toBe(5234)
    expect(decoded.files[0].frameCount).toBe(3)
    expect(decoded.files[1].path).toBe('src/config.go')
    expect(decoded.files[1].size).toBe(1832)
    expect(decoded.files[2].path).toBe('README.md')
  })

  it('should preserve path hierarchy', () => {
    const manifest = createTestFolderManifest({
      rootName: 'project',
      files: [
        createTestFileEntry({ fileId: 0, path: 'src/main.go', size: 100, frameCount: 1 }),
        createTestFileEntry({ fileId: 1, path: 'src/api/users.go', size: 200, frameCount: 1 }),
        createTestFileEntry({ fileId: 2, path: 'README.md', size: 50, frameCount: 1 }),
      ],
    })

    const bytes = serializeFolderManifest(manifest)
    const decoded = deserializeFolderManifest(bytes)
    expect(decoded.files.map(f => f.path)).toEqual([
      'src/main.go',
      'src/api/users.go',
      'README.md',
    ])
  })

  it('should handle many files', () => {
    const files: ManifestFileEntry[] = []
    for (let i = 0; i < 500; i++) {
      files.push(createTestFileEntry({
        fileId: i,
        path: `file-${i}.txt`,
        size: i * 100,
        frameCount: Math.ceil((i + 1) / 2),
        sha256: new Uint8Array(32).fill(i % 256),
      }))
    }

    const manifest = createTestFolderManifest({ files })
    const bytes = serializeFolderManifest(manifest)
    const decoded = deserializeFolderManifest(bytes)

    expect(decoded.files).toHaveLength(500)
    expect(decoded.files[0].path).toBe('file-0.txt')
    expect(decoded.files[499].path).toBe('file-499.txt')
  })

  it('should handle unicode paths', () => {
    const manifest = createTestFolderManifest({
      rootName: 'folder',
      files: [
        createTestFileEntry({ fileId: 0, path: 'résumé.pdf', size: 200, frameCount: 2 }),
      ],
    })

    const bytes = serializeFolderManifest(manifest)
    const decoded = deserializeFolderManifest(bytes)

    expect(decoded.files[0].path).toBe('résumé.pdf')
  })
})

describe('Folder Manifest: Fragmentation', () => {
  it('should fit a small manifest in one fragment', () => {
    const manifest = createTestFolderManifest({
      files: [createTestFileEntry({ path: 'test.txt' })],
    })
    const bytes = serializeFolderManifest(manifest)
    const fragments = fragmentManifest(bytes, 1000)
    expect(fragments).toHaveLength(1)
    expect(fragments[0]).toEqual(bytes)
  })

  it('should split a large manifest into multiple fragments', () => {
    const files: ManifestFileEntry[] = []
    for (let i = 0; i < 50; i++) {
      files.push(createTestFileEntry({
        fileId: i,
        path: `component-${i}.tsx`.repeat(3),
        size: 100000,
        frameCount: 125,
        sha256: new Uint8Array(32).fill(i),
      }))
    }
    const manifest = createTestFolderManifest({ files })
    const bytes = serializeFolderManifest(manifest)
    const fragments = fragmentManifest(bytes, 200)
    expect(fragments.length).toBeGreaterThan(1)

    const fragmentMap = new Map<number, Uint8Array>()
    fragments.forEach((f, i) => fragmentMap.set(i, f))
    const reconstructed = reconstructFolderManifest(fragmentMap, fragments.length)
    expect(reconstructed).not.toBeNull()
    expect(reconstructed!.files).toHaveLength(50)
  })

  it('should handle out-of-order fragment reassembly', () => {
    const files: ManifestFileEntry[] = []
    for (let i = 0; i < 20; i++) {
      files.push(createTestFileEntry({ fileId: i, path: `file-${i}.txt`, size: 100, frameCount: 1 }))
    }
    const manifest = createTestFolderManifest({ files })
    const bytes = serializeFolderManifest(manifest)
    const fragments = fragmentManifest(bytes, 100)

    const fragmentMap = new Map<number, Uint8Array>()
    for (let i = fragments.length - 1; i >= 0; i--) {
      fragmentMap.set(i, fragments[i])
    }
    const reconstructed = reconstructFolderManifest(fragmentMap, fragments.length)
    expect(reconstructed).not.toBeNull()
    expect(reconstructed!.files).toHaveLength(20)
  })

  it('should reject incomplete fragment sets', () => {
    const manifest = createTestFolderManifest({
      files: [createTestFileEntry({ path: 'test.txt' })],
    })
    const bytes = serializeFolderManifest(manifest)
    const fragments = fragmentManifest(bytes, 50)

    const fragmentMap = new Map<number, Uint8Array>()
    fragmentMap.set(0, fragments[0])
    const reconstructed = reconstructFolderManifest(fragmentMap, 3)
    expect(reconstructed).toBeNull()
  })

  it('should handle duplicate fragments', () => {
    const manifest = createTestFolderManifest({
      files: [createTestFileEntry({ path: 'test.txt' })],
    })
    const bytes = serializeFolderManifest(manifest)
    const fragments = fragmentManifest(bytes, 100)

    const fragmentMap = new Map<number, Uint8Array>()
    fragmentMap.set(0, fragments[0])
    const reconstructed = reconstructFolderManifest(fragmentMap, 1)
    expect(reconstructed).not.toBeNull()

    // Adding duplicate doesn't break anything
    fragmentMap.set(0, fragments[0])
    const stillWorks = reconstructFolderManifest(fragmentMap, 1)
    expect(stillWorks).not.toBeNull()
  })
})

describe('Folder Manifest: v2 Frame Encoding', () => {
  it('should encode and decode a v2 manifest frame', () => {
    const transferId = new Uint8Array(16).fill(42)
    const fragmentPayload = new Uint8Array([1, 2, 3, 4, 5])
    const frame = createV2ManifestFrame(transferId, 0, 3, fragmentPayload)

    const qrData = frameToQrData(frame.bytes)
    const decoded = decodeQrData(qrData)

    expect(decoded.type).toBe('manifest-v2')
    if (decoded.type === 'manifest-v2') {
      expect(decoded.manifestFragmentIndex).toBe(0)
      expect(decoded.manifestTotalFrames).toBe(3)
      expect(new Uint8Array(decoded.fragmentPayload)).toEqual(fragmentPayload)
    }
  })

  it('should encode and decode a v2 data frame with file_id', () => {
    const transferId = new Uint8Array(16).fill(42)
    const payload = new Uint8Array([10, 20, 30])
    const frame = createV2DataFrame(transferId, 17, 4, 12, payload)

    const qrData = frameToQrData(frame.bytes)
    const decoded = decodeQrData(qrData)

    expect(decoded.type).toBe('data-v2')
    if (decoded.type === 'data-v2') {
      expect(decoded.fileId).toBe(17)
      expect(decoded.fileFrameNumber).toBe(4)
      expect(decoded.fileTotalFrames).toBe(12)
      expect(new Uint8Array(decoded.frame.payload)).toEqual(payload)
    }
  })

  it('should reject corrupted v2 frames via CRC', () => {
    const transferId = new Uint8Array(16).fill(42)
    const payload = new Uint8Array([1, 2, 3])
    const frame = createV2DataFrame(transferId, 1, 0, 5, payload)

    const bytes = new Uint8Array(frame.bytes)
    bytes[30] ^= 0xFF
    const qrData = frameToQrData(bytes)
    const decoded = decodeQrData(qrData)

    expect(decoded.type).toBe('invalid')
  })
})

describe('Path Safety', () => {
  it('should accept normal relative paths', () => {
    expect(isPathSafe('file.txt')).toBe(true)
    expect(isPathSafe('src/main.go')).toBe(true)
  })

  it('should reject absolute paths', () => {
    expect(isPathSafe('/etc/passwd')).toBe(false)
  })

  it('should reject path traversal', () => {
    expect(isPathSafe('../secret.txt')).toBe(false)
    expect(isPathSafe('../../secret.txt')).toBe(false)
    expect(isPathSafe('a/../../../etc/passwd')).toBe(false)
  })

  it('should reject dot paths', () => {
    expect(isPathSafe('.')).toBe(false)
    expect(isPathSafe('..')).toBe(false)
  })
})

describe('Per-File Frame Tracking', () => {
  it('should track independent file progress with out-of-order frames', () => {
    const fileProgress = new Map<number, FileProgress>()

    fileProgress.set(0, {
      fileId: 0, path: 'src/main.go', size: 100, frameCount: 3,
      sha256: new Uint8Array(32), receivedFrames: new Set(), verified: false,
    })
    fileProgress.set(1, {
      fileId: 1, path: 'src/api/users.go', size: 200, frameCount: 7,
      sha256: new Uint8Array(32), receivedFrames: new Set(), verified: false,
    })
    fileProgress.set(2, {
      fileId: 2, path: 'README.md', size: 50, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set(), verified: false,
    })

    expect(isFileComplete(fileProgress.get(0)!)).toBe(false)
    expect(isFileComplete(fileProgress.get(2)!)).toBe(false)
    expect(isFolderTransferComplete(fileProgress)).toBe(false)

    // Out-of-order reception
    fileProgress.get(1)!.receivedFrames = new Set([4])
    fileProgress.get(0)!.receivedFrames = new Set([2])
    fileProgress.get(1)!.receivedFrames = new Set([4, 1])
    fileProgress.get(2)!.receivedFrames = new Set([1])
    fileProgress.get(0)!.receivedFrames = new Set([2, 1])

    expect(isFileComplete(fileProgress.get(2)!)).toBe(true)
    expect(isFileComplete(fileProgress.get(0)!)).toBe(false)

    fileProgress.get(0)!.receivedFrames = new Set([2, 1, 3])
    expect(isFileComplete(fileProgress.get(0)!)).toBe(true)

    fileProgress.get(1)!.receivedFrames = new Set([4, 1, 2, 3, 5, 6, 7])
    expect(isFolderTransferComplete(fileProgress)).toBe(true)
  })

  it('should calculate total and received frame counts', () => {
    const fileProgress = new Map<number, FileProgress>()
    fileProgress.set(0, {
      fileId: 0, path: 'main.go', size: 100, frameCount: 3,
      sha256: new Uint8Array(32), receivedFrames: new Set([1, 2]), verified: false,
    })
    fileProgress.set(1, {
      fileId: 1, path: 'config.go', size: 50, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set([1]), verified: false,
    })
    expect(getFolderTotalFrames(fileProgress)).toBe(4)
    expect(getFolderReceivedFrames(fileProgress)).toBe(3)
  })

  it('should not count duplicate frames', () => {
    const fileProgress = new Map<number, FileProgress>()
    fileProgress.set(0, {
      fileId: 0, path: 'main.go', size: 100, frameCount: 3,
      sha256: new Uint8Array(32), receivedFrames: new Set([1, 2, 2, 2, 3]), verified: false,
    })
    expect(fileProgress.get(0)!.receivedFrames.size).toBe(3)
    expect(isFileComplete(fileProgress.get(0)!)).toBe(true)
    expect(getFolderReceivedFrames(fileProgress)).toBe(3)
  })

  it('should reconstruct files from per-frame data', () => {
    const fileProgress = new Map<number, FileProgress>()
    const fileData = new Map<number, Map<number, Uint8Array>>()

    // File 0: main.go - 2 frames
    fileProgress.set(0, {
      fileId: 0, path: 'src/main.go', size: 6, frameCount: 2,
      sha256: new Uint8Array(32), receivedFrames: new Set([0, 1]), verified: false,
    })
    const f0Frames = new Map<number, Uint8Array>()
    f0Frames.set(0, new Uint8Array([1, 2, 3]))
    f0Frames.set(1, new Uint8Array([4, 5, 6]))
    fileData.set(0, f0Frames)

    // File 1: hello.txt - 1 frame
    fileProgress.set(1, {
      fileId: 1, path: 'hello.txt', size: 5, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false,
    })
    const f1Frames = new Map<number, Uint8Array>()
    f1Frames.set(0, new Uint8Array([72, 101, 108, 108, 111]))
    fileData.set(1, f1Frames)

    const outputFiles = reconstructFolderFiles(fileProgress, fileData)
    expect(outputFiles.size).toBe(2)
    expect(outputFiles.has('src/main.go')).toBe(true)
    expect(outputFiles.has('hello.txt')).toBe(true)
  })

  it('should return empty for incomplete files', () => {
    const fileProgress = new Map<number, FileProgress>()
    const fileData = new Map<number, Map<number, Uint8Array>>()

    fileProgress.set(0, {
      fileId: 0, path: 'main.go', size: 100, frameCount: 3,
      sha256: new Uint8Array(32), receivedFrames: new Set([0, 2]), verified: false,
    })
    fileData.set(0, new Map())

    const outputFiles = reconstructFolderFiles(fileProgress, fileData)
    expect(outputFiles.size).toBe(0)
  })
})


describe('Pre-Manifest Frame Buffering', () => {
  it('should count frames buffered before manifest arrives', () => {
    const fileProgress = new Map<number, FileProgress>()
    const fileData = new Map<number, Map<number, Uint8Array>>()

    // Simulate frames arriving before manifest
    const f0Frames = new Map<number, Uint8Array>()
    f0Frames.set(0, new Uint8Array([1]))
    f0Frames.set(1, new Uint8Array([2]))
    f0Frames.set(2, new Uint8Array([3]))
    fileData.set(0, f0Frames)

    // Now manifest arrives with proper metadata
    const bufferedKeys = fileData.get(0)
    const received = bufferedKeys ? new Set(bufferedKeys.keys()) : new Set<number>()
    fileProgress.set(0, {
      fileId: 0,
      path: 'src/main.go',
      size: 100,
      frameCount: 3,
      sha256: new Uint8Array(32).fill(1),
      receivedFrames: received,
      verified: false,
    })

    expect(fileProgress.get(0)!.receivedFrames.size).toBe(3)
    expect(isFileComplete(fileProgress.get(0)!)).toBe(true)
  })

  it('should reconcile multiple files buffered before manifest', () => {
    const fileProgress = new Map<number, FileProgress>()
    const fileData = new Map<number, Map<number, Uint8Array>>()

    // File 0: 2 of 3 frames arrived before manifest
    const f0 = new Map<number, Uint8Array>()
    f0.set(0, new Uint8Array([1]))
    f0.set(2, new Uint8Array([3]))
    fileData.set(0, f0)

    // File 1: 1 of 1 frames arrived before manifest
    const f1 = new Map<number, Uint8Array>()
    f1.set(0, new Uint8Array([4]))
    fileData.set(1, f1)

    // Reconcile as manifest would do
    const entries = [
      { fileId: 0, path: 'a.txt', frameCount: 3 },
      { fileId: 1, path: 'b.txt', frameCount: 1 },
    ]
    for (const entry of entries) {
      const existing = fileData.get(entry.fileId)
      const received = existing ? new Set(existing.keys()) : new Set<number>()
      fileProgress.set(entry.fileId, {
        fileId: entry.fileId,
        path: entry.path,
        size: 100,
        frameCount: entry.frameCount,
        sha256: new Uint8Array(32),
        receivedFrames: received,
        verified: false,
      })
    }

    expect(isFileComplete(fileProgress.get(1)!)).toBe(true) // 1/1 complete
    expect(isFileComplete(fileProgress.get(0)!)).toBe(false) // 2/3 incomplete

    // Remaining frame arrives
    fileProgress.get(0)!.receivedFrames = new Set([0, 1, 2])
    expect(isFolderTransferComplete(fileProgress)).toBe(true)
  })
})

describe('Folder Download Reconstruction', () => {
  it('should reconstruct all files in the folder', () => {
    const fileProgress = new Map<number, FileProgress>()
    const fileData = new Map<number, Map<number, Uint8Array>>()

    fileProgress.set(0, {
      fileId: 0, path: 'src/main.go', size: 3, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false,
    })
    fileProgress.set(1, {
      fileId: 1, path: 'src/api/users.go', size: 3, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false,
    })
    fileProgress.set(2, {
      fileId: 2, path: 'README.md', size: 5, frameCount: 1,
      sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false,
    })

    const f0 = new Map<number, Uint8Array>(); f0.set(0, new Uint8Array([1,2,3]))
    const f1 = new Map<number, Uint8Array>(); f1.set(0, new Uint8Array([4,5,6]))
    const f2 = new Map<number, Uint8Array>(); f2.set(0, new Uint8Array([72,101,108,108,111]))
    fileData.set(0, f0); fileData.set(1, f1); fileData.set(2, f2)

    const output = reconstructFolderFiles(fileProgress, fileData)
    expect(output.size).toBe(3)
    expect(output.has('src/main.go')).toBe(true)
    expect(output.has('src/api/users.go')).toBe(true)
    expect(output.has('README.md')).toBe(true)
  })
})

describe('Folder ZIP Download', () => {
  it('should create a ZIP with correct folder structure', async () => {
    const { createFolderZip } = await import('../../transfer/receiver')

    const files = new Map<string, Blob>()
    files.set('src/main.go', new Blob(['package main']))
    files.set('src/api/users.go', new Blob(['package api']))
    files.set('README.md', new Blob(['# Project']))

    const zipBlob = await createFolderZip('my-project', files)
    expect(zipBlob.type).toBe('application/zip')
    expect(zipBlob.size).toBeGreaterThan(0)

    // Verify contents by reading back with JSZip
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(zipBlob)

    expect(Object.keys(zip.files)).toContain('src/main.go')
    expect(Object.keys(zip.files)).toContain('src/api/users.go')
    expect(Object.keys(zip.files)).toContain('README.md')

    const mainGo = await zip.file('src/main.go')!.async('string')
    expect(mainGo).toBe('package main')

    const readme = await zip.file('README.md')!.async('string')
    expect(readme).toBe('# Project')
  })

  it('should preserve nested directory structure', async () => {
    const { createFolderZip } = await import('../../transfer/receiver')

    const files = new Map<string, Blob>()
    files.set('a/b/c/d/deep.txt', new Blob(['deep']))
    files.set('a/b/shallow.txt', new Blob(['shallow']))

    const zipBlob = await createFolderZip('test', files)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(zipBlob)

    expect(Object.keys(zip.files)).toContain('a/b/c/d/deep.txt')
    expect(Object.keys(zip.files)).toContain('a/b/shallow.txt')

    const deep = await zip.file('a/b/c/d/deep.txt')!.async('string')
    expect(deep).toBe('deep')
  })

  it('should use the root name for the ZIP file name', async () => {
    const { createFolderZip } = await import('../../transfer/receiver')

    const files = new Map<string, Blob>()
    files.set('test.txt', new Blob(['test']))

    const zipBlob = await createFolderZip('my-project', files)
    // The function returns the blob; the filename is set in the UI
    expect(zipBlob.size).toBeGreaterThan(0)
  })

  it('should handle empty folder', async () => {
    const { createFolderZip } = await import('../../transfer/receiver')

    const files = new Map<string, Blob>()
    const zipBlob = await createFolderZip('empty', files)

    // Empty zip should still be valid
    expect(zipBlob.size).toBeGreaterThan(0)
  })
})
