import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Play, Pause, Square, QrCode, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { bytesToHex } from '@/protocol'
import type { Manifest } from '@/protocol'
import { ThemeToggle } from '@/components/common/theme-toggle'
import { QrRenderer, type QrDensity, type QrGridCell } from '@/qr/renderer'
import { useSender, FRAME_INTERVALS } from '@/hooks/use-sender'

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, i)
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function Send() {
  const navigate = useNavigate()
  const {
    state,
    displayCells,
    density,
    setDensity,
    frameInterval,
    setFrameInterval,
    selectFile,
    startTransmission,
    pauseTransmission,
    resumeTransmission,
    stopTransmission,
  } = useSender()

  const [dragOver, setDragOver] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [previewCell, setPreviewCell] = useState<QrGridCell | null>(null)

  const handleFile = async (file: File) => {
    await selectFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const isTransmitting = state.state === 'transmitting'
  const isPaused = state.state === 'paused'
  const isActive = isTransmitting || isPaused

  return (
    <div className="min-h-screen flex flex-col">
      <Header>
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium text-foreground">Send</span>
        <div className="flex-1" />
        <ThemeToggle />
      </Header>

      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
        {state.state === 'idle' && (
          <FileSelector
            dragOver={dragOver}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            onFileSelect={() => document.getElementById('file-input')?.click()}
            fileInputKey={fileInputKey}
          />
        )}

        {(state.state === 'preparing' || state.state === 'ready') && !isActive && (
          <PreparingView
            file={state.file!}
            manifest={state.manifest}
            onStart={startTransmission}
            density={density}
            onDensityChange={setDensity}
            frameInterval={frameInterval}
            onFrameIntervalChange={setFrameInterval}
          />
        )}

        {isActive && (
          <TransmittingView
            state={state}
            manifest={state.manifest}
            displayCells={displayCells}
            density={density}
            frameInterval={frameInterval}
            onFrameIntervalChange={setFrameInterval}
            isPaused={isPaused}
            onPause={pauseTransmission}
            onResume={resumeTransmission}
            onStop={stopTransmission}
            onCellClick={setPreviewCell}
          />
        )}

        <Dialog open={!!previewCell} onOpenChange={(open) => !open && setPreviewCell(null)}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] w-fit h-fit">
            <DialogTitle className="sr-only">QR Code Preview</DialogTitle>
            {previewCell && (
              <div className="flex flex-col items-center gap-2 p-2">
                <img
                  src={previewCell.dataUrl}
                  alt={`Frame ${previewCell.frame.number}`}
                  className="max-w-[80vw] max-h-[75vh] w-auto h-auto object-contain"
                />
                <p className="text-sm text-muted-foreground font-mono">
                  Frame #{previewCell.frame.number}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {state.state === 'stopped' && (
          <StoppedView
            onSendAnother={() => {
              setFileInputKey((k) => k + 1)
              stopTransmission()
            }}
            onGoHome={() => navigate('/')}
          />
        )}
      </div>
    </div>
  )
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <header className="flex items-center gap-2 px-4 h-14 border-b border-border/50">
      {children}
    </header>
  )
}

