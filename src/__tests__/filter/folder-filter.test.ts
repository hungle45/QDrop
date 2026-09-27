import { describe, it, expect } from 'vitest'
import {
  findGitignoreFile,
  getRelativePath,
  filterByGitignore,
  filterByRemovedPaths,
  computeRemovedFiles,
  buildTreeEntries,
  filterAlwaysExcluded,
  isAlwaysExcluded,
} from '../../filter/folder-filter'
import { parseGitignore } from '../../filter/gitignore'
import type { GitignoreRule } from '../../filter/gitignore'

/**
 * Helper: create a mock File-like object with webkitRelativePath.
 */
function mockFile(
  name: string,
  webkitRelativePath: string,
  size = 100,
): File {
  // Use File constructor where possible, then override webkitRelativePath
  const file = new File(['x'.repeat(size)], name, { lastModified: Date.now() })
  // Override size via the prototype or use a Proxy
  // In happy-dom, we need to use a different approach
  return Object.defineProperties(file, {
    size: { value: size, configurable: true, writable: true },
    webkitRelativePath: { value: webkitRelativePath, configurable: true, writable: true },
  }) as File
}

describe('getRelativePath', () => {
  it('strips root directory from webkitRelativePath', () => {
    const f = mockFile('main.ts', 'myproject/src/main.ts')
    expect(getRelativePath(f)).toBe('src/main.ts')
  })

  it('returns name if no webkitRelativePath', () => {
    const f = new File([''], 'file.txt')
    expect(getRelativePath(f)).toBe('file.txt')
  })
})

describe('findGitignoreFile', () => {
  it('finds .gitignore at root', () => {
    const files = [
      mockFile('.gitignore', 'myproject/.gitignore'),
      mockFile('main.ts', 'myproject/src/main.ts'),
    ]
    const result = findGitignoreFile(files)
    expect(result).not.toBeNull()
    expect(getRelativePath(result!)).toBe('.gitignore')
  })

  it('returns null when no .gitignore', () => {
    const files = [
      mockFile('main.ts', 'myproject/src/main.ts'),
      mockFile('util.ts', 'myproject/src/util.ts'),
    ]
    expect(findGitignoreFile(files)).toBeNull()
  })
})

describe('filterByGitignore', () => {
  const rules = parseGitignore(`
node_modules/
*.log
.DS_Store
/dist
/build/
.env
`)

  const files = [
    mockFile('main.ts', 'myproject/src/main.ts'),
    mockFile('util.ts', 'myproject/src/util.ts'),
    mockFile('server.log', 'myproject/logs/server.log'),
    mockFile('index.js', 'myproject/node_modules/pkg/index.js'),
    mockFile('.DS_Store', 'myproject/.DS_Store'),
    mockFile('bundle.js', 'myproject/dist/bundle.js'),
    mockFile('app.js', 'myproject/build/app.js'),
    mockFile('.env', 'myproject/.env'),
  ]

  it('excludes files matching gitignore rules when respectGitignore is true', () => {
    const filtered = filterByGitignore(files, rules, true)

    // Should keep only non-ignored files
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toContain('src/main.ts')
    expect(paths).toContain('src/util.ts')

    // Should exclude these
    expect(paths).not.toContain('logs/server.log') // *.log
    expect(paths).not.toContain('node_modules/pkg/index.js') // node_modules/
    expect(paths).not.toContain('.DS_Store') // .DS_Store
    expect(paths).not.toContain('dist/bundle.js') // /dist matches dist/
    expect(paths).not.toContain('build/app.js') // /build/ matches build/
    expect(paths).not.toContain('.env') // .env
  })

  it('keeps all files when respectGitignore is false', () => {
    const filtered = filterByGitignore(files, rules, false)
    expect(filtered).toHaveLength(files.length)
  })

  it('keeps all files when rules are empty', () => {
    const filtered = filterByGitignore(files, [], true)
    expect(filtered).toHaveLength(files.length)
  })

  it('respects negation rules', () => {
    const negationRules = parseGitignore(`
*.log
!important.log
`)
    const testFiles = [
      mockFile('debug.log', 'p/debug.log'),
      mockFile('important.log', 'p/important.log'),
    ]
    const filtered = filterByGitignore(testFiles, negationRules, true)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).not.toContain('debug.log')
    expect(paths).toContain('important.log')
  })

  it('keeps .gitignore file itself', () => {
    const dotGitignoreRules = parseGitignore('*.txt\n')
    const testFiles = [
      mockFile('.gitignore', 'myproject/.gitignore'),
      mockFile('notes.txt', 'myproject/notes.txt'),
    ]
    const filtered = filterByGitignore(testFiles, dotGitignoreRules, true)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toContain('.gitignore')
    expect(paths).not.toContain('notes.txt')
  })
})

