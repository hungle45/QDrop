import { describe, it, expect } from 'vitest'
import {
  serializeFolderManifest, deserializeFolderManifest,
  fragmentManifest, reconstructFolderManifest, isPathSafe,
} from '../../protocol/manifest-v2'
import { createV2ManifestFrame, createV2DataFrame, frameToQrData } from '../../protocol/encoder'
import { decodeQrData } from '../../protocol/decoder'
import {
  isFolderTransferComplete, isFileComplete,
  getFolderTotalFrames, getFolderReceivedFrames,
} from '../../transfer/receiver'
import { type FolderManifest, type ManifestFileEntry } from '../../protocol/types'

function mf(ov: Partial<FolderManifest> = {}): FolderManifest {
  return { transferId: new Uint8Array(16).fill(42), rootName: 'p', files: [], ...ov }
}
function me(ov: Partial<ManifestFileEntry> = {}): ManifestFileEntry {
  return { fileId: 0, path: 't.txt', size: 100, frameCount: 2, sha256: new Uint8Array(32).fill(0xAB), ...ov }
}

// ============== Serialization ==============
describe('Serialization', () => {
  it('encodes/decodes small manifest', () => {
    const man = mf({ files: [me({ fileId: 0, path: 'a.go', size: 100, frameCount: 1 })] })
    const d = deserializeFolderManifest(serializeFolderManifest(man))
    expect(d.files).toHaveLength(1); expect(d.files[0].path).toBe('a.go')
  })
  it('preserves hierarchy', () => {
    const d = deserializeFolderManifest(serializeFolderManifest(mf({
      files: [me({ fileId: 0, path: 'src/a.go' }), me({ fileId: 1, path: 'src/api/b.go' }), me({ fileId: 2, path: 'README.md' })],
    })))
    expect(d.files.map(f => f.path)).toEqual(['src/a.go', 'src/api/b.go', 'README.md'])
  })
  it('handles 500 files', () => {
    const files: ManifestFileEntry[] = Array.from({ length: 500 }, (_, i) => me({ fileId: i, path: 'f-' + i + '.txt' }))
    expect(deserializeFolderManifest(serializeFolderManifest(mf({ files }))).files).toHaveLength(500)
  })
})

// ============== Fragmentation ==============
describe('Fragmentation', () => {
  it('fits one fragment', () => {
    expect(fragmentManifest(serializeFolderManifest(mf({ files: [me()] })), 1000)).toHaveLength(1)
  })
  it('spits large manifest', () => {
    const files: ManifestFileEntry[] = Array.from({ length: 50 }, (_, i) => me({ fileId: i, path: 'x-'.repeat(10) + i }))
    const frags = fragmentManifest(serializeFolderManifest(mf({ files })), 100)
    expect(frags.length).toBeGreaterThan(1)
    const m = new Map<number, Uint8Array>(); frags.forEach((f, i) => m.set(i, f))
    expect(reconstructFolderManifest(m, frags.length)!.files).toHaveLength(50)
  })
  it('rejects incomplete', () => {
    const m = new Map<number, Uint8Array>()
    m.set(0, fragmentManifest(serializeFolderManifest(mf({ files: [me()] })), 50)[0])
    expect(reconstructFolderManifest(m, 3)).toBeNull()
  })
  it('handles duplicates', () => {
    const b = serializeFolderManifest(mf({ files: [me()] }))
    const m = new Map<number, Uint8Array>(); m.set(0, fragmentManifest(b, 100)[0])
    expect(reconstructFolderManifest(m, 1)).not.toBeNull()
    m.set(0, fragmentManifest(b, 100)[0])
    expect(reconstructFolderManifest(m, 1)).not.toBeNull()
  })
})

