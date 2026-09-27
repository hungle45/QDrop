import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, Play, Pause, Square, QrCode, Gauge, Folder as FolderIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Slider } from '@/components/ui/slider'
import { bytesToHex } from '@/protocol'
import type { Manifest, FolderManifest } from '@/protocol'
import { QrRenderer, type QrDensity, type QrGridCell } from '@/qr/renderer'
import { useSender, FRAME_INTERVALS } from '@/hooks/use-sender'
import { QR_ERROR_LEVELS, QR_VERSION_PRESETS } from '@/qr/generator'
import type { QrErrorLevel } from '@/qr/generator'
import { FileList } from '@/components/FolderTree'

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
    qrConfig,
    setQrErrorLevel,
    setQrVersion,
    selectFile,
    selectFolder,
    startTransmission,
    pauseTransmission,
    resumeTransmission,
    stopTransmission,
  } = useSender()

  const [dragOver, setDragOver] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [qrScale, setQrScale] = useState(100)

  const handleFile = async (file: File) => {
    await selectFile(file)
  }

  const handleFolder = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    await selectFolder(fileArray)
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

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFolder(e.target.files)
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
      </Header>

      <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
        {state.state === 'idle' && (
          <FileSelector
            dragOver={dragOver}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            onFolderInput={handleFolderInput}
            onFileSelect={() => document.getElementById('file-input')?.click()}
            onFolderSelect={() => document.getElementById('folder-input')?.click()}
            fileInputKey={fileInputKey}
          />
        )}

        {(state.state === 'preparing' || state.state === 'ready') && !isActive && (
          state.isFolder ? (
            <FolderPreparingView
              folderManifest={state.folderManifest}
              onStart={startTransmission}
            />
          ) : (
            <PreparingView
              file={state.file!}
              manifest={state.manifest}
              onStart={startTransmission}
              density={density}
              onDensityChange={setDensity}
              frameInterval={frameInterval}
              onFrameIntervalChange={setFrameInterval}
              qrConfig={qrConfig}
              onQrErrorLevelChange={setQrErrorLevel}
              onQrVersionChange={setQrVersion}
            />
          )
        )}

        {isActive && (
          <TransmittingView
            state={state}
            manifest={state.manifest}
            folderManifest={state.folderManifest}
            displayCells={displayCells}
            density={density}
            frameInterval={frameInterval}
            onFrameIntervalChange={setFrameInterval}
            isPaused={isPaused}
            onPause={pauseTransmission}
            onResume={resumeTransmission}
            onStop={stopTransmission}
            qrScale={qrScale}
            onQrScaleChange={setQrScale}
            qrConfig={qrConfig}
          />
        )}

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
  onFolderInput,
  onFileSelect,
  onFolderSelect,
  fileInputKey,
}: {
  dragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFolderInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFileSelect: () => void
  onFolderSelect: () => void
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
      >
        <CardContent className="pt-12 pb-12 flex flex-col items-center gap-4">
          <div className="size-12 rounded-full bg-secondary flex items-center justify-center">
            <Upload className="size-5 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-medium text-foreground">
              Drop a file here
            </p>
            <p className="text-xs text-muted-foreground">
              or select a file or folder
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={onFileSelect}>
              Select File
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={onFolderSelect}>
              <FolderIcon className="size-3.5" />
              Select Folder
            </Button>
          </div>
          <input
            key={fileInputKey}
            id="file-input"
            type="file"
            className="hidden"
            onChange={onFileInput}
          />
          <input
            key={`folder-${fileInputKey}`}
            id="folder-input"
            type="file"
            className="hidden"
            // @ts-expect-error - webkitdirectory is a non-standard attribute
            webkitdirectory=""
            directory=""
            onChange={onFolderInput}
          />
          <p className="text-[10px] text-muted-foreground">
            Folder selection uses webkitdirectory (Chrome/Edge/Safari).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function FolderPreparingView({
  folderManifest,
  onStart,
}: {
  folderManifest: FolderManifest | null
  onStart: () => void
}) {
  if (!folderManifest) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Preparing folder...
      </div>
    )
  }

  const totalFrames = folderManifest.files.reduce((sum, f) => sum + f.frameCount, 0)
  const totalSize = folderManifest.files.reduce((sum, f) => sum + f.size, 0)

  const fileList = folderManifest.files.map(f => ({
    path: f.path,
    size: f.size,
    frameCount: f.frameCount,
  }))

  return (
    <div className="space-y-6 pt-8">
      <Card>
        <CardContent className="pt-6 pb-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-secondary flex items-center justify-center">
              <FolderIcon className="size-5 text-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {folderManifest.rootName}/
              </p>
              <p className="text-xs text-muted-foreground">
                {folderManifest.files.length} files &middot; {formatSize(totalSize)} &middot; {totalFrames} frames
              </p>
            </div>
          </div>

          <Separator />

          <FileList rootName={folderManifest.rootName} files={fileList} />

          <Separator />

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Files</span>
            <span className="font-mono text-foreground">{folderManifest.files.length}</span>
            <span className="text-muted-foreground">Total Size</span>
            <span className="font-mono text-foreground">{formatSize(totalSize)}</span>
            <span className="text-muted-foreground">Total Frames</span>
            <span className="font-mono text-foreground">{totalFrames}</span>
          </div>

          <Button className="w-full gap-2" onClick={onStart}>
            <Play className="size-4" />
            Start Transmission
          </Button>
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
  qrConfig,
  onQrErrorLevelChange,
  onQrVersionChange,
}: {
  file: File
  manifest: Manifest | null
  onStart: () => void
  density: QrDensity
  onDensityChange: (d: QrDensity) => void
  frameInterval: number
  onFrameIntervalChange: (ms: number) => void
  qrConfig: { errorCorrectionLevel: QrErrorLevel; version?: number }
  onQrErrorLevelChange: (level: QrErrorLevel) => void
  onQrVersionChange: (v: number | undefined) => void
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

          <QrConfigControl
            config={qrConfig}
            onErrorLevelChange={onQrErrorLevelChange}
            onVersionChange={onQrVersionChange}
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
  folderManifest,
  displayCells,
  density,
  frameInterval,
  onFrameIntervalChange,
  isPaused,
  onPause,
  onResume,
  onStop,
  qrScale,
  onQrScaleChange,
  qrConfig,
}: {
  state: { totalFrames: number; cyclesCompleted: number; file: File | null; files: File[] | null; isFolder: boolean }
  manifest: Manifest | null
  folderManifest: FolderManifest | null
  displayCells: QrGridCell[]
  density: QrDensity
  frameInterval: number
  onFrameIntervalChange: (ms: number) => void
  isPaused: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  qrScale: number
  onQrScaleChange: (scale: number) => void
  qrConfig: { errorCorrectionLevel: QrErrorLevel; version?: number }
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {state.isFolder && folderManifest ? (
                <>
                  <p className="text-sm font-medium text-foreground truncate">
                    {folderManifest.rootName}/
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {folderManifest.files.length} files &middot; {state.totalFrames} frames
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground truncate">
                    {state.file?.name ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {state.file ? formatSize(state.file.size) : ''}
                  </p>
                </>
              )}
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
        <CardContent className="pt-6 pb-6 space-y-4">
          {displayCells.length > 0 ? (
            <>
              <div
                className="mx-auto transition-all duration-200"
                style={{
                  maxWidth: `${Math.max(25, qrScale)}%`,
                  width: '100%',
                }}
              >
                <QrRenderer
                  cells={displayCells}
                  density={density}
                />
              </div>
              <div className="flex items-center gap-3 max-w-xs mx-auto">
                <span className="text-xs text-muted-foreground shrink-0 w-8 text-right">
                  {qrScale}%
                </span>
                <Slider
                  value={[qrScale]}
                  onValueChange={(value) => onQrScaleChange(value[0])}
                  min={25}
                  max={100}
                  step={5}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              Generating QR codes...
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">
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
            <span className="text-border">|</span>
            <span>EC-{qrConfig.errorCorrectionLevel}</span>
            <span className="text-border">|</span>
            <span>v{qrConfig.version ?? 'auto'}</span>
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

function QrConfigControl({
  config,
  onErrorLevelChange,
  onVersionChange,
}: {
  config: { errorCorrectionLevel: QrErrorLevel; version?: number }
  onErrorLevelChange: (level: QrErrorLevel) => void
  onVersionChange: (v: number | undefined) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">QR Configuration</p>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Error Correction</p>
        <ToggleGroup
          type="single"
          value={config.errorCorrectionLevel}
          onValueChange={(v) => {
            if (v) onErrorLevelChange(v as QrErrorLevel)
          }}
          className="flex gap-1"
        >
          {QR_ERROR_LEVELS.map((l) => (
            <ToggleGroupItem key={l.value} value={l.value} size="sm" className="text-xs px-3">
              {l.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-[10px] text-muted-foreground">
          {QR_ERROR_LEVELS.find((l) => l.value === config.errorCorrectionLevel)?.recovery} recovery
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Version</p>
        <ToggleGroup
          type="single"
          value={config.version !== undefined ? String(config.version) : 'auto'}
          onValueChange={(v) => {
            if (v === 'auto') onVersionChange(undefined)
            else if (v) onVersionChange(Number(v))
          }}
          className="flex flex-wrap gap-1"
        >
          {QR_VERSION_PRESETS.map((p) => (
            <ToggleGroupItem key={p.label} value={p.value !== undefined ? String(p.value) : 'auto'} size="sm" className="text-xs px-2">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}