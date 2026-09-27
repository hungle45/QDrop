import { describe, it, expect } from 'vitest'
import {
  parseFrameRange,
  parseMissingFrameList,
  formatFrameRanges,
  formatMissingFrameList,
  formatDisplayMissingFrames,
  computeMissingFramesFile,
  computeMissingFramesFolder,
} from '../../transfer/range-parser'

const numSort = (a: number, b: number) => a - b
const sorted = (s: Set<number>) => Array.from(s).sort(numSort)

/**
 * Helper: parse with 1-indexed and return sorted array.
 * parseFrameRange returns 0-indexed (input→output: 1-indexed→0-indexed).
 * So "1-4" → [0, 1, 2, 3].
 */
const p = (s: string) => sorted(parseFrameRange(s))

describe('parseFrameRange', () => {
  it('should parse a single range (1-indexed to 0-indexed)', () => {
    expect(p('1-4')).toEqual([0, 1, 2, 3])
  })

  it('should parse individual numbers', () => {
    expect(p('1,3,5')).toEqual([0, 2, 4])
  })

  it('should parse a mix of ranges and single numbers', () => {
    // 1-4 → [0,1,2,3], 7 → [6], 10-12 → [9,10,11]
    expect(p('1-4,7,10-12')).toEqual([0, 1, 2, 3, 6, 9, 10, 11])
  })

  it('should handle overlapping and duplicate ranges', () => {
    expect(p('1-5,3-8')).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('should handle reversed ranges', () => {
    expect(p('5-1')).toEqual([0, 1, 2, 3, 4])
  })

  it('should handle single-frame ranges', () => {
    expect(p('3')).toEqual([2])
  })

  it('should handle empty input', () => {
    expect(parseFrameRange('').size).toBe(0)
  })

  it('should handle whitespace between items', () => {
    expect(p('1-3, 5, 7-9')).toEqual([0, 1, 2, 4, 6, 7, 8])
  })

  it('should return empty set for invalid input', () => {
    expect(parseFrameRange('abc').size).toBe(0)
  })

  it('should return empty set for partially invalid input', () => {
    expect(parseFrameRange('1-3,abc,5').size).toBe(0)
  })

  it('should handle duplicate numbers', () => {
    expect(p('1-3,2-4')).toEqual([0, 1, 2, 3])
  })

  it('should handle a large range', () => {
    const result = parseFrameRange('1-100')
    expect(result.size).toBe(100)
    expect(result.has(0)).toBe(true)
    expect(result.has(99)).toBe(true)
  })
})

describe('parseMissingFrameList', () => {
  it('should parse file mode input (single line without colon)', () => {
    const result = parseMissingFrameList('1-4,7,10-12')
    expect(result.size).toBe(1)
    expect(result.has('')).toBe(true)
    // 1-indexed → 0-indexed: 1-4→[0,1,2,3], 7→[6], 10-12→[9,10,11]
    expect(sorted(result.get('')!)).toEqual([0, 1, 2, 3, 6, 9, 10, 11])
  })

  it('should parse folder mode input with paths', () => {
    const input = 'src/main.go:1-3,7\nsrc/config.go:2,5-6'
    const result = parseMissingFrameList(input)
    expect(result.size).toBe(2)
    // 1-3→[0,1,2], 7→[6]
    expect(sorted(result.get('src/main.go')!)).toEqual([0, 1, 2, 6])
    // 2→[1], 5-6→[4,5]
    expect(sorted(result.get('src/config.go')!)).toEqual([1, 4, 5])
  })

  it('should parse @manifest in file mode', () => {
    const result = parseMissingFrameList('2, 2-7, @manifest')
    // @manifest stored as key with empty set
    // 2→[1], 2-7→[1,2,3,4,5,6] combined = [1,2,3,4,5,6]
    expect(result.get('@manifest')).toBeDefined()
    expect(result.get('@manifest')!.size).toBe(0)
    expect(sorted(result.get('')!)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('should parse @manifest with no other frames in file mode', () => {
    const result = parseMissingFrameList('@manifest')
    expect(result.get('@manifest')).toBeDefined()
    expect(result.has('')).toBe(false)
  })

  it('should parse @manifest in folder mode (standalone line)', () => {
    const input = '@manifest\nsrc/main.go: 1-3, 7'
    const result = parseMissingFrameList(input)
    // @manifest on its own line → key '@manifest' with empty set (all manifest frames)
    expect(result.get('@manifest')).toBeDefined()
    expect(result.get('@manifest')!.size).toBe(0)
    expect(sorted(result.get('src/main.go')!)).toEqual([0, 1, 2, 6])
  })

  it('should parse @manifest: with colon in folder mode (gracefully handled)', () => {
    const input = '@manifest:\nsrc/main.go:1-3'
    const result = parseMissingFrameList(input)
    // @manifest: with or without colon → treated as manifest request
    expect(result.get('@manifest')).toBeDefined()
    expect(result.get('@manifest')!.size).toBe(0)
    expect(sorted(result.get('src/main.go')!)).toEqual([0, 1, 2])
  })

  it('should reject invalid input combined with file mode @manifest', () => {
    // "abc" is invalid, making parseFrameRange fail
    const result = parseMissingFrameList('abc, @manifest')
    expect(result.size).toBe(0)
  })

  it('should handle @manifest as the only item', () => {
    const input = '@manifest'
    const result = parseMissingFrameList(input)
    expect(result.size).toBe(1)
    expect(result.get('@manifest')).toBeDefined()
    expect(result.get('')).toBeUndefined()
  })

  it('should handle @manifest in folder mode alongside file paths', () => {
    const input = '@manifest\nsrc/config.go: 2,5-6'
    const result = parseMissingFrameList(input)
    expect(result.size).toBe(2)
    expect(result.get('@manifest')).toBeDefined()
    expect(result.get('@manifest')!.size).toBe(0)
    expect(sorted(result.get('src/config.go')!)).toEqual([1, 4, 5])
  })

  it('should handle empty lines in the input', () => {
    const input = 'src/main.go:1-3\n\nsrc/config.go:2-4'
    const result = parseMissingFrameList(input)
    expect(result.size).toBe(2)
    expect(sorted(result.get('src/main.go')!)).toEqual([0, 1, 2])
    expect(sorted(result.get('src/config.go')!)).toEqual([1, 2, 3])
  })

  it('should handle a single file in folder format', () => {
    const result = parseMissingFrameList('README.md:1')
    expect(result.size).toBe(1)
    expect(result.has('README.md')).toBe(true)
    expect(Array.from(result.get('README.md')!)).toEqual([0])
  })

  it('should return empty map for empty input', () => {
    const result = parseMissingFrameList('')
    expect(result.size).toBe(0)
  })

  it('should return empty map for input with only whitespace', () => {
    const result = parseMissingFrameList('   \n  ')
    expect(result.size).toBe(0)
  })
})

describe('formatFrameRanges', () => {
  it('should format consecutive numbers as a range (0-indexed → 1-indexed)', () => {
    expect(formatFrameRanges(new Set([0, 1, 2, 3, 6]))).toBe('1-4,7')
  })

  it('should format mix of ranges and singles', () => {
    expect(formatFrameRanges(new Set([0, 1, 2, 3, 6, 9, 10, 11]))).toBe('1-4,7,10-12')
  })

  it('should handle a single frame', () => {
    expect(formatFrameRanges(new Set([4]))).toBe('5')
  })

  it('should handle a single range', () => {
    expect(formatFrameRanges(new Set([0, 1, 2, 3, 4]))).toBe('1-5')
  })

  it('should return empty string for empty set', () => {
    expect(formatFrameRanges(new Set())).toBe('')
  })

  it('should sort unsorted input', () => {
    expect(formatFrameRanges(new Set([4, 0, 2, 1, 3]))).toBe('1-5')
  })

  it('should deduplicate input', () => {
    expect(formatFrameRanges(new Set([0, 0, 1, 2, 2]))).toBe('1-3')
  })

  it('should handle non-consecutive numbers', () => {
    expect(formatFrameRanges(new Set([0, 2, 4, 6]))).toBe('1,3,5,7')
  })
})

describe('formatMissingFrameList', () => {
  it('should format file mode (empty key)', () => {
    const map = new Map<string, Set<number>>()
    map.set('', new Set([0, 1, 2, 3, 6, 9, 10, 11]))
    expect(formatMissingFrameList(map)).toBe('1-4,7,10-12')
  })

  it('should format folder mode with multiple files', () => {
    const map = new Map<string, Set<number>>()
    map.set('src/main.go', new Set([0, 1, 2, 6]))
    map.set('src/config.go', new Set([1, 4, 5]))
    const result = formatMissingFrameList(map)
    expect(result).toBe('src/config.go:2,5-6\nsrc/main.go:1-3,7')
  })

  it('should return empty string for empty map', () => {
    expect(formatMissingFrameList(new Map())).toBe('')
  })
})

describe('formatDisplayMissingFrames', () => {
  it('should format file mode with spaces after commas', () => {
    const map = new Map<string, Set<number>>()
    map.set('', new Set([0, 1, 2, 3, 6, 9, 10, 11]))
    expect(formatDisplayMissingFrames(map)).toBe('1-4, 7, 10-12')
  })

  it('should format folder mode with aligned paths', () => {
    const map = new Map<string, Set<number>>()
    map.set('src/main.go', new Set([0, 1, 2, 6]))
    map.set('src/config.go', new Set([1, 4, 5]))
    map.set('src/utils/hash.go', new Set([3, 4, 5, 6, 7]))
    const result = formatDisplayMissingFrames(map)
    expect(result).toContain('src/config.go')
    expect(result).toContain('src/main.go')
    expect(result).toContain('src/utils/hash.go')
    expect(result).not.toContain(':')
  })
})

describe('computeMissingFramesFile', () => {
  it('should compute missing frames from received set (1-indexed keys → 0-indexed result)', () => {
    const received = new Map<number, Uint8Array>()
    received.set(1, new Uint8Array([1]))
    received.set(2, new Uint8Array([2]))
    received.set(5, new Uint8Array([5]))
    // totalFrames=5, received keys 1,2,5 → missing 0-indexed: [2, 3] (frames 3,4 in 1-indexed)
    const missing = computeMissingFramesFile(received, 5)
    expect(sorted(missing)).toEqual([2, 3])
  })

  it('should handle all frames received', () => {
    const received = new Map<number, Uint8Array>()
    for (let i = 1; i <= 3; i++) {
      received.set(i, new Uint8Array([i]))
    }
    const missing = computeMissingFramesFile(received, 3)
    expect(missing.size).toBe(0)
  })

  it('should handle no frames received', () => {
    const received = new Map<number, Uint8Array>()
    const missing = computeMissingFramesFile(received, 5)
    expect(missing.size).toBe(5)
    expect(sorted(missing)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('computeMissingFramesFolder', () => {
  it('should compute missing frames per file (0-indexed)', () => {
    const fileProgress = new Map<number, { path: string; frameCount: number; receivedFrames: Set<number> }>()
    fileProgress.set(0, {
      path: 'src/main.go',
      frameCount: 5,
      receivedFrames: new Set([0, 1, 3]),
    })
    fileProgress.set(1, {
      path: 'src/config.go',
      frameCount: 4,
      receivedFrames: new Set([1]),
    })
    const result = computeMissingFramesFolder(fileProgress)
    expect(result.size).toBe(2)
    expect(sorted(result.get('src/main.go')!)).toEqual([2, 4])
    expect(sorted(result.get('src/config.go')!)).toEqual([0, 2, 3])
  })

  it('should skip files with all frames received', () => {
    const fileProgress = new Map<number, { path: string; frameCount: number; receivedFrames: Set<number> }>()
    fileProgress.set(0, {
      path: 'src/main.go',
      frameCount: 3,
      receivedFrames: new Set([0, 1, 2]),
    })
    const result = computeMissingFramesFolder(fileProgress)
    expect(result.size).toBe(0)
  })

  it('should handle empty file progress', () => {
    const result = computeMissingFramesFolder(new Map())
    expect(result.size).toBe(0)
  })
})