// ============== v2 Frames ==============
describe('v2 Frames', () => {
  it('manifest frame', () => {
    const tid = new Uint8Array(16).fill(1)
    const r = decodeQrData(frameToQrData(createV2ManifestFrame(tid, 1, 3, new Uint8Array([1, 2, 3])).bytes))
    expect(r.type).toBe('manifest-v2')
    if (r.type === 'manifest-v2') {
      expect(r.manifestFragmentIndex).toBe(1); expect(r.manifestTotalFrames).toBe(3)
    }
  })
  it('data frame with file_id', () => {
    const r = decodeQrData(frameToQrData(createV2DataFrame(new Uint8Array(16).fill(2), 7, 2, 5, new Uint8Array([1, 2, 3])).bytes))
    expect(r.type).toBe('data-v2')
    if (r.type === 'data-v2') {
      expect(r.fileId).toBe(7); expect(r.fileFrameNumber).toBe(2); expect(r.fileTotalFrames).toBe(5)
    }
  })
  it('rejects corrupt CRC', () => {
    const b = new Uint8Array(createV2DataFrame(new Uint8Array(16).fill(3), 1, 0, 5, new Uint8Array([1, 2, 3])).bytes)
    b[30] ^= 0xFF
    expect(decodeQrData(frameToQrData(b)).type).toBe('invalid')
  })
})

// ============== Path Safety ==============
describe('Path Safety', () => {
  it('accepts relative', () => { expect(isPathSafe('a/b/c.txt')).toBe(true) })
  it('rejects absolute', () => { expect(isPathSafe('/etc/passwd')).toBe(false) })
  it('rejects traversal', () => {
    expect(isPathSafe('../x')).toBe(false); expect(isPathSafe('a/../../../x')).toBe(false)
  })
  it('rejects dots', () => { expect(isPathSafe('.')).toBe(false); expect(isPathSafe('..')).toBe(false) })
})

// ============== Per-File Tracking ==============
describe('Per-File Tracking', () => {
  it('tracks independent progress', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    fp.set(0, { fileId: 0, path: 'a', size: 100, frameCount: 3, sha256: new Uint8Array(32), receivedFrames: new Set(), verified: false })
    fp.set(1, { fileId: 1, path: 'b', size: 200, frameCount: 1, sha256: new Uint8Array(32), receivedFrames: new Set(), verified: false })
    expect(isFolderTransferComplete(fp)).toBe(false)
    fp.get(0)!.receivedFrames = new Set([0, 2]); fp.get(1)!.receivedFrames = new Set([0])
    expect(isFileComplete(fp.get(1)!)).toBe(true); expect(isFileComplete(fp.get(0)!)).toBe(false)
    fp.get(0)!.receivedFrames = new Set([0, 1, 2])
    expect(isFolderTransferComplete(fp)).toBe(true)
  })
  it('calculates totals', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    fp.set(0, { fileId: 0, path: 'a', size: 100, frameCount: 3, sha256: new Uint8Array(32), receivedFrames: new Set([0, 1]), verified: false })
    expect(getFolderTotalFrames(fp)).toBe(3); expect(getFolderReceivedFrames(fp)).toBe(2)
  })
  it('deduplicates via Set', () => {
    const p: import('../../transfer/receiver').FileProgress = {
      fileId: 0, path: 'a', size: 100, frameCount: 3, sha256: new Uint8Array(32),
      receivedFrames: new Set([0, 0, 0, 1, 2, 2]), verified: false,
    }
    expect(p.receivedFrames.size).toBe(3)
  })
})

