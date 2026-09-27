/**
 * High-level folder filtering utilities.
 *
 * Combines .gitignore rules and user-removed paths to produce the
 * final file list that should be fed into QR generation.
 */

import { isIgnored, type GitignoreRule } from './gitignore'

/**
 * Always-excluded paths — these are filtered unconditionally,
 * regardless of .gitignore rules or user removals.
 *
 * The `.git` directory contains the repository's version history
 * and should never be part of a QR transfer.
 */
const ALWAYS_EXCLUDED_ROOTS = new Set(['.git'])

/**
 * Check whether a path should always be excluded (e.g. `.git` directory).
 * Returns true if the path or any of its ancestor directories is in
 * the always-excluded set.
 */
export function isAlwaysExcluded(relPath: string): boolean {
  const parts = relPath.split('/')
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i]
    if (ALWAYS_EXCLUDED_ROOTS.has(segment)) return true
  }
  return false
}

/**
 * Filter out always-excluded files (e.g. `.git` directory contents).
 * This runs before all other filtering.
 */
export function filterAlwaysExcluded(files: File[]): File[] {
  return files.filter((file) => !isAlwaysExcluded(getRelativePath(file)))
}

/**
 * Find the .gitignore file (at root) from a list of files returned
 * by the browser's directory picker (`webkitdirectory`).
 */
export function findGitignoreFile(files: File[]): File | null {
  for (const file of files) {
    const relPath = getRelativePath(file)
    // .gitignore must be in the root of the selected folder
    // root-level files have a single path segment after the root dir
    if (relPath === '.gitignore') return file
  }
  return null
}

/**
 * Read the text content of a .gitignore file.
 */
export async function readGitignoreContent(file: File): Promise<string> {
  return await file.text()
}

/**
 * Get the relative path of a file within the selected folder,
 * stripping the root directory name from `webkitRelativePath`.
 *
 * E.g. `myproject/src/main.ts` → `src/main.ts`
 */
export function getRelativePath(file: File): string {
  const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
  // Strip the root directory
  const slashIdx = relPath.indexOf('/')
  return slashIdx >= 0 ? relPath.slice(slashIdx + 1) : relPath
}

/**
 * Filter files by .gitignore rules.
 *
 * @param files - All files from the directory picker.
 * @param rules - Parsed .gitignore rules (empty array = no filtering).
 * @param respectGitignore - If false, returns all files unchanged.
 * @returns Filtered file list.
 */
export function filterByGitignore(
  files: File[],
  rules: GitignoreRule[],
  respectGitignore: boolean,
): File[] {
  if (!respectGitignore || rules.length === 0) return files

  return files.filter((file) => {
    const path = getRelativePath(file)
    // Never ignore the .gitignore file itself unless the rules explicitly ignore it
    // (e.g. `.gitignore` itself is rarely gitignored, but could be)
    return !isIgnored(path, rules, false)
  })
}

/**
 * Filter files by user-removed paths.
 *
 * When a path is removed:
 *   - If it's a file, that specific file is removed.
 *   - If it's a directory, all files under that directory are removed.
 *
 * @param files - Files to filter.
 * @param removedPaths - Set of relative paths the user removed (may include folders).
 * @returns Filtered file list.
 */
export function filterByRemovedPaths(
  files: File[],
  removedPaths: Set<string>,
): File[] {
  if (removedPaths.size === 0) return files

  return files.filter((file) => {
    const path = getRelativePath(file)
    return !isPathRemoved(path, removedPaths)
  })
}

/**
 * Check whether a path is removed (either directly or via a parent folder).
 */
function isPathRemoved(path: string, removedPaths: Set<string>): boolean {
  // Direct match
  if (removedPaths.has(path)) return true

  // Check if any parent directory is removed
  const parts = path.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    const dirPath = parts.slice(0, i + 1).join('/')
    if (removedPaths.has(dirPath)) return true
  }

  return false
}

/**
 * Compute the set of files that would be removed if a given path is removed.
 * This is used for displaying the impact of removal in the UI.
 *
 * @returns The set of relative paths for all files that would be removed.
 */
export function computeRemovedFiles(
  files: File[],
  removePath: string,
): string[] {
  const removed: string[] = []

  for (const file of files) {
    const path = getRelativePath(file)
    // If removePath is a file
    if (path === removePath) {
      removed.push(path)
      continue
    }
    // If removePath is a directory, check if path is under it
    if (path.startsWith(removePath + '/')) {
      removed.push(path)
    }
  }

  return removed
}

/**
 * Compute a "folder tree" from the file list — used for display.
 * Returns a list of entries with depth info.
 */
export interface TreeEntry {
  name: string
  path: string
  type: 'file' | 'folder'
  depth: number
  /** If this entry is a file, its size in bytes. */
  size?: number
}

export function buildTreeEntries(files: File[]): TreeEntry[] {
  const entries: TreeEntry[] = []
  const seenDirs = new Set<string>()

  for (const file of files) {
    const path = getRelativePath(file)
    const parts = path.split('/')

    // Add each parent directory that hasn't been added yet
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/')
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath)
        entries.push({
          name: parts[i],
          path: dirPath,
          type: 'folder',
          depth: i,
        })
      }
    }

    // Add the file
    entries.push({
      name: parts[parts.length - 1],
      path,
      type: 'file',
      depth: parts.length - 1,
      size: file.size,
    })
  }

  return entries
}