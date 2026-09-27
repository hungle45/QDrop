import { describe, it, expect } from 'vitest'
import { parseMissingFrameList, parseFrameRange, formatFrameRanges } from '../../transfer/range-parser'

/**
 * Helper tests that validate the full retransmission pipeline:
 * parsing input → selecting frames → formatting output.
 *
 * These test the core logic that `submitMissingFrames` uses internally,
 * without requiring React hooks.
 */

describe('Retransmission frame selection (file mode)', () => {
  // Simulate the sender's frames array for a file transfer
  // frames[0] = manifest (isManifest=true, number=0)
  // frames[1] = data frame #1 (isManifest=false, number=1)
  // frames[2] = data frame #2 (isManifest=false, number=2)
  // ...
  function makeFileFrames(count: number) {
    const frames: Array<{ isManifest: boolean; number: number; fileId?: number }> = [
      { isManifest: true, number: 0 },
    ]
    for (let i = 1; i <= count; i++) {
      frames.push({ isManifest: false, number: i })
    }
    return frames
  }

  function selectFramesFile(
    allFrames: Array<{ isManifest: boolean; number: number; fileId?: number }>,
    input: string,
  ) {
    const parsed = parseMissingFrameList(input)
    const missingFrames = parsed.get('')
    if (!missingFrames) return []

    return allFrames.filter((frame) => {
      if (frame.isManifest) return false
      // frame.number is 1-indexed for v1 data frames
      // missingFrames contains 0-indexed numbers
      return missingFrames.has(frame.number - 1)
    })
  }

  it('should select a single frame range', () => {
    const frames = makeFileFrames(10)
    const selected = selectFramesFile(frames, '3-5')
    // 3-5 (1-indexed) → {2,3,4} (0-indexed) → frames[3], frames[4], frames[5]
    expect(selected).toHaveLength(3)
    expect(selected.map((f) => f.number)).toEqual([3, 4, 5])
  })

  it('should skip the manifest frame', () => {
    const frames = makeFileFrames(5)
    const selected = selectFramesFile(frames, '1-5')
    // All data frames selected, manifest excluded
    expect(selected).toHaveLength(5)
    expect(selected.every((f) => !f.isManifest)).toBe(true)
  })

  it('should select a mix of ranges and single frames', () => {
    const frames = makeFileFrames(20)
    const selected = selectFramesFile(frames, '1-4,7,10-12')
    // frames[1,2,3,4,7,10,11,12]
    expect(selected).toHaveLength(8)
    expect(selected.map((f) => f.number)).toEqual([1, 2, 3, 4, 7, 10, 11, 12])
  })

  it('should handle single-frame ranges', () => {
    const frames = makeFileFrames(10)
    const selected = selectFramesFile(frames, '5')
    expect(selected).toHaveLength(1)
    expect(selected[0].number).toBe(5)
  })

  it('should return empty for non-matching range', () => {
    const frames = makeFileFrames(5)
    const selected = selectFramesFile(frames, '99-100')
    expect(selected).toHaveLength(0)
  })

  it('should handle overlapping ranges — deduplicated', () => {
    const frames = makeFileFrames(10)
    const selected = selectFramesFile(frames, '1-5,3-7')
    // 1-5 → {0,1,2,3,4}, 3-7 → {2,3,4,5,6}
    // Combined → {0,1,2,3,4,5,6}
    // frames[1..7]
    expect(selected).toHaveLength(7)
    expect(selected.map((f) => f.number)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('should handle reversed ranges gracefully', () => {
    const frames = makeFileFrames(10)
    const selected = selectFramesFile(frames, '5-1')
    // Reversed → {0,1,2,3,4} → frames[1..5]
    expect(selected).toHaveLength(5)
    expect(selected.map((f) => f.number)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('Retransmission frame selection (folder mode)', () => {
  // Simulate folder frames with fileId and per-file frame numbers (0-indexed)
  function makeFolderFrames(files: Array<{ fileId: number; frameCount: number }>) {
    const frames: Array<{ isManifest: boolean; number: number; fileId?: number }> = []
    // Add manifest fragments (skipped in retransmit)
    const manifestCount = 2
    for (let i = 0; i < manifestCount; i++) {
      frames.push({ isManifest: true, number: i })
    }
    // Add data frames per file
    for (const file of files) {
      for (let i = 0; i < file.frameCount; i++) {
        frames.push({
          isManifest: false,
          number: i,
          fileId: file.fileId,
        })
      }
    }
    return frames
  }

  const folderManifest = {
    files: [
      { fileId: 0, path: 'src/main.go', frameCount: 10 },
      { fileId: 1, path: 'src/config.go', frameCount: 8 },
      { fileId: 2, path: 'src/utils/hash.go', frameCount: 12 },
    ],
  }

  function selectFramesFolder(
    allFrames: Array<{ isManifest: boolean; number: number; fileId?: number }>,
    folderManifest: { files: Array<{ fileId: number; path: string }> },
    input: string,
  ) {
    const parsed = parseMissingFrameList(input)
    if (parsed.size === 0) return []

    // Build fileId lookup
    const fileIdByPath = new Map<string, number>()
    for (const file of folderManifest.files) {
      fileIdByPath.set(file.path, file.fileId)
    }

    const missingByFileId = new Map<number, Set<number>>()
    for (const [path, frames] of parsed) {
      const fileId = fileIdByPath.get(path)
      if (fileId === undefined) return []
      missingByFileId.set(fileId, frames)
    }

    return allFrames.filter((frame) => {
      if (frame.isManifest) return false
      if (frame.fileId === undefined) return false
      const missing = missingByFileId.get(frame.fileId)
      if (!missing) return false
      // frame.number is 0-indexed per-file
      return missing.has(frame.number)
    })
  }

  it('should select frames from a single file', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'src/main.go:1-3')
    // 1-3 (1-indexed) → {0,1,2} (0-indexed) → 3 frames from main.go
    expect(selected).toHaveLength(3)
    expect(selected.every((f) => f.fileId === 0)).toBe(true)
    expect(selected.map((f) => f.number)).toEqual([0, 1, 2])
  })

  it('should skip manifest frames', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'src/main.go:1-5')
    expect(selected.every((f) => !f.isManifest)).toBe(true)
  })

  it('should select frames from multiple files', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const input = 'src/main.go:1-3,7\nsrc/config.go:2,5-6'
    const selected = selectFramesFolder(allFrames, folderManifest, input)
    // main.go: 1-3→{0,1,2}, 7→{6} = 4 frames
    // config.go: 2→{1}, 5-6→{4,5} = 3 frames
    // Total = 7 frames
    expect(selected).toHaveLength(7)

    const mainFrames = selected.filter((f) => f.fileId === 0)
    const configFrames = selected.filter((f) => f.fileId === 1)

    expect(mainFrames).toHaveLength(4)
    expect(mainFrames.map((f) => f.number)).toEqual([0, 1, 2, 6])

    expect(configFrames).toHaveLength(3)
    expect(configFrames.map((f) => f.number)).toEqual([1, 4, 5])
  })

  it('should handle overlapping ranges within a file', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'src/main.go:1-5,3-7')
    // {0,1,2,3,4,5,6} → 7 frames
    expect(selected).toHaveLength(7)
    expect(selected.every((f) => f.fileId === 0)).toBe(true)
  })

  it('should handle single-frame ranges in folder mode', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'src/utils/hash.go:8')
    // 8 (1-indexed) → {7} (0-indexed)
    expect(selected).toHaveLength(1)
    expect(selected[0].fileId).toBe(2)
    expect(selected[0].number).toBe(7)
  })

  it('should return empty for unknown file path', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'nonexistent.go:1-3')
    expect(selected).toHaveLength(0)
  })

  it('should return empty for invalid input', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, 'invalid')
    expect(selected).toHaveLength(0)
  })

  it('should return empty for empty input', () => {
    const allFrames = makeFolderFrames(folderManifest.files)
    const selected = selectFramesFolder(allFrames, folderManifest, '')
    expect(selected).toHaveLength(0)
  })
})