// ============== Pre-Manifest ==============
describe('Pre-Manifest', () => {
  it('reconciles buffered frames', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    const fd = new Map<number, Map<number, Uint8Array>>()
    // Pre-manifest data stored in fd
    const f0 = new Map<number, Uint8Array>(); f0.set(0, new Uint8Array([1])); f0.set(1, new Uint8Array([2]))
    fd.set(0, f0)
    const f1 = new Map<number, Uint8Array>(); f1.set(0, new Uint8Array([3]))
    fd.set(1, f1)
    // Manifest arrives
    const man = mf({ files: [me({ fileId: 0, path: 'a.txt', frameCount: 2 }), me({ fileId: 1, path: 'b.txt', frameCount: 1 })] })
    for (const f of man.files) {
      const ef = fd.get(f.fileId)
      const rec = ef ? new Set(ef.keys()) : new Set<number>()
      fp.set(f.fileId, { fileId: f.fileId, path: f.path, size: f.size, frameCount: f.frameCount, sha256: f.sha256, receivedFrames: rec, verified: false })
    }
    expect(fp.get(0)!.receivedFrames.size).toBe(2)
    expect(fp.get(0)!.path).toBe('a.txt')
    expect(fp.get(1)!.receivedFrames.size).toBe(1)
    expect(isFolderTransferComplete(fp)).toBe(true)
  })
  it('reconciles incomplete buffer', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    const fd = new Map<number, Map<number, Uint8Array>>()
    const f0 = new Map<number, Uint8Array>(); f0.set(0, new Uint8Array([1]))
    fd.set(0, f0)
    const man = mf({ files: [me({ fileId: 0, path: 'a.txt', frameCount: 3 })] })
    for (const f of man.files) {
      const ef = fd.get(f.fileId)
      const rec = ef ? new Set(ef.keys()) : new Set<number>()
      fp.set(f.fileId, { fileId: f.fileId, path: f.path, size: f.size, frameCount: f.frameCount, sha256: f.sha256, receivedFrames: rec, verified: false })
    }
    expect(isFileComplete(fp.get(0)!)).toBe(false)
    expect(isFolderTransferComplete(fp)).toBe(false)
  })
})

// ============== Duplicates ==============
describe('Duplicates', () => {
  it('zero for first frame', () => {
    let dup = 0; const s = new Set<number>()
    if (!s.has(0)) { s.add(0) } else { dup++ }
    expect(dup).toBe(0)
  })
  it('one for duplicate', () => {
    let dup = 0; const s = new Set<number>([0])
    if (!s.has(0)) { s.add(0) } else { dup++ }
    expect(dup).toBe(1)
  })
  it('independent per file', () => {
    let dup = 0
    const f0 = new Set<number>(); const f1 = new Set<number>()
    if (f0.has(0)) dup++; else f0.add(0)
    if (f1.has(0)) dup++; else f1.add(0)
    expect(dup).toBe(0) // first for both
    if (f0.has(0)) dup++; else f0.add(0)
    if (f1.has(0)) dup++; else f1.add(0)
    expect(dup).toBe(2) // duplicate for both
  })
  it('out-of-order not counted as dup', () => {
    let dup = 0; const s = new Set<number>()
    const frames = [2, 0, 1, 0, 2, 1]
    for (const f of frames) {
      if (s.has(f)) dup++; else s.add(f)
    }
    expect(s.size).toBe(3)
    expect(dup).toBe(3)
  })
})

// ============== Completion ==============
describe('Completion', () => {
  it('checks all files', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    fp.set(0, { fileId: 0, path: 'a', size: 100, frameCount: 2, sha256: new Uint8Array(32), receivedFrames: new Set([0, 1]), verified: false })
    fp.set(1, { fileId: 1, path: 'b', size: 200, frameCount: 1, sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false })
    expect(isFolderTransferComplete(fp)).toBe(true)
  })
  it('incomplete if one file missing frames', () => {
    const fp = new Map<number, import('../../transfer/receiver').FileProgress>()
    fp.set(0, { fileId: 0, path: 'a', size: 100, frameCount: 2, sha256: new Uint8Array(32), receivedFrames: new Set([0]), verified: false })
    expect(isFolderTransferComplete(fp)).toBe(false)
  })
  it('empty progress is not complete', () => {
    expect(isFolderTransferComplete(new Map())).toBe(false)
  })
})

// ============== ZIP Download ==============
describe('ZIP', () => {
  it('creates valid zip', async () => {
    const { createFolderZip } = await import('../../transfer/receiver')
    const files = new Map<string, Blob>()
    files.set('src/main.go', new Blob(['package main']))
    files.set('README.md', new Blob(['# Project']))
    const blob = await createFolderZip('p', files)
    expect(blob.type).toBe('application/zip')
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(blob)
    expect(Object.keys(zip.files)).toContain('src/main.go')
    expect(Object.keys(zip.files)).toContain('README.md')
  })
})