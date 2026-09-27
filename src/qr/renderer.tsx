/**
 * QR Renderer component — displays frames in a configurable grid.
 *
 * This component is purely a UI concern. It takes already-generated
 * QR data URLs and arranges them in a grid according to the configured
 * density. Transmission logic is handled externally.
 */

import { type EncodedFrame } from '@/protocol'
import { cn } from '@/lib/utils'

export type QrDensity = 1 | 2

export interface QrGridCell {
  frame: EncodedFrame
  dataUrl: string
}

interface QrRendererProps {
  /** Cells to display. Must be exactly density*density in number. */
  cells: QrGridCell[]
  /** Grid density (1 = 1×1, 2 = 2×2) */
  density: QrDensity
  /** Optional className override */
  className?: string
}

export function QrRenderer({ cells, density, className }: QrRendererProps) {
  const gridCols = density === 2 ? 'grid-cols-2' : 'grid-cols-1'

  return (
    <div className={cn('grid gap-2', gridCols, className)}>
      {cells.map((cell) => (
        <div
          key={cell.frame.number + '-' + (cell.frame.fileId ?? 0)}
          className="flex flex-col items-center gap-1"
        >
          <img
            src={cell.dataUrl}
            alt={`Frame ${cell.frame.number}`}
            className="w-full h-auto bg-white rounded-sm p-1"
            draggable={false}
          />
          <span className="text-[10px] text-muted-foreground font-mono">
            {frameLabel(cell.frame)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Build a human-readable label for a frame, showing file context.
 */
function frameLabel(frame: EncodedFrame): string {
  if (frame.isManifest && frame.manifestTotalFrames !== undefined) {
    const idx = frame.manifestFragmentIndex ?? frame.number
    return `Manifest ${idx + 1}/${frame.manifestTotalFrames}`
  }
  if (frame.isManifest) {
    return 'Manifest'
  }
  if (frame.fileId !== undefined && frame.totalFrames !== undefined) {
    return `File ${frame.fileId} · ${frame.number + 1}/${frame.totalFrames}`
  }
  if (frame.fileId !== undefined) {
    return `File ${frame.fileId} · #${frame.number}`
  }
  return `#${frame.number}`
}

/**
 * Hook to help with QR cell management.
 * Splits a list of frames into display groups of the right size.
 */
export function groupFramesForDisplay(
  frames: EncodedFrame[],
  density: QrDensity,
  startIndex: number,
): { group: EncodedFrame[]; nextIndex: number; wrapped: boolean } {
  const groupSize = density * density
  const result: EncodedFrame[] = []
  let idx = startIndex
  let wrapped = false

  for (let i = 0; i < groupSize; i++) {
    if (idx >= frames.length) {
      idx = 0
      wrapped = true
    }
    result.push(frames[idx])
    idx++
  }

  return { group: result, nextIndex: idx, wrapped }
}