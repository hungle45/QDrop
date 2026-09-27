/**
 * SenderFolderTree — read-only folder tree for the QR generation view.
 *
 * Displays the final filtered folder hierarchy during active transmission.
 * - Highlights the file whose QR code is currently being displayed
 * - Shows per-file frame progress (e.g. `main.go 3/8`)
 * - Auto-scrolls to keep the active file visible
 * - All parent folders are auto-expanded so the active file is always reachable
 * - No editing / filtering / removal — purely a transfer-progress view
 *
 * This component is independent from the upload/prepare tree (RemovableFileTree).
 */

import { useMemo, useRef, useEffect } from 'react'
import { ChevronDown, File, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileProgress } from '@/transfer/receiver'
import { buildTree, type TreeNode } from './FolderTree'

export interface SenderFileEntry {
  path: string
  size: number
  frameCount: number
  fileId: number
}

export function SenderFolderTree({
  rootName,
  files,
  activeFileId,
  currentFrameNumber,
  className,
}: {
  rootName: string
  files: SenderFileEntry[]
  activeFileId: number | undefined
  currentFrameNumber: number | undefined
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Build tree on the fly — derived entirely from the filtered transfer data.
  const tree = useMemo(() => {
    const fileEntries = files.map((f) => ({
      fileId: f.fileId,
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

  // Auto-scroll: when the active file changes, scroll its element into view
  useEffect(() => {
    if (activeFileId === undefined) return
    const el = scrollRef.current?.querySelector(`[data-file-id="${activeFileId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeFileId])

  const activeFilePath = activeFileId !== undefined
    ? (files.find((f) => f.fileId === activeFileId)?.path ?? null)
    : null

  return (
    <div
      ref={scrollRef}
      className={cn('border border-border/50 rounded-md overflow-y-auto text-xs', className)}
    >
      <SenderTreeNode
        node={tree}
        depth={0}
        activeFileId={activeFileId}
        activeFilePath={activeFilePath}
        currentFrameNumber={currentFrameNumber}
      />
    </div>
  )
}

interface SenderTreeNodeProps {
  node: TreeNode
  depth: number
  activeFileId: number | undefined
  /** Full path of the active file, or null when no file is active.
   *  Used to decide whether this folder should be force-expanded. */
  activeFilePath: string | null
  currentFrameNumber: number | undefined
}

function SenderTreeNode({
  node,
  depth,
  activeFileId,
  activeFilePath,
  currentFrameNumber,
}: SenderTreeNodeProps) {
  // Active-file highlight logic
  const isActive =
    node.type === 'file' && node.fileId !== undefined && node.fileId === activeFileId

  // Does this folder node sit on the path to the active file?
  // When it does we force-expand it so the active file stays visible.
  const isAncestorOfActive =
    node.type === 'folder' &&
    activeFilePath !== null &&
    node.path !== undefined &&
    activeFilePath.startsWith(node.path + '/')

  if (node.type === 'file') {
    const total = node.progress?.frameCount ?? 0
    return (
      <div
        data-file-id={node.fileId}
        className={cn(
          'flex items-center gap-2 py-0.5 px-1 rounded-none text-xs',
          isActive ? 'bg-primary/10 text-foreground font-medium' : 'text-muted-foreground',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <File
          className={cn(
            'size-3.5 shrink-0',
            isActive ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        <span className={cn('truncate flex-1', isActive && 'text-foreground')}>
          {node.name}
        </span>
        {isActive && currentFrameNumber !== undefined && total > 0 && (
          <span className="font-mono tabular-nums shrink-0 text-primary">
            {currentFrameNumber + 1}/{total}
          </span>
        )}
      </div>
    )
  }

  // Folder node — expanded only when it's an ancestor of the active file.
  // The root (depth 0) is always visible since it's the tree entry point.
  // All other folders stay collapsed, keeping the tree focused on the
  // currently transferring file.
  const expanded = depth < 1 || isAncestorOfActive

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 px-1 text-muted-foreground text-xs"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        <ChevronDown className="size-3.5 shrink-0" />
        <Folder className="size-3.5 shrink-0" />
        <span>{node.name}</span>
        {node.children.length > 0 && (
          <span className="ml-0.5">({node.children.length})</span>
        )}
      </div>
      {expanded && (
        <div>
          {node.children.map((child, i) => (
            <SenderTreeNode
              key={`${child.name}-${i}`}
              node={child}
              depth={depth + 1}
              activeFileId={activeFileId}
              activeFilePath={activeFilePath}
              currentFrameNumber={currentFrameNumber}
            />
          ))}
        </div>
      )}
    </div>
  )
}