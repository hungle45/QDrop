export { parseGitignore, matchGitignoreRule, isIgnored } from './gitignore'
export type { GitignoreRule } from './gitignore'
export {
  findGitignoreFile,
  readGitignoreContent,
  getRelativePath,
  filterByGitignore,
  filterByRemovedPaths,
  filterAlwaysExcluded,
  isAlwaysExcluded,
  computeRemovedFiles,
  buildTreeEntries,
} from './folder-filter'
export type { TreeEntry } from './folder-filter'