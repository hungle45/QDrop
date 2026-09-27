import { describe, it, expect } from 'vitest'
import { parseGitignore, matchGitignoreRule, isIgnored } from '../../filter/gitignore'
import type { GitignoreRule } from '../../filter/gitignore'

// Helper to create a rule
function rule(
  pattern: string,
  negate = false,
  directoryOnly = false,
  anchored = false,
): GitignoreRule {
  return { pattern, negate, directoryOnly, anchored }
}

describe('parseGitignore', () => {
  it('parses simple patterns', () => {
    const rules = parseGitignore('*.log\nnode_modules/\n/build/\n')
    expect(rules).toHaveLength(3)
    expect(rules[0]).toEqual(rule('*.log'))
    expect(rules[1]).toEqual(rule('node_modules', false, true))
    expect(rules[2]).toEqual(rule('build', false, true, true))
  })

  it('handles negation', () => {
    const rules = parseGitignore('*.log\n!important.log\n')
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual(rule('*.log'))
    expect(rules[1]).toEqual(rule('important.log', true))
  })

  it('strips comments and blank lines', () => {
    const rules = parseGitignore(
      '# This is a comment\n*.log\n\n# Another comment\ndist/\n',
    )
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual(rule('*.log'))
    expect(rules[1]).toEqual(rule('dist', false, true))
  })

  it('strips inline comments', () => {
    const rules = parseGitignore('*.log # exclude logs\ndist/  # build output\n')
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual(rule('*.log'))
    expect(rules[1]).toEqual(rule('dist', false, true))
  })

  it('handles empty content', () => {
    expect(parseGitignore('')).toEqual([])
    expect(parseGitignore('   \n\n')).toEqual([])
  })
})

describe('matchGitignoreRule', () => {
  it('matches basename patterns (no slash)', () => {
    expect(matchGitignoreRule(rule('*.log'), 'src/server.log')).toBe(true)
    expect(matchGitignoreRule(rule('*.log'), 'log.txt')).toBe(false)
    expect(matchGitignoreRule(rule('*.log'), 'src/logs/')).toBe(false)
  })

  it('matches root-anchored patterns', () => {
    expect(matchGitignoreRule(rule('build', false, false, true), 'build/foo.txt')).toBe(false)
    expect(matchGitignoreRule(rule('build', false, false, true), 'build')).toBe(true)
    expect(matchGitignoreRule(rule('build', false, false, true), 'src/build')).toBe(false)
  })

  it('matches full-path patterns', () => {
    expect(matchGitignoreRule(rule('src/*.ts'), 'src/main.ts')).toBe(true)
    expect(matchGitignoreRule(rule('src/*.ts'), 'src/main.js')).toBe(false)
    expect(matchGitignoreRule(rule('src/*.ts'), 'lib/main.ts')).toBe(false)
  })

  it('matches directory-only patterns', () => {
    expect(matchGitignoreRule(rule('node_modules', false, true), 'node_modules', true)).toBe(true)
    expect(matchGitignoreRule(rule('node_modules', false, true), 'node_modules')).toBe(false)
  })

  it('matches glob patterns with **', () => {
    expect(matchGitignoreRule(rule('a/**/b'), 'a/b')).toBe(true)
    expect(matchGitignoreRule(rule('a/**/b'), 'a/x/b')).toBe(true)
    expect(matchGitignoreRule(rule('a/**/b'), 'a/x/y/b')).toBe(true)
    expect(matchGitignoreRule(rule('a/**/b'), 'a/x/y/z')).toBe(false)
  })

  it('matches ** at end', () => {
    expect(matchGitignoreRule(rule('a/**'), 'a/b/c.ts')).toBe(true)
    expect(matchGitignoreRule(rule('a/**'), 'a/b')).toBe(true)
    expect(matchGitignoreRule(rule('a/**'), 'b/c.ts')).toBe(false)
  })

  it('matches ? single-character wildcard', () => {
    expect(matchGitignoreRule(rule('?.ts'), 'a.ts')).toBe(true)
    expect(matchGitignoreRule(rule('?.ts'), 'ab.ts')).toBe(false)
    expect(matchGitignoreRule(rule('??.ts'), 'ab.ts')).toBe(true)
    // Non-anchored pattern matches each path component
    expect(matchGitignoreRule(rule('?.ts'), 'a/b.ts')).toBe(true)
  })

  it('matches exact basename', () => {
    expect(matchGitignoreRule(rule('.DS_Store'), '.DS_Store')).toBe(true)
    expect(matchGitignoreRule(rule('.DS_Store'), 'src/.DS_Store')).toBe(true)
    expect(matchGitignoreRule(rule('.DS_Store'), 'DS_Store')).toBe(false)
  })

  it('handles negation correctly', () => {
    const ignored = isIgnored('src/server.log', [
      rule('*.log'),
      rule('server.log', false, false, true),
    ])
    // Last matching rule wins: anchored `server.log` doesn't match `src/server.log`
    expect(ignored).toBe(true)

    const unignored = isIgnored('important.log', [
      rule('*.log'),
      rule('important.log', true),
    ])
    expect(unignored).toBe(false)
  })

  it('matches * but not ** across / boundary', () => {
    // `*` should NOT match across /
    expect(matchGitignoreRule(rule('src/*.ts'), 'src/main.ts')).toBe(true)
    expect(matchGitignoreRule(rule('src/*.ts'), 'src/sub/main.ts')).toBe(false)
  })

  it('handles **/ prefix', () => {
    expect(matchGitignoreRule(rule('**/foo'), 'foo')).toBe(true)
    expect(matchGitignoreRule(rule('**/foo'), 'bar/foo')).toBe(true)
    expect(matchGitignoreRule(rule('**/foo'), 'bar/baz/foo')).toBe(true)
    expect(matchGitignoreRule(rule('**/foo'), 'bar/baz')).toBe(false)
  })
})

describe('isIgnored with realistic gitignore files', () => {
  it('ignores node_modules', () => {
    const rules = parseGitignore('node_modules/\n')
    expect(isIgnored('node_modules/some-pkg/index.js', rules, false)).toBe(true)
  })

  it('ignores .DS_Store', () => {
    const rules = parseGitignore('.DS_Store\n')
    expect(isIgnored('.DS_Store', rules)).toBe(true)
    expect(isIgnored('src/.DS_Store', rules)).toBe(true)
  })

  it('ignores build output', () => {
    const rules = parseGitignore('/dist\n')
    expect(isIgnored('dist', rules)).toBe(true)
    // Everything inside a matched directory is also ignored
    expect(isIgnored('dist/bundle.js', rules)).toBe(true)
    expect(isIgnored('src/dist', rules)).toBe(false)
  })

  it('handles mixed rules with negation', () => {
    const rules = parseGitignore('*.log\n!important.log\n/docker-compose*.yml\n')
    expect(isIgnored('debug.log', rules)).toBe(true)
    expect(isIgnored('important.log', rules)).toBe(false)
    expect(isIgnored('docker-compose.yml', rules)).toBe(true)
    expect(isIgnored('sub/docker-compose.yml', rules)).toBe(false)
  })

  it('excludes .git directory', () => {
    const rules = parseGitignore('.git/\n')
    expect(isIgnored('.git/HEAD', rules, false)).toBe(true)
    expect(isIgnored('.git/config', rules, false)).toBe(true)
  })
})