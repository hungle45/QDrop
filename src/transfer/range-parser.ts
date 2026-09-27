/**
 * Range parser — parse and format compact frame ranges.
 *
 * Machine-readable format:
 *   File mode:  "1-4,7,10-12"
 *   Folder mode: "src/main.go:1-3,7\nsrc/config.go:2,5-6"
 *
 * Display format (with spaces after commas):
 *   File mode:  "1-4, 7, 10-12"
 *   Folder mode: "src/main.go   1-3, 7"
 */

/**
 * Parse a compact range string like "1-4,7,10-12" into a Set of numbers.
 * Handles single numbers, ranges, overlapping ranges, and unsorted input.
 * Returns 0-indexed frame numbers.
 */
export function parseFrameRange(range: string): Set<number> {
  const result = new Set<number>()

  if (!range) return result

  const parts = range.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // Check for "start-end" range
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      let start = parseInt(rangeMatch[1], 10)
      let end = parseInt(rangeMatch[2], 10)
      if (start > end) {
        // Swap to be forgiving
        const tmp = start
        start = end
        end = tmp
      }
      // Convert from 1-indexed to 0-indexed
      for (let i = start - 1; i < end; i++) {
        result.add(i)
      }
      continue
    }

    // Single number (1-indexed in input → 0-indexed in storage)
    const singleMatch = trimmed.match(/^(\d+)$/)
    if (singleMatch) {
      const val = parseInt(singleMatch[1], 10)
      if (val >= 1) {
        result.add(val - 1)
      }
      continue
    }

    // Invalid — return empty set to signal error
    return new Set<number>()
  }

  return result
}

/**
 * Parse a multi-line missing-frame list (folder mode) where each line is
 * "filePath:ranges". Returns a Map of file path → Set of frame numbers.
 *
 * For file mode (single-file), returns a single-entry map with key "".
 *
 * Supports @manifest:
 *   File mode:   "2, 2-7, @manifest"  → key "@manifest" with empty set + key "" with data frames
 *   Folder mode: "@manifest: 2, 5-7"  → key "@manifest" with manifest fragment indices
 */
export function parseMissingFrameList(input: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>()

  const lines = input.trim().split('\n')
  if (lines.length === 0) return result

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Handle @manifest: prefix (folder mode — manifest fragments)
    if (/^@manifest\s*:/.test(trimmed)) {
      const ranges = trimmed.replace(/^@manifest\s*:\s*/, '').trim()
      const frames = ranges ? parseFrameRange(ranges) : new Set<number>()
      if (ranges && frames.size === 0) return new Map()
      result.set('@manifest', frames)
      continue
    }

    // Check for "path:ranges" format
    const colonIndex = trimmed.lastIndexOf(':')
    if (colonIndex === -1) {
      // No colon — file mode: ranges and optional @manifest token
      const tokens = trimmed.split(',').map((t) => t.trim())
      const hasManifest = tokens.some((t) => t === '@manifest')
      const withoutManifest = tokens
        .filter((t) => t !== '@manifest')
        .join(',')
        .trim()
      const frames = withoutManifest ? parseFrameRange(withoutManifest) : new Set<number>()
      if (withoutManifest && frames.size === 0) return new Map()
      if (frames.size > 0) result.set('', frames)
      if (hasManifest) result.set('@manifest', new Set<number>())
      continue
    }

    const path = trimmed.slice(0, colonIndex).trim()
    const ranges = trimmed.slice(colonIndex + 1).trim()

    if (!path || !ranges) return new Map()

    const frames = parseFrameRange(ranges)
    if (frames.size === 0) return new Map()

    result.set(path, frames)
  }

  return result
}

/**
 * Format a Set of frame numbers into a compact range string like "1-4,7,10-12".
 * Handles single numbers, consecutive ranges, and unsorted input.
 * Accepts 0-indexed frame numbers and converts to 1-indexed.
 */
