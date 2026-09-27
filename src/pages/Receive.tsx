import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, ScanLine, Download, RotateCcw, CheckCircle2, XCircle, LoaderCircle, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { useReceiver } from '@/hooks/use-receiver'
import type { Manifest } from '@/protocol'
import type { ReceiverTransfer, FileProgress } from '@/transfer/receiver'
import { FolderTree } from '@/components/FolderTree'
import {
  computeMissingFramesFile,
  computeMissingFramesFolder,
  formatMissingFrameList,
  formatDisplayMissingFrames,
} from '@/transfer/range-parser'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function Receive() {
  const navigate = useNavigate()
  const { state, videoRef, startReceiving, stopReceiving, retry } = useReceiver()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-2 px-4 h-14 border-b border-border/50">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">Receive</span>
        <div className="flex-1" />
        {(state.state === 'scanning' || state.state === 'receiving') && (
          <Button variant="ghost" size="sm" onClick={stopReceiving}>
            Stop
          </Button>
        )}
      </header>

      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
        {state.state === 'idle' && <IdleView onStart={startReceiving} />}

        {(state.state === 'camera_permission' || state.state === 'scanning' || state.state === 'receiving') && (
          <ScanningView state={state} videoRef={videoRef} />
        )}

        {(state.state === 'reconstructing' || state.state === 'verifying') && (
          <LoadingView message={
            state.state === 'reconstructing'
              ? 'Reconstructing file...'
              : 'Verifying file integrity...'
          } />
        )}

        {state.state === 'complete' && <CompleteView state={state} />}

        {state.state === 'failed' && <FailedView error={state.error} onRetry={retry} />}
      </div>
    </div>
  )
}