describe('Full cycle: parse → format roundtrip', () => {
  it('should roundtrip file mode ranges', () => {
    const input = '1-4,7,10-12'
    const parsed = parseMissingFrameList(input)
    expect(parsed.size).toBe(1)
    expect(parsed.has('')).toBe(true)
    const formatted = formatFrameRanges(parsed.get('')!)
    expect(formatted).toBe(input)
  })

  it('should roundtrip folder mode ranges', () => {
    const input = 'src/main.go:1-3,7\nsrc/config.go:2,5-6'
    const parsed = parseMissingFrameList(input)
    expect(parsed.size).toBe(2)
    const lines: string[] = []
    for (const [path, frames] of parsed) {
      lines.push(`${path}:${formatFrameRanges(frames)}`)
    }
    const formatted = lines.join('\n')
    // Sort might differ, so compare sets
    expect(parsed.get('src/main.go')).toBeDefined()
    expect(parsed.get('src/config.go')).toBeDefined()
    expect(formatFrameRanges(parsed.get('src/main.go')!)).toBe('1-3,7')
    expect(formatFrameRanges(parsed.get('src/config.go')!)).toBe('2,5-6')
  })

  it('should handle duplicate and overlapping ranges in roundtrip', () => {
    // "1-5,3-8" has overlap and would be deduplicated by parseFrameRange
    const parsed = parseFrameRange('1-5,3-8')
    // 1-5 → {0,1,2,3,4}, 3-8 → {2,3,4,5,6,7}
    // Combined → {0,1,2,3,4,5,6,7} → formatted as '1-8'
    expect(formatFrameRanges(parsed)).toBe('1-8')
  })
})