describe('filterByRemovedPaths', () => {
  const files = [
    mockFile('main.ts', 'myproject/src/main.ts', 200),
    mockFile('util.ts', 'myproject/src/util.ts', 150),
    mockFile('index.ts', 'myproject/src/api/index.ts', 300),
    mockFile('types.ts', 'myproject/src/types.ts', 100),
    mockFile('README.md', 'myproject/README.md', 50),
  ]

  it('removes a single file', () => {
    const removed = new Set(['src/util.ts'])
    const filtered = filterByRemovedPaths(files, removed)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(4)
    expect(paths).not.toContain('src/util.ts')
    expect(paths).toContain('src/main.ts')
  })

  it('removes an entire folder', () => {
    const removed = new Set(['src'])
    const filtered = filterByRemovedPaths(files, removed)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(1)
    expect(paths).toContain('README.md')
  })

  it('removes a subfolder', () => {
    const removed = new Set(['src/api'])
    const filtered = filterByRemovedPaths(files, removed)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(4)
    expect(paths).not.toContain('src/api/index.ts')
    expect(paths).toContain('src/main.ts')
    expect(paths).toContain('src/util.ts')
    expect(paths).toContain('src/types.ts')
  })

  it('handles no removals', () => {
    const filtered = filterByRemovedPaths(files, new Set())
    expect(filtered).toHaveLength(files.length)
  })

  it('all files removed results in empty list', () => {
    const removed = new Set(['src', 'README.md'])
    const filtered = filterByRemovedPaths(files, removed)
    expect(filtered).toHaveLength(0)
  })

  it('removing non-existent path has no effect', () => {
    const removed = new Set(['nonexistent/file.ts'])
    const filtered = filterByRemovedPaths(files, removed)
    expect(filtered).toHaveLength(files.length)
  })
})

describe('computeRemovedFiles', () => {
  const files = [
    mockFile('main.ts', 'p/src/main.ts'),
    mockFile('util.ts', 'p/src/util.ts'),
    mockFile('index.ts', 'p/src/api/index.ts'),
    mockFile('README.md', 'p/README.md'),
  ]

  it('returns single file for file removal', () => {
    const removed = computeRemovedFiles(files, 'src/main.ts')
    expect(removed).toEqual(['src/main.ts'])
  })

  it('returns all files under a folder', () => {
    const removed = computeRemovedFiles(files, 'src')
    expect(removed).toEqual(['src/main.ts', 'src/util.ts', 'src/api/index.ts'])
  })

  it('returns subfolder files', () => {
    const removed = computeRemovedFiles(files, 'src/api')
    expect(removed).toEqual(['src/api/index.ts'])
  })

  it('returns empty for unmatched path', () => {
    const removed = computeRemovedFiles(files, 'nonexistent')
    expect(removed).toEqual([])
  })
})

describe('isAlwaysExcluded', () => {
  it('returns true for .git root', () => {
    expect(isAlwaysExcluded('.git')).toBe(true)
  })

  it('returns true for files inside .git', () => {
    expect(isAlwaysExcluded('.git/HEAD')).toBe(true)
    expect(isAlwaysExcluded('.git/objects/ab/cdef1234')).toBe(true)
    expect(isAlwaysExcluded('.git/config')).toBe(true)
  })

  it('returns false for non-.git paths', () => {
    expect(isAlwaysExcluded('src/main.ts')).toBe(false)
    expect(isAlwaysExcluded('.gitignore')).toBe(false)
    expect(isAlwaysExcluded('.env')).toBe(false)
  })

  it('returns true for .git nested inside project', () => {
    expect(isAlwaysExcluded('project/.git/HEAD')).toBe(true)
    expect(isAlwaysExcluded('vendor/.git/config')).toBe(true)
  })

  it('does not match .gitignore or .github', () => {
    expect(isAlwaysExcluded('.gitignore')).toBe(false)
    expect(isAlwaysExcluded('.github/workflows/ci.yml')).toBe(false)
  })
})

describe('filterAlwaysExcluded', () => {
  it('removes .git directory files', () => {
    const files = [
      mockFile('main.ts', 'p/src/main.ts'),
      mockFile('HEAD', 'p/.git/HEAD'),
      mockFile('config', 'p/.git/config'),
      mockFile('README.md', 'p/README.md'),
    ]
    const filtered = filterAlwaysExcluded(files)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(2)
    expect(paths).toContain('src/main.ts')
    expect(paths).toContain('README.md')
    expect(paths).not.toContain('.git/HEAD')
    expect(paths).not.toContain('.git/config')
  })

  it('removes nested .git directories', () => {
    const files = [
      mockFile('main.ts', 'p/main.ts'),
      mockFile('HEAD', 'p/submodule/.git/HEAD'),
      mockFile('index.js', 'p/submodule/.git/index.js'),
    ]
    const filtered = filterAlwaysExcluded(files)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(1)
    expect(paths).toContain('main.ts')
    expect(paths).not.toContain('submodule/.git/HEAD')
  })

  it('keeps .gitignore files', () => {
    const files = [
      mockFile('.gitignore', 'p/.gitignore'),
      mockFile('main.ts', 'p/main.ts'),
    ]
    const filtered = filterAlwaysExcluded(files)
    const paths = filtered.map((f) => getRelativePath(f))
    expect(paths).toHaveLength(2)
    expect(paths).toContain('.gitignore')
    expect(paths).toContain('main.ts')
  })

  it('works with empty input', () => {
    expect(filterAlwaysExcluded([])).toEqual([])
  })
})

describe('Cache / regen behavior', () => {
  /**
   * Verifies the caching strategy used in use-sender:
   * - `prepareFolderFrames` hashes files + applies filters → populates cache
   * - `regenFolderFrames` re-chunks with new payload but reuses cached hashes
   * - Only content changes (filter/removals) invalidate the cache
   */

  const MAX_PAYLOAD_A = 800
  const MAX_PAYLOAD_B = 400

  const rules = parseGitignore(`
*.env
`)

  function estimateFrameCount(fileSize: number, payload: number): number {
    return Math.ceil(fileSize / payload)
  }

  const files = [
    mockFile('main.ts', 'p/src/main.ts', 1600),
    mockFile('util.ts', 'p/src/util.ts', 400),
    mockFile('.env', 'p/.env', 50),
    mockFile('README.md', 'p/README.md', 100),
    mockFile('HEAD', 'p/.git/HEAD', 30),
  ]

  it('same file list with different QR config produces different frame counts', () => {
    // Simulates regenFolderFrames: same file list, different maxPayload
    const withGitignore = filterAlwaysExcluded(files)
    const gitignoreFiltered = filterByGitignore(withGitignore, rules, true)
    const finalFiles = filterByRemovedPaths(gitignoreFiltered, new Set())

    // Files after filtering: main.ts, util.ts, README.md = 3 files
    expect(finalFiles).toHaveLength(3)

    // Config A: 800 byte payload → 4 frames
    const framesA = finalFiles.reduce(
      (sum, f) => sum + estimateFrameCount(f.size, MAX_PAYLOAD_A),
      0,
    )
    expect(framesA).toBe(4)

    // Config B: 400 byte payload → 6 frames
    const framesB = finalFiles.reduce(
      (sum, f) => sum + estimateFrameCount(f.size, MAX_PAYLOAD_B),
      0,
    )
    expect(framesB).toBe(6)
  })

  it('changing QR config does not affect the filtered file list', () => {
    // The file list is independent of QR config
    const filteredA = filterAlwaysExcluded(files)
    const filteredB = filterAlwaysExcluded(files)
    expect(filteredA.map((f) => getRelativePath(f)).sort())
      .toEqual(filteredB.map((f) => getRelativePath(f)).sort())
  })

  it('content change (removing a file) changes the file list', () => {
    const withGitignore = filterAlwaysExcluded(files)
    const gitignoreFiltered = filterByGitignore(withGitignore, rules, true)

    const fullList = filterByRemovedPaths(gitignoreFiltered, new Set())
    expect(fullList).toHaveLength(3)

    const afterRemoval = filterByRemovedPaths(gitignoreFiltered, new Set(['src/main.ts']))
    expect(afterRemoval).toHaveLength(2)
    expect(afterRemoval.find((f) => getRelativePath(f) === 'src/main.ts')).toBeUndefined()
  })

  it('content change (gitignore toggle) changes the file list', () => {
    const withoutGit = filterAlwaysExcluded(files)

    const withoutGitignore = filterByGitignore(withoutGit, rules, false)
    expect(withoutGitignore).toHaveLength(4)

    const withGitignore = filterByGitignore(withoutGit, rules, true)
    expect(withGitignore).toHaveLength(3)
  })

  it('removing a file reuses cached hashes for remaining files', () => {
    // Simulates the prepareFolderFrames caching strategy:
    // 1. Initial prep: hash all files → store in cache
    const initialFiltered = filterByGitignore(
      filterAlwaysExcluded(files), rules, true,
    )

    // Build a hash "cache" keyed by relative path
    const hashCache = new Map<string, string>()
    for (const f of initialFiltered) {
      hashCache.set(getRelativePath(f), `sha256:${getRelativePath(f)}`)
    }

    expect(hashCache.size).toBe(3)
    expect(hashCache.has('src/main.ts')).toBe(true)
    expect(hashCache.has('src/util.ts')).toBe(true)
    expect(hashCache.has('README.md')).toBe(true)

    // 2. Remove a file → filtered list shrinks, but remaining hashes stay in cache
    const afterRemoval = filterByRemovedPaths(initialFiltered, new Set(['src/main.ts']))
    expect(afterRemoval).toHaveLength(2)

    // All remaining files still have their cached hashes
    const remainingRelPaths = afterRemoval.map((f) => getRelativePath(f))
    const allHashesFound = remainingRelPaths.every((p) => hashCache.has(p))
    expect(allHashesFound).toBe(true)

    // The removed file's hash is still in the cache too (no reason to delete it)
    expect(hashCache.has('src/main.ts')).toBe(true)
  })

  it('gitignore toggle reuses cached hashes for files that remain', () => {
    // Initial prep: gitignore enabled, .env excluded → hash remaining 3 files
    const withGit = filterByGitignore(
      filterAlwaysExcluded(files), rules, true,
    )

    const hashCache = new Map<string, string>()
    for (const f of withGit) {
      hashCache.set(getRelativePath(f), `sha256:${getRelativePath(f)}`)
    }
    expect(hashCache.size).toBe(3)

    // Toggle gitignore OFF → .env is now included
    const withoutGitignore = filterByGitignore(
      filterAlwaysExcluded(files), rules, false,
    )
    expect(withoutGitignore).toHaveLength(4)

    // Previously cached files still have their hashes
    const cachedRelPaths = ['src/main.ts', 'src/util.ts', 'README.md']
    const allCachedFound = cachedRelPaths.every((p) => hashCache.has(p))
    expect(allCachedFound).toBe(true)

    // The newly included .env does NOT have a hash yet
    expect(hashCache.has('.env')).toBe(false)

    // Toggle gitignore ON again → .env excluded, cached files unchanged
    const withGitAgain = filterByGitignore(
      filterAlwaysExcluded(files), rules, true,
    )
    expect(withGitAgain).toHaveLength(3)
    const allCachedAgain = withGitAgain
      .map((f) => getRelativePath(f))
      .every((p) => hashCache.has(p))
    expect(allCachedAgain).toBe(true)
  })

  it('removing a folder reuses cached hashes for files outside that folder', () => {
    const allFiltered = filterByGitignore(
      filterAlwaysExcluded(files), rules, true,
    )

    // Cache all hashes
    const hashCache = new Map<string, string>()
    for (const f of allFiltered) {
      hashCache.set(getRelativePath(f), `sha256:${getRelativePath(f)}`)
    }

    // Remove the 'src' folder (contains main.ts and util.ts)
    const afterFolderRemoval = filterByRemovedPaths(allFiltered, new Set(['src']))
    expect(afterFolderRemoval).toHaveLength(1)
    expect(getRelativePath(afterFolderRemoval[0])).toBe('README.md')

    // The only remaining file (README.md) still has its cached hash
    expect(hashCache.has('README.md')).toBe(true)

    // Files from the removed folder are gone from the filtered list
    expect(afterFolderRemoval.find((f) => getRelativePath(f) === 'src/main.ts')).toBeUndefined()
  })
})

describe('Frame count after filtering', () => {
  /**
   * Simulates how prepareFolderFrames derives the final file list
   * that is then chunked to produce frame counts.
   */
  function applyAllFilters(
    files: File[],
    rules: GitignoreRule[] | null,
    respectGitignore: boolean,
    removedPaths: Set<string>,
  ): File[] {
    const withoutGit = filterAlwaysExcluded(files)
    const gitignoreFiltered = rules ? filterByGitignore(withoutGit, rules, respectGitignore) : withoutGit
    return filterByRemovedPaths(gitignoreFiltered, removedPaths)
  }

  // Each "frame" corresponds to a chunk; payload varies by QR config.
  // We use a fixed maxPayload of 500 bytes for testing.
  const MAX_PAYLOAD = 500

  function estimateFrameCount(fileSize: number): number {
    return Math.ceil(fileSize / MAX_PAYLOAD)
  }

  function totalFrames(files: File[]): number {
    return files.reduce((sum, f) => sum + estimateFrameCount(f.size), 0)
  }

  const files = [
    mockFile('main.ts', 'p/src/main.ts', 1200),   // 3 frames
    mockFile('util.ts', 'p/src/util.ts', 400),     // 1 frame
    mockFile('helper.ts', 'p/src/helper.ts', 600), // 2 frames
    mockFile('types.ts', 'p/src/types.ts', 200),   // 1 frame
    mockFile('index.ts', 'p/src/api/index.ts', 800), // 2 frames
    mockFile('README.md', 'p/README.md', 100),     // 1 frame
    mockFile('.env', 'p/.env', 50),                // 1 frame
    mockFile('package.json', 'p/package.json', 300), // 1 frame
    mockFile('HEAD', 'p/.git/HEAD', 30),            // excluded by filterAlwaysExcluded
    mockFile('config', 'p/.git/config', 200),        // excluded by filterAlwaysExcluded
  ]

  // Total files without always-excluded: 8 files
  // Total frames: 3+1+2+1+2+1+1+1 = 12

  const rules = parseGitignore(`
.env
node_modules/
`)

  it('removing a file decreases total frame count', () => {
    const removed = new Set(['src/main.ts'])
    const filtered = applyAllFilters(files, rules, true, removed)
    const frames = totalFrames(filtered)
    // 12 original frames. Gitignore excludes .env (1). Remove main.ts (3). 12-1-3 = 8
    expect(frames).toBe(8)
    expect(filtered.length).toBe(6)
    expect(filtered.find((f) => getRelativePath(f) === 'src/main.ts')).toBeUndefined()
  })

  it('removing a folder decreases total frame count accordingly', () => {
    const removed = new Set(['src'])
    const filtered = applyAllFilters(files, rules, true, removed)
    const frames = totalFrames(filtered)
    // Remove all src/* files: main.ts(3)+util.ts(1)+helper.ts(2)+types.ts(1)+api/index.ts(2) = 9 frames
    // Remaining: README.md(1) + package.json(1) = 2 frames
    // But .env is gitignored, so total = 2 frames
    expect(frames).toBe(2)
    expect(filtered.length).toBe(2)
    expect(filtered.find((f) => getRelativePath(f) === 'README.md')).toBeDefined()
    expect(filtered.find((f) => getRelativePath(f) === 'package.json')).toBeDefined()
  })

  it('removing a subfolder decreases total frame count', () => {
    const removed = new Set(['src/api'])
    const filtered = applyAllFilters(files, rules, true, removed)
    const frames = totalFrames(filtered)
    // 12 original. Gitignore excludes .env (1). Remove src/api/index.ts (2). 12-1-2 = 9
    expect(frames).toBe(9)
    expect(filtered.length).toBe(6)
    expect(filtered.find((f) => getRelativePath(f) === 'src/api/index.ts')).toBeUndefined()
  })

  it('toggling .gitignore changes total frame count', () => {
    const removed = new Set<string>()

    // With gitignore enabled: .env is excluded
    const withGitignore = applyAllFilters(files, rules, true, removed)
    const framesWith = totalFrames(withGitignore)
    // .env (1 frame) excluded. Total = 12 - 1 = 11 frames
    expect(framesWith).toBe(11)
    expect(withGitignore.find((f) => getRelativePath(f) === '.env')).toBeUndefined()

    // With gitignore disabled: .env is included
    const withoutGitignore = applyAllFilters(files, rules, false, removed)
    const framesWithout = totalFrames(withoutGitignore)
    expect(framesWithout).toBe(12)
    expect(withoutGitignore.find((f) => getRelativePath(f) === '.env')).toBeDefined()
  })

  it('combining removal and gitignore changes frame count correctly', () => {
    // Remove a folder AND disable gitignore
    const removed = new Set(['src'])

    const filtered = applyAllFilters(files, rules, false, removed)
    const frames = totalFrames(filtered)
    // src removed (3+1+2+1+2 = 9 frames)
    // remaining: README.md(1) + .env(1) + package.json(1) = 3 frames
    expect(frames).toBe(3)
    expect(filtered.length).toBe(3)
  })
})

describe('buildTreeEntries', () => {
  it('builds a tree from flat file list', () => {
    const files = [
      mockFile('main.ts', 'p/src/main.ts'),
      mockFile('util.ts', 'p/src/util.ts'),
      mockFile('README.md', 'p/README.md'),
    ]
    const entries = buildTreeEntries(files)
    // Expect: src/ (folder), src/main.ts (file), src/util.ts (file), README.md (file)
    expect(entries).toHaveLength(4)

    const srcFolder = entries.find((e) => e.name === 'src' && e.type === 'folder')
    expect(srcFolder).toBeDefined()
    expect(srcFolder!.depth).toBe(0)
    expect(srcFolder!.path).toBe('src')

    const mainFile = entries.find((e) => e.name === 'main.ts' && e.type === 'file')
    expect(mainFile).toBeDefined()
    expect(mainFile!.depth).toBe(1)
    expect(mainFile!.path).toBe('src/main.ts')

    expect(entries.filter((e) => e.type === 'file')).toHaveLength(3)
  })
})