export function formatFrameRanges(frames: Set<number>): string {
  if (frames.size === 0) return ''

  const sorted = Array.from(frames).sort((a, b) => a - b)
  const ranges: string[] = []
  let rangeStart = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]
    if (curr === prev + 1) {
      prev = curr
      continue
    }
    // End of a range — output in 1-indexed
    if (rangeStart === prev) {
      ranges.push(`${rangeStart + 1}`)
    } else {
      ranges.push(`${rangeStart + 1}-${prev + 1}`)
    }
    rangeStart = curr
    prev = curr
  }

  // Handle the last range — output in 1-indexed
  if (rangeStart === prev) {
    ranges.push(`${rangeStart + 1}`)
  } else {
    ranges.push(`${rangeStart + 1}-${prev + 1}`)
  }

  return ranges.join(',')
}

/**
 * Format a Map of file path → Set of frame numbers into
 * the machine-readable format:
 *   src/main.go:1-3,7
 *   src/config.go:2,5-6
 *
 * For file mode (single entry with key ""), returns just the range string.
 */
export function formatMissingFrameList(files: Map<string, Set<number>>): string {
  if (files.size === 0) return ''

  // File mode — single entry with key ""
  if (files.size === 1 && files.has('')) {
    return formatFrameRanges(files.get('')!)
  }

  const lines: string[] = []
  // Sort by path for deterministic output
  const sortedPaths = Array.from(files.keys()).sort()

  for (const path of sortedPaths) {
    const frames = files.get(path)!
    if (frames.size === 0) continue
    lines.push(`${path}:${formatFrameRanges(frames)}`)
  }

  return lines.join('\n')
}

/**
 * Format a Map of file path → Set of frame numbers into
 * the display format with spaces after commas and aligned paths:
 *   src/main.go   1-3, 7
 *   src/config.go 2, 5-6
 *
 * For file mode (single entry with key ""), returns just "1-4, 7, 10-12".
 */
export function formatDisplayMissingFrames(files: Map<string, Set<number>>): string {
  if (files.size === 0) return ''

  // File mode — single entry with key ""
  if (files.size === 1 && files.has('')) {
    const ranges = formatFrameRanges(files.get('')!)
    // Add spaces after commas for readability
    return ranges.replace(/,/g, ', ')
  }

  const lines: string[] = []
  const sortedPaths = Array.from(files.keys()).sort()

  // Find the longest path for alignment
  const maxPathLen = Math.max(...sortedPaths.map((p) => p.length))

  for (const path of sortedPaths) {
    const frames = files.get(path)!
    if (frames.size === 0) continue
    const paddedPath = path.padEnd(maxPathLen, ' ')
    const ranges = formatFrameRanges(frames).replace(/,/g, ', ')
    lines.push(`${paddedPath}  ${ranges}`)
  }

  return lines.join('\n')
}

/**
 * Compute missing frame numbers for a single-file transfer (v1).
 * Returns 0-indexed frame numbers (0..totalFrames-1).
 */
export function computeMissingFramesFile(
  receivedFrames: Map<number, Uint8Array>,
  totalFrames: number,
): Set<number> {
  const missing = new Set<number>()
  if (totalFrames <= 0) return missing

  for (let i = 1; i <= totalFrames; i++) {
    if (!receivedFrames.has(i)) {
      // receivedFrames keys are 1-indexed, store as 0-indexed internally
      missing.add(i - 1)
    }
  }

  return missing
}

/**
 * Compute missing frame numbers per file for a folder transfer (v2).
 * Returns 0-indexed per-file frame numbers.
 * Returns a Map of file path → Set of missing frame numbers.
 */
export function computeMissingFramesFolder(
  fileProgress: Map<number, { path: string; frameCount: number; receivedFrames: Set<number> }>,
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>()

  for (const [, progress] of fileProgress) {
    const missing = new Set<number>()
    for (let i = 0; i < progress.frameCount; i++) {
      if (!progress.receivedFrames.has(i)) {
        missing.add(i)
      }
    }
    if (missing.size > 0) {
      result.set(progress.path, missing)
    }
  }

  return result
}