function FileSelector({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  onFileSelect,
  fileInputKey,
}: {
  dragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFileSelect: () => void
  fileInputKey: number
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card
        className={`w-full max-w-md cursor-pointer border-dashed transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onFileSelect}
      >
        <CardContent className="pt-16 pb-16 flex flex-col items-center gap-4">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Upload className="size-5 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              Drop a file here
            </p>
            <p className="text-xs text-muted-foreground">
              or click to select
            </p>
          </div>
          <input
            key={fileInputKey}
            id="file-input"
            type="file"
            className="hidden"
            onChange={onFileInput}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function PreparingView({
  file,
  manifest,
  onStart,
  density,
  onDensityChange,
  frameInterval,
  onFrameIntervalChange,
}: {
  file: File
  manifest: Manifest | null
  onStart: () => void
  density: QrDensity
  onDensityChange: (d: QrDensity) => void
  frameInterval: number
  onFrameIntervalChange: (ms: number) => void
}) {
  return (
    <div className="space-y-6 pt-8">
      <Card>
        <CardContent className="pt-6 pb-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-secondary flex items-center justify-center">
              <QrCode className="size-5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatSize(file.size)} &middot; {manifest ? `${manifest.totalFrames} frames` : '...'}
              </p>
            </div>
          </div>

          {manifest && (
            <>
              <Separator />
              <ManifestDetails manifest={manifest} />
            </>
          )}

          <Separator />

          <SpeedControl
            frameInterval={frameInterval}
            onFrameIntervalChange={onFrameIntervalChange}
          />

          <QrDensityControl
            density={density}
            onDensityChange={onDensityChange}
          />

          <Button className="w-full gap-2" onClick={onStart}>
            <Play className="size-4" />
            Start Transmission
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function TransmittingView({
  state,
  manifest,
  displayCells,
  density,
  frameInterval,
  onFrameIntervalChange,
  isPaused,
  onPause,
  onResume,
  onStop,
  onCellClick,
}: {
  state: { totalFrames: number; cyclesCompleted: number; file: File | null }
  manifest: Manifest | null
  displayCells: QrGridCell[]
  density: QrDensity
  frameInterval: number
  onFrameIntervalChange: (ms: number) => void
  isPaused: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onCellClick: (cell: QrGridCell) => void
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {state.file?.name ?? 'Unknown'}
              </p>
              <p className="text-xs text-muted-foreground">
                {state.file ? formatSize(state.file.size) : ''}
              </p>
            </div>
            <Badge variant={isPaused ? 'secondary' : 'default'}>
              {isPaused ? 'Paused' : 'Transmitting'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {manifest && (
        <Card>
          <CardContent className="pt-3 pb-3">
            <ManifestDetails manifest={manifest} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 pb-6">
          {displayCells.length > 0 ? (
            <QrRenderer
              cells={displayCells}
              density={density}
              className="max-w-sm mx-auto"
              onCellClick={onCellClick}
            />
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Generating QR codes...
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground mt-2">
            Cycle {state.cyclesCompleted + 1}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-3 pb-3 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>QR: {density}×{density}</span>
            <span className="text-border">|</span>
            <span>{FRAME_INTERVALS.find(i => i.value === frameInterval)?.label ?? 'Normal'}</span>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <SpeedControl
            frameInterval={frameInterval}
            onFrameIntervalChange={onFrameIntervalChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 flex items-center justify-center gap-2">
          {isPaused ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={onResume}>
              <Play className="size-3" />
              Resume
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-2" onClick={onPause}>
              <Pause className="size-3" />
              Pause
            </Button>
          )}
          <Button variant="destructive" size="sm" className="gap-2" onClick={onStop}>
            <Square className="size-3" />
            Stop
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StoppedView({
  onSendAnother,
  onGoHome,
}: {
  onSendAnother: () => void
  onGoHome: () => void
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
          <p className="text-sm text-muted-foreground">Transmission stopped</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onSendAnother}>
              Send Another File
            </Button>
            <Button variant="ghost" size="sm" onClick={onGoHome}>
              Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ManifestDetails({ manifest }: { manifest: Manifest }) {
  const transferIdHex = bytesToHex(manifest.transferId)
  const hashHex = bytesToHex(manifest.fileHash)

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

function SpeedControl({
  frameInterval,
  onFrameIntervalChange,
}: {
  frameInterval: number
  onFrameIntervalChange: (ms: number) => void
}) {
  const current = FRAME_INTERVALS.find((i) => i.value === frameInterval) ?? FRAME_INTERVALS[2]

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Transmission Speed</p>
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-muted-foreground shrink-0" />
        <ToggleGroup
          type="single"
          value={String(frameInterval)}
          onValueChange={(v) => {
            if (v) onFrameIntervalChange(Number(v))
          }}
          className="flex gap-1"
        >
          {FRAME_INTERVALS.map((i) => (
            <ToggleGroupItem
              key={i.value}
              value={String(i.value)}
              size="sm"
              className="text-xs px-3"
            >
              {i.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-xs text-muted-foreground font-mono ml-auto tabular-nums">
          {current.value / 1000}s
        </span>
      </div>
    </div>
  )
}

function QrDensityControl({
  density,
  onDensityChange,
}: {
  density: QrDensity
  onDensityChange: (d: QrDensity) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">QR Density</p>
      <ToggleGroup
        type="single"
        value={String(density)}
        onValueChange={(v) => {
          if (v) onDensityChange(Number(v) as QrDensity)
        }}
        className="flex gap-1"
      >
        <ToggleGroupItem value="1" size="sm" className="text-xs px-3">
          1 × 1
        </ToggleGroupItem>
        <ToggleGroupItem value="2" size="sm" className="text-xs px-3">
          2 × 2
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}