function IdleView({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="pt-16 pb-16 flex flex-col items-center gap-4">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Camera className="size-5 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              Ready to receive
            </p>
            <p className="text-xs text-muted-foreground">
              Point your camera at a sender's QR codes
            </p>
          </div>
          <Button className="gap-2" onClick={onStart}>
            <ScanLine className="size-4" />
            Start Receiving
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function LoadingView({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-12 pb-12 flex flex-col items-center gap-4">
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ScanningView({
  state,
  videoRef,
}: {
  state: ReceiverTransfer
  videoRef: React.RefObject<HTMLVideoElement | null>
}) {
  const isV1 = !!state.manifest
  const isV2 = !!state.folderManifest

  const progress = isV1 && state.totalFrames > 0
    ? Math.round((state.receivedFrames.size / state.totalFrames) * 100)
    : 0

  const isStarting = state.state === 'camera_permission'
  const isScanning = state.state === 'scanning'
  const isReceiving = state.state === 'receiving'

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="aspect-square bg-black relative overflow-hidden w-full max-w-sm mx-auto">
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-125"
            playsInline
            muted
          />
          {isStarting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="flex flex-col items-center gap-2">
                <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Starting camera...</span>
              </div>
            </div>
          )}
          {isScanning && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="size-32 border-2 border-primary/40 rounded-lg" />
            </div>
          )}
          {isReceiving && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Badge variant="default">
                Receiving...
              </Badge>
            </div>
          )}
        </div>
      </Card>

      {isV2 && state.folderManifest ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <FolderTree
              rootName={state.folderManifest.rootName}
              fileProgress={state.fileProgress}
            />
            <Separator />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Duplicates</span>
                <p className="font-mono text-foreground">{state.duplicateCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Invalid</span>
                <p className="font-mono text-foreground">{state.invalidCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Files</span>
                <p className="font-mono text-foreground">{state.folderManifest.files.length}</p>
              </div>
            </div>
            {state.manifestFragments.size > 0 && state.manifestTotalFragments > 0 && (
              <>
                <Separator />
                <div className="text-xs text-muted-foreground">
                  Manifest: {state.manifestFragments.size}/{state.manifestTotalFragments} fragments
                </div>
              </>
            )}
            <MissingFramesFolder fileProgress={state.fileProgress} />
          </CardContent>
        </Card>
      ) : isV1 ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {state.manifest!.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(state.manifest!.fileSize)} &middot; {state.totalFrames} frames
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {state.receivedFrames.size} / {state.totalFrames} frames
                </span>
                <span className="font-mono text-foreground">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Received</span>
                <p className="font-mono text-foreground">{state.receivedFrames.size}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Duplicates</span>
                <p className="font-mono text-foreground">{state.duplicateCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Invalid</span>
                <p className="font-mono text-foreground">{state.invalidCount}</p>
              </div>
            </div>
            <MissingFramesFile receivedFrames={state.receivedFrames} totalFrames={state.totalFrames} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <ScanLine className="size-4 animate-pulse text-primary" />
              <p className="text-xs text-muted-foreground">
                Scanning for QR codes...
              </p>
            </div>
            <Separator />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Received</span>
                <p className="font-mono text-foreground">{state.receivedFrames.size + state.fileProgress.size}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Duplicates</span>
                <p className="font-mono text-foreground">{state.duplicateCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Invalid</span>
                <p className="font-mono text-foreground">{state.invalidCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {state.manifest && !isScanning && (
        <Card>
          <CardContent className="pt-3 pb-3">
            <ManifestDetailsReceiver manifest={state.manifest} />
          </CardContent>
        </Card>
      )}

      {(isScanning || isReceiving) && state.frameLog.length > 0 && (
        <Card>
          <CardContent className="pt-3 pb-3 max-h-48 overflow-y-auto">
            <p className="text-xs font-medium text-foreground uppercase tracking-wider mb-2">
              Scan Log
            </p>
            <div className="space-y-0.5">
              {state.frameLog.slice(-30).reverse().map((entry, i) => (
                <div key={entry.time + '-' + i} className="flex items-center gap-2 text-xs font-mono">
                  <span className={
                    entry.type === 'new' ? 'text-green-500' :
                    entry.type === 'duplicate' ? 'text-yellow-500' :
                    entry.type === 'invalid' ? 'text-red-500' :
                    'text-blue-500'
                  }>
                    {entry.type === 'new' ? '✓' :
                     entry.type === 'duplicate' ? '↻' :
                     entry.type === 'invalid' ? '✗' :
                     '◈'}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function CompleteView({ state }: { state: ReceiverTransfer }) {
  const handleDownload = useCallback(async () => {
    if (state.outputFiles && state.outputFiles.size > 0 && state.folderManifest) {
      // Folder transfer: create a single ZIP with the original folder structure
      const { createFolderZip } = await import('@/transfer/receiver')
      const zipBlob = await createFolderZip(state.folderManifest.rootName, state.outputFiles)
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${state.folderManifest.rootName}.zip`
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    if (!state.blob || !state.manifest) return
    const url = URL.createObjectURL(state.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = state.manifest.filename
    a.click()
    URL.revokeObjectURL(url)
  }, [state.blob, state.manifest, state.outputFiles, state.folderManifest])

  const isFolder = state.folderManifest !== null
  const fileCount = state.outputFiles?.size ?? 1

  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4">
          <div className="size-12 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle2 className="size-6 text-green-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-lg font-medium text-foreground">
              {isFolder ? 'Folder Received' : 'Transfer Complete'}
            </p>
            {isFolder && state.folderManifest ? (
              <>
                <p className="text-sm font-medium text-foreground truncate max-w-full">
                  {state.folderManifest.rootName}/
                </p>
                <p className="text-xs text-muted-foreground">
                  {fileCount} files
                </p>
              </>
            ) : state.manifest ? (
              <>
                <p className="text-sm font-medium text-foreground truncate max-w-full">
                  {state.manifest.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(state.manifest.fileSize)}
                </p>
              </>
            ) : null}
          </div>
          <Button className="gap-2 mt-2" onClick={handleDownload}>
            <Download className="size-4" />
            {isFolder ? 'Download ZIP' : 'Download File'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function FailedView({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4">
          <div className="size-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <XCircle className="size-6 text-red-500" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-lg font-medium text-foreground">
              Verification Failed
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {error || 'An error occurred during transfer.'}
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={onRetry}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function MissingFramesFile({
  receivedFrames,
  totalFrames,
}: {
  receivedFrames: Map<number, Uint8Array>
  totalFrames: number
}) {
  const { displayText, copyText, hasMissing } = useMemo(() => {
    const missing = computeMissingFramesFile(receivedFrames, totalFrames)
    if (missing.size === 0) {
      return { displayText: '', copyText: '', hasMissing: false }
    }
    const copyText = formatMissingFrameList(new Map([['', missing]]))
    const displayText = formatDisplayMissingFrames(new Map([['', missing]]))
    return { displayText, copyText, hasMissing: true }
  }, [receivedFrames, totalFrames])

  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [copyText])

  if (!hasMissing) return null

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground uppercase tracking-wider">
          Missing Frames
        </p>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-foreground flex-1">
            {displayText}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy missing frame ranges'}
          >
            {copied ? (
              <Check className="size-3 text-green-500" />
            ) : (
              <Copy className="size-3 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>
    </>
  )
}

function MissingFramesFolder({
  fileProgress,
}: {
  fileProgress: Map<number, FileProgress>
}) {
  const { displayText, copyText, hasMissing } = useMemo(() => {
    const missing = computeMissingFramesFolder(fileProgress)
    if (missing.size === 0) {
      return { displayText: '', copyText: '', hasMissing: false }
    }
    const copyText = formatMissingFrameList(missing)
    const displayText = formatDisplayMissingFrames(missing)
    return { displayText, copyText, hasMissing: true }
  }, [fileProgress])

  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [copyText])

  if (!hasMissing) return null

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground uppercase tracking-wider">
          Missing Frames
        </p>
        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed">
          {displayText}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3 text-green-500" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </>
  )
}

function ManifestDetailsReceiver({ manifest }: { manifest: Manifest }) {
  const transferIdHex = Array.from(manifest.transferId)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const hashHex = Array.from(manifest.fileHash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground uppercase tracking-wider">
        Manifest
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-muted-foreground">Transfer ID</span>
        <span className="font-mono text-foreground truncate" title={transferIdHex}>
          {transferIdHex.slice(0, 16)}...
        </span>
        <span className="text-muted-foreground">Frames</span>
        <span className="font-mono text-foreground">{manifest.totalFrames}</span>
        <span className="text-muted-foreground">Protocol</span>
        <span className="font-mono text-foreground">v{manifest.protocolVersion}</span>
        <span className="text-muted-foreground">File Hash</span>
        <span className="font-mono text-foreground truncate" title={hashHex}>
          {hashHex.slice(0, 16)}...
        </span>
      </div>
    </div>
  )
}