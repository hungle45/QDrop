/**
 * FolderTree — displays a folder/file tree with per-file progress.
 * Used on the receiver side to show live folder transfer progress.
 */

import { useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, File, Folder, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileProgress } from '@/transfer/receiver'

interface TreeNode {
  name: string
  type: 'file' | 'folder'
  path?: string
  fileId?: number
  progress?: FileProgress
  children: TreeNode[]
}

interface FolderTreeProps {
  rootName: string
  fileProgress: Map<number, FileProgress>
  className?: string
}

/**
 * Build a tree structure from flat file paths with progress data.
 */
function buildTree(rootName: string, fileProgress: Map<number, FileProgress>): TreeNode {
  const root: TreeNode = {
    name: rootName,
    type: 'folder',
    children: [],
  }

  for (const [, progress] of fileProgress) {
    const parts = progress.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1

      if (isLast) {
        current.children.push({
          name: part,
          type: 'file',
          path: progress.path,
          fileId: progress.fileId,
          progress,
          children: [],
        })
      } else {
        let folder = current.children.find((c) => c.name === part && c.type === 'folder')
        if (!folder) {
          folder = {
            name: part,
            type: 'folder',
            children: [],
          }
          current.children.push(folder)
        }
        current = folder
      }
    }
  }

  return sortTree(root)
}

/**
 * Sort tree nodes: folders first, then alphabetical within each group.
 */
function sortTree(node: TreeNode): TreeNode {
  const sorted = [...node.children].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return {
    ...node,
    children: sorted.map((child) =>
      child.type === 'folder' ? sortTree(child) : child,
    ),
  }
}

interface TreeNodeComponentProps {
  node: TreeNode
  depth: number
  defaultExpanded?: boolean
}

function TreeNodeComponent({ node, depth, defaultExpanded }: TreeNodeComponentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? depth < 1)

  if (node.type === 'file') {
    const progress = node.progress
    const received = progress ? progress.receivedFrames.size : 0
    const total = progress ? progress.frameCount : 0
    const isVerified = progress?.verified
    const hasError = progress?.error

    return (
      <div
        className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-muted/30 text-xs"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <File className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 text-foreground">{node.name}</span>
        <span className={cn(
          'font-mono tabular-nums shrink-0',
          isVerified ? 'text-green-500' : hasError ? 'text-red-500' : 'text-muted-foreground',
        )}>
          {isVerified ? (
            <CheckCircle2 className="size-3.5 inline" />
          ) : hasError ? (
            <XCircle className="size-3.5 inline" />
          ) : (
            `${received}/${total}`
          )}
        </span>
      </div>
    )
  }

  // Folder
  return (
    <div>
      <button
        className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-muted/30 w-full text-left text-xs"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-foreground font-medium">{node.name}</span>
        {node.children.length > 0 && (
          <span className="text-muted-foreground ml-1">({node.children.length})</span>
        )}
      </button>
      {expanded && (
        <div>
          {node.children.map((child, i) => (
            <TreeNodeComponent
              key={`${child.name}-${i}`}
              node={child}
              depth={depth + 1}
              defaultExpanded={depth < 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function FolderTree({ rootName, fileProgress, className }: FolderTreeProps) {
  const tree = useMemo(
    () => buildTree(rootName, fileProgress),
    [rootName, fileProgress],
  )

  // Also compute overall progress
  const { totalReceived, totalExpected } = useMemo(() => {
    let received = 0
    let expected = 0
    for (const [, progress] of fileProgress) {
      received += progress.receivedFrames.size
      expected += progress.frameCount
    }
    return { totalReceived: received, totalExpected: expected }
  }, [fileProgress])

  const overallPercent = totalExpected > 0
    ? Math.round((totalReceived / totalExpected) * 100)
    : 0

  return (
    <div className={cn('space-y-3', className)}>
      <div className="text-xs text-muted-foreground font-mono">
        {totalReceived} / {totalExpected} frames &middot; {overallPercent}%
      </div>
      <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-primary h-full transition-all duration-300 rounded-full"
          style={{ width: `${overallPercent}%` }}
        />
      </div>
      <div className="border border-border/50 rounded-md p-2 max-h-80 overflow-y-auto">
        <TreeNodeComponent node={tree} depth={0} defaultExpanded />
      </div>
    </div>
  )
}

/**
 * A simpler file list variant for the sender side (no progress tracking).
 */
export function FileList({ rootName, files }: { rootName: string; files: { path: string; size: number; frameCount: number }[] }) {
  const tree = useMemo(() => {
    const fileEntries = files.map((f, i) => ({
      fileId: i,
      path: f.path,
      size: f.size,
      frameCount: f.frameCount,
      sha256: new Uint8Array(32),
      receivedFrames: new Set<number>(),
      verified: false,
    }))
    const progressMap = new Map<number, FileProgress>()
    for (const fe of fileEntries) {
      progressMap.set(fe.fileId, fe)
    }
    return buildTree(rootName, progressMap)
  }, [rootName, files])

  return (
    <div className="border border-border/50 rounded-md p-2 max-h-60 overflow-y-auto text-xs">
      <TreeNodeComponent node={tree} depth={0} defaultExpanded />
    </div>
  )
}

