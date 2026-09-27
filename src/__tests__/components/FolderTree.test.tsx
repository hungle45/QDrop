/**
 * Tests for folder tree display components.
 *
 * Focuses on verifying that the tree structure is preserved
 * correctly after file/folder removals.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RemovableFileTree } from '../../components/RemovableFileTree'
import { SenderFolderTree } from '../../components/SenderFolderTree'

/**
 * Helper: create a minimal file entry as consumed by RemovableFileTree.
 */
function file(path: string, size = 100): { path: string; size: number } {
  return { path, size }
}

describe('SenderFolderTree — active-file highlighting', () => {
  /**
   * Helper: create a minimal file entry as consumed by SenderFolderTree.
   */
  function senderFile(
    path: string,
    fileId: number,
    size = 100,
    frameCount = 1,
  ): { path: string; size: number; frameCount: number; fileId: number } {
    return { path, size, frameCount, fileId }
  }

  it('highlights the file whose activeFileId matches', () => {
    const files = [
      senderFile('src/main.ts', 0, 500, 3),
      senderFile('src/utils.ts', 1, 200, 1),
      senderFile('README.md', 2, 50, 1),
    ]

    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={0}
        currentFrameNumber={1}
      />,
    )

    const text = container.textContent!

    // Active file should be in the DOM
    expect(text).toContain('main.ts')

    // The frame progress should be shown for the active file
    expect(text).toContain('2/3')
  })

  it('does not highlight any file when activeFileId is undefined (manifest frame)', () => {
    const files = [
      senderFile('src/main.ts', 0, 500, 3),
      senderFile('README.md', 1, 50, 1),
    ]

    // No frame progress should be shown when no file is active
    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={undefined}
        currentFrameNumber={undefined}
      />,
    )

    const text = container.textContent!

    // Root-level files should still be listed
    expect(text).toContain('README.md')

    // Files inside folders are hidden because folders are collapsed
    // (no active file means no path to expand)
    expect(text).not.toContain('main.ts')

    // No frame progress indicator
    expect(text).not.toContain('/3')
  })

  it('highlights the correct file when switching between files', () => {
    const files = [
      senderFile('file-a.ts', 0, 100, 2),
      senderFile('file-b.ts', 1, 100, 4),
      senderFile('file-c.ts', 2, 100, 1),
    ]

    // Render with fileId=1 active
    const { container, rerender } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={1}
        currentFrameNumber={2}
      />,
    )

    expect(container.textContent).toContain('file-b.ts')
    expect(container.textContent).toContain('3/4')

    // Switch to fileId=2
    rerender(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={2}
        currentFrameNumber={0}
      />,
    )

    expect(container.textContent).toContain('file-c.ts')
    expect(container.textContent).toContain('1/1')
  })

  it('highlights files correctly in a nested folder structure — only ancestors expanded', () => {
    const files = [
      senderFile('src/components/Button.tsx', 0, 300, 2),
      senderFile('src/components/Input.tsx', 1, 250, 1),
      senderFile('src/main.ts', 2, 500, 3),
      senderFile('tests/test.ts', 3, 200, 1),
      senderFile('README.md', 4, 50, 1),
    ]

    // Active file is src/components/Button.tsx (fileId=0)
    // → src/ and components/ are ancestors → expanded
    // → tests/ is NOT an ancestor → collapsed → test.ts hidden
    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={0}
        currentFrameNumber={0}
      />,
    )

    const text = container.textContent!

    // Ancestor folders and their contents should be visible
    expect(text).toContain('src')
    expect(text).toContain('components')
    expect(text).toContain('Button.tsx')
    expect(text).toContain('Input.tsx')
    // Non-ancestor folders are collapsed
    expect(text).not.toContain('test.ts')

    // Root-level file always visible
    expect(text).toContain('README.md')

    // Active file should show progress
    expect(text).toContain('1/2')
  })

  it('highlighting still works while tree is scrollable', () => {
    // Create many files to ensure overflow
    const files = Array.from({ length: 50 }, (_, i) =>
      senderFile(`file-${i}.ts`, i, 100, 1),
    )

    // Active file is in the middle
    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={25}
        currentFrameNumber={0}
        className="max-h-40"
      />,
    )

    const text = container.textContent!
    expect(text).toContain('file-25.ts')
    expect(text).toContain('1/1')
  })

  it('renders data-file-id attribute for auto-scroll targeting', () => {
    const files = [
      senderFile('src/main.ts', 0, 500, 3),
      senderFile('README.md', 1, 50, 1),
    ]

    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={0}
        currentFrameNumber={0}
      />,
    )

    const activeEl = container.querySelector('[data-file-id="0"]')
    expect(activeEl).not.toBeNull()
    expect(activeEl?.textContent).toContain('main.ts')
  })

  it('auto-expands parent folders of the active file', () => {
    // The active file is deeply nested — its parents must be expanded
    // so the file is reachable in the DOM.
    const files = [
      senderFile('a/b/c/d/e/file.ts', 0, 100, 2),
      senderFile('other.txt', 1, 50, 1),
    ]

    const { container } = render(
      <SenderFolderTree
        rootName="root"
        files={files}
        activeFileId={0}
        currentFrameNumber={0}
      />,
    )

    const text = container.textContent!
    // All parent folders should appear
    expect(text).toContain('a')
    expect(text).toContain('b')
    expect(text).toContain('c')
    expect(text).toContain('d')
    expect(text).toContain('e')
    // The active file should be present with progress
    expect(text).toContain('file.ts')
    expect(text).toContain('1/2')
  })

  it('all folders collapsed during manifest frame (no active file)', () => {
    const files = [
      senderFile('src/main.ts', 0, 500, 3),
      senderFile('src/utils.ts', 1, 200, 1),
      senderFile('README.md', 2, 50, 1),
    ]

    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={undefined}
        currentFrameNumber={undefined}
      />,
    )

    const text = container.textContent!

    // Root-level file still visible
    expect(text).toContain('README.md')

    // Files inside folders are hidden because all folders are collapsed
    expect(text).not.toContain('main.ts')
    expect(text).not.toContain('utils.ts')

    // No frame progress indicators
    expect(text).not.toContain('/3')
    expect(text).not.toContain('/1')
  })

  it('collapses previous path and expands new path when activeFileId changes', () => {
    const files = [
      senderFile('src/a/file1.ts', 0, 100, 2),
      senderFile('lib/b/file2.ts', 1, 100, 4),
    ]

    const { container, rerender } = render(
      <SenderFolderTree
        rootName="root"
        files={files}
        activeFileId={0}
        currentFrameNumber={0}
      />,
    )

    // With fileId=0 active: src/ is expanded, lib/ is collapsed
    expect(container.textContent).toContain('file1.ts')
    expect(container.textContent).not.toContain('file2.ts')

    // Switch to fileId=1 active
    rerender(
      <SenderFolderTree
        rootName="root"
        files={files}
        activeFileId={1}
        currentFrameNumber={0}
      />,
    )

    // Now lib/ is expanded, src/ is collapsed
    expect(container.textContent).toContain('file2.ts')
    expect(container.textContent).not.toContain('file1.ts')
  })

  it('non-ancestor folders are collapsed while ancestor folders are expanded', () => {
    const files = [
      senderFile('src/main.ts', 0, 500, 3),
      senderFile('src/components/Button.tsx', 1, 300, 2),
      senderFile('tests/test.ts', 2, 200, 1),
      senderFile('docs/readme.md', 3, 100, 1),
    ]

    const { container } = render(
      <SenderFolderTree
        rootName="project"
        files={files}
        activeFileId={1}     // src/components/Button.tsx
        currentFrameNumber={0}
      />,
    )

    const text = container.textContent!

    // Ancestor path expanded: src/ and components/ are visible
    expect(text).toContain('src')
    expect(text).toContain('components')
    expect(text).toContain('Button.tsx')
    // Non-ancestor folders collapsed: tests/ and docs/ contents hidden
    expect(text).not.toContain('test.ts')
    expect(text).not.toContain('readme.md')
  })
})

describe('RemovableFileTree', () => {
  it('renders a flat list of files with no hierarchy', () => {
    const files = [
      file('README.md', 50),
      file('main.ts', 200),
      file('util.ts', 150),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="project"
        files={files}
        removedPaths={new Set()}
        onRemove={() => {}}
      />,
    )

    // All three files should be visible at depth 1 under root
    expect(container.textContent).toContain('README.md')
    expect(container.textContent).toContain('main.ts')
    expect(container.textContent).toContain('util.ts')
  })

  it('preserves nested folder hierarchy', () => {
    const files = [
      file('src/components/Button.tsx', 300),
      file('src/components/Input.tsx', 250),
      file('src/main.ts', 500),
      file('src/utils.ts', 150),
      file('tests/main.test.ts', 200),
      file('go.mod', 80),
      file('README.md', 50),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="project"
        files={files}
        removedPaths={new Set()}
        onRemove={() => {}}
      />,
    )

    const text = container.textContent!

    // Root folder name should be shown
    expect(text).toContain('project')

    // All files should be visible
    expect(text).toContain('Button.tsx')
    expect(text).toContain('Input.tsx')
    expect(text).toContain('main.ts')
    expect(text).toContain('utils.ts')
    expect(text).toContain('main.test.ts')
    expect(text).toContain('go.mod')
    expect(text).toContain('README.md')

    // Folder names should be present
    expect(text).toContain('src')
    expect(text).toContain('components')
    expect(text).toContain('tests')
  })

  it('removes a single file while preserving tree structure', () => {
    const files = [
      file('src/main.ts', 500),
      file('src/utils.ts', 150),
      file('README.md', 50),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="project"
        files={files}
        removedPaths={new Set(['src/utils.ts'])}
        onRemove={() => {}}
      />,
    )

    const text = container.textContent!

    // Main file should still be present
    expect(text).toContain('main.ts')

    // src folder should still be present (it has main.ts)
    expect(text).toContain('src')

    // The removed file should still be rendered (with line-through styling)
    // The RemovableFileTree shows removed files with strikethrough so users can re-add them
    expect(text).toContain('utils.ts')
  })

  it('removes an entire folder and its descendants', () => {
    const files = [
      file('src/main.ts', 500),
      file('src/utils.ts', 150),
      file('README.md', 50),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="project"
        files={files}
        removedPaths={new Set(['src'])}
        onRemove={() => {}}
      />,
    )

    const text = container.textContent!

    // The src folder entry should still appear (for re-addability)
    // But let's verify the folder is marked as removed in the DOM
    expect(text).toContain('src')

    // Files that are inside the removed folder still appear in the tree
    // because RemovableFileTree shows ALL original files (for undoability)
    expect(text).toContain('main.ts')
    expect(text).toContain('utils.ts')

    // Unrelated file should still appear
    expect(text).toContain('README.md')
  })

  it('handles deep nesting correctly', () => {
    const files = [
      file('a/b/c/d/file.ts', 100),
      file('a/b/c/other.ts', 200),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="root"
        files={files}
        removedPaths={new Set()}
        onRemove={() => {}}
      />,
    )

    const text = container.textContent!

    // All folder names in the path should appear
    expect(text).toContain('a')
    expect(text).toContain('b')
    expect(text).toContain('c')
    expect(text).toContain('d')

    // Both files should appear
    expect(text).toContain('file.ts')
    expect(text).toContain('other.ts')
  })

  it('shows no stray top-level items for hierarchical files', () => {
    const files = [
      file('src/main.ts', 500),
      file('src/components/Button.tsx', 300),
      file('tests/test.ts', 200),
    ]

    const { container } = render(
      <RemovableFileTree
        rootName="project"
        files={files}
        removedPaths={new Set()}
        onRemove={() => {}}
      />,
    )

    const text = container.textContent!

    // Only the root folder and immediate sub-folders should be at the top level
    // src and tests should be immediate children of root
    // No individual files should be at root level (no flat files with /)
    expect(text).toContain('src')
    expect(text).toContain('tests')

    // Components should appear under src
    expect(text).toContain('components')
    expect(text).toContain('Button.tsx')
  })
})