/**
 * Minimal gitignore pattern parser and matcher.
 *
 * Supports the most common .gitignore patterns:
 *   - `#` comments and blank lines
 *   - `!` negation
 *   - Trailing `/` (directory-only match)
 *   - Leading `/` (root-anchored)
 *   - `*` matches anything except `/`
 *   - `**` matches zero or more directories
 *   - `?` matches a single non-`/` character
 *   - Patterns without `/` match anywhere in the tree
 */

export interface GitignoreRule {
  /** The raw pattern text (after stripping `!`, leading/trailing markers). */
  pattern: string
  /** If true, this rule un-ignores matching paths. */
  negate: boolean
  /** If true, the pattern only applies to directories. */
  directoryOnly: boolean
  /** If true, the pattern is anchored to the root (had leading `/`). */
  anchored: boolean
}

/**
 * Parse the content of a .gitignore file into rules.
 */
export function parseGitignore(content: string): GitignoreRule[] {
  const rules: GitignoreRule[] = []

  for (const rawLine of content.split('\n')) {
    let line = rawLine.trim()

    // Strip inline comments (a space/tab followed by #)
    // This is a simplified version — git's actual rules are more nuanced
    // but this covers the 99% case.
    const commentIdx = findUnescapedHash(line)
    if (commentIdx >= 0) {
      line = line.slice(0, commentIdx).trim()
    }

    // Skip empty lines
    if (line.length === 0) continue

    // Check for negation
    const negate = line.startsWith('!')
    if (negate) {
      line = line.slice(1).trim()
      if (line.length === 0) continue
    }

    // Check for trailing slash (directory-only)
    const directoryOnly = line.endsWith('/')
    if (directoryOnly) {
      line = line.slice(0, -1)
    }

    // Check for leading slash (root-anchored)
    let anchored = line.startsWith('/')
    if (anchored) {
      line = line.slice(1)
    }

    if (line.length === 0) continue

    rules.push({ pattern: line, negate, directoryOnly, anchored })
  }

  return rules
}

/**
 * Find the first unescaped `#` character that starts a comment.
 * Returns -1 if not found.
 */
function findUnescapedHash(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++ // skip escaped char
      continue
    }
    if (line[i] === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return i
    }
  }
  return -1
}

/**
 * Test whether a single gitignore rule matches a given path.
 *
 * @param rule - The parsed rule.
 * @param path - Relative path (e.g. `src/main.ts`).
 * @param isDirectory - Whether the path is a directory.
 */
export function matchGitignoreRule(rule: GitignoreRule, path: string, isDirectory = false): boolean {
  // Directory-only rules don't match files
  if (rule.directoryOnly && !isDirectory) return false

  const pattern = rule.pattern

  // If the pattern contains `/` or is anchored, match against the full path
  // Otherwise, match against any path component (basename matching)
  if (pattern.includes('/') || rule.anchored) {
    return globMatch(pattern, path)
  }

  // Basename-only pattern: check each path component
  const parts = path.split('/')
  return parts.some((part) => globMatch(pattern, part))
}

/**
 * Simple glob matching for gitignore patterns.
 * Supports `*`, `**`, `?` but NOT `[...]` character classes.
 */
function globMatch(pattern: string, target: string): boolean {
  // Fast path: exact match
  if (pattern === target) return true

  let pi = 0 // pattern index
  let ti = 0 // target index

  while (pi < pattern.length) {
    const pch = pattern[pi]

    if (pch === '*') {
      // Check for `**`
      if (pi + 1 < pattern.length && pattern[pi + 1] === '*') {
        // `**` matches zero or more path segments
        pi += 2
        // Skip trailing `/` if present
        if (pi < pattern.length && pattern[pi] === '/') {
          pi++
        }

        // `**` at end matches everything
        if (pi >= pattern.length) return true

        // Try to match the rest of the pattern starting at each position
        while (ti <= target.length) {
          if (globMatch(pattern.slice(pi), target.slice(ti))) return true
          // Advance to next `/`
          const nextSlash = target.indexOf('/', ti)
          if (nextSlash === -1) break
          ti = nextSlash + 1
        }
        return false
      }

      // `*` matches any characters except `/`
      pi++
      // If `*` is at end of pattern, match rest of target (no `/`)
      if (pi >= pattern.length) return !target.slice(ti).includes('/')

      const restPattern = pattern.slice(pi)
      // Match until we find where the rest matches
      while (ti < target.length) {
        if (target[ti] === '/') break
        if (globMatch(restPattern, target.slice(ti))) return true
        ti++
      }
      return false
    }

    if (pch === '?') {
      // `?` matches a single character except `/`
      if (ti >= target.length || target[ti] === '/') return false
      pi++
      ti++
      continue
    }

    // Regular character: must match exactly
    if (ti >= target.length || target[ti] !== pch) return false
    pi++
    ti++
  }

  // Pattern exhausted — match if target is also exhausted
  return ti >= target.length
}

/**
 * Check if a path is ignored by a set of gitignore rules.
 * Returns `true` if the path should be excluded.
 *
 * The last matching rule wins (negation with `!` overrides previous matches).
 *
 * Handles the gitignore semantics where matching a parent directory causes
 * everything inside that directory to be ignored as well (e.g. `/dist` matches
 * both `dist` and `dist/bundle.js`).
 */
export function isIgnored(
  path: string,
  rules: GitignoreRule[],
  isDirectory = false,
): boolean {
  let ignored = false

  for (const rule of rules) {
    // Check the path itself
    if (matchGitignoreRule(rule, path, isDirectory)) {
      ignored = !rule.negate
      continue
    }

    // If this rule matches a parent directory, everything inside inherits
    // the ignore status (unless negated by a more specific rule).
    // This applies regardless of directoryOnly flag — e.g. `/dist` matches
    // the directory `dist` and thus everything inside it is ignored.
    const parts = path.split('/')
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/')
      // Only check directory matching for directory-amenable rules
      if (matchGitignoreRule(rule, dirPath, true)) {
        ignored = !rule.negate
        break
      }
    }
  }

  return ignored
}