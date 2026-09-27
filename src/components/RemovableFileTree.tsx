/**
 * RemovableFileTree — folder tree for the upload / preparation view.
 *
 * Lets the user configure what will be transferred by removing files or
 * entire folders.  Owns its own tree-building and removal behavior,
 * completely independent from the QR-generation tree (SenderFolderTree).
 *
 * Features:
 *   - Show folder hierarchy with expand/collapse
 *   - X button on hover to remove a file or folder
 *   - Removed items shown with strikethrough (re-addable)
 *   - Scrollable when the tree is large
 */

import { useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, File, Folder, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Public API ────────────────────────────────────────────────

export interface RemovableFileEntry {
  path: string
  size: number
  frameCount?: number
}

export function RemovableFileTree({
  rootName,
  files,
  removedPaths,
  onRemove,
  className,
}: {
  rootName: string
  files: RemovableFileEntry[]
  removedPaths: Set<string>
  onRemove: (path: string) => void
  className?: string
}) {
  const tree = useMemo(() => {
    const root: RemovableTreeNode = {
      name: rootName,
      path: '',
      type: 'folder',
      children: [],
      isRemoved: false,
    }

    for (const file of files) {
      const parts = file.path.split('/')
      let current = root

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const isLast = i === parts.length - 1
        const childPath = parts.slice(0, i + 1).join('/')

        if (isLast) {
          current.children.push({
            name: part,
            path: childPath,
            type: 'file',
            children: [],
            isRemoved: removedPaths.has(childPath),
            size: file.size,
          })
        } else {
          let folder = current.children.find(
            (c) => c.name === part && c.type === 'folder',
          )
          if (!folder) {
            folder = {
              name: part,
              path: childPath,
              type: 'folder',
              children: [],
              isRemoved: removedPaths.has(childPath),
            }
            current.children.push(folder)
          }
          if (removedPaths.has(childPath)) {
            folder.isRemoved = true
          }
          current = folder
        }
      }
    }

    const sortNodes = (node: RemovableTreeNode) => {
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      for (const child of node.children) {
        if (child.type === 'folder') sortNodes(child)
      }
    }
    sortNodes(root)

    return root
  }, [files, removedPaths])

  return (
    <div className={cn('border border-border/50 rounded-md overflow-y-auto text-xs', className)}>
      <RemovableTreeNodeComponent node={tree} depth={0} onRemove={onRemove} />
    </div>
  )
}

// ── Internal types & components ────────────────────────────────

interface RemovableTreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children: RemovableTreeNode[]
  isRemoved: boolean
  size?: number
}

function RemovableTreeNodeComponent({
  node,
  depth,
  onRemove,
  defaultExpanded,
}: {
  node: RemovableTreeNode
  depth: number
  onRemove: (path: string) => void
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? depth < 1)

  if (node.type === 'file') {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 py-1 px-1 rounded-none text-xs group',
          node.isRemoved ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <File className="size-3 shrink-0" />
        <span className={cn('truncate flex-1', !node.isRemoved && 'text-foreground')}>
          {node.name}
        </span>
        {node.size !== undefined && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {formatFileSize(node.size)}
          </span>
        )}
        <button
          onClick={() => onRemove(node.path)}
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive shrink-0"
          title={node.isRemoved ? 'Re-add file' : 'Remove file'}
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }

  // Folder
  const folderFileCount = countFiles(node)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-1 text-xs group',
          node.isRemoved ? 'text-muted-foreground/40 line-through' : 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <button
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          <Folder className="size-3 shrink-0" />
          <span className={cn('truncate', !node.isRemoved && 'text-foreground font-medium')}>
            {node.name}
          </span>
          <span className="text-[10px] text-muted-foreground/60 ml-1 tabular-nums">
            {folderFileCount}
          </span>
        </button>
        <button
          onClick={() => onRemove(node.path)}
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive shrink-0"
          title={node.isRemoved ? 'Re-add folder' : 'Remove folder'}
        >
          <X className="size-3" />
        </button>
      </div>
      {expanded && (
        <div>
          {node.children.map((child, i) => (
            <RemovableTreeNodeComponent
              key={`${child.name}-${i}`}
              node={child}
              depth={depth + 1}
              onRemove={onRemove}
              defaultExpanded
            />
          ))}
        </div>
      )}
    </div>
  )
}

function countFiles(node: RemovableTreeNode): number {
  let count = 0
  for (const child of node.children) {
    if (child.type === 'file') count++
    else count += countFiles(child)
  }
  return count
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}