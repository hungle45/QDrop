/**
 * Custom hook for the sender state machine.
 * Supports both single-file (Phase 1) and folder (Phase 2) transfers.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { chunkFile } from '@/transfer/chunker'
import {
  createManifestFrame,
  createDataFrame,
  createV2ManifestFrame,
  createV2DataFrame,
  frameToQrData,
  sha256,
  serializeFolderManifest,
  fragmentManifest,
  isPathSafe,
} from '@/protocol'
import type { Manifest, FolderManifest, ManifestFileEntry, EncodedFrame } from '@/protocol'
import type { SenderTransfer, SenderState } from '@/transfer/sender'
import { generateQrDataUrl, estimateMaxPayloadBytes, MANIFEST_QR_CONFIG, type QrGenConfig, type QrErrorLevel } from '@/qr/generator'
import { groupFramesForDisplay, type QrDensity, type QrGridCell } from '@/qr/renderer'

export type { QrDensity }

interface UseSenderReturn {
  state: SenderTransfer
  displayCells: QrGridCell[]
  density: QrDensity
  setDensity: (d: QrDensity) => void
  frameInterval: number
  setFrameInterval: (ms: number) => void
  qrConfig: QrGenConfig
  setQrErrorLevel: (level: QrErrorLevel) => void
  setQrVersion: (v: number | undefined) => void
  selectFile: (file: File) => Promise<void>
  selectFolder: (files: File[]) => Promise<void>
  startTransmission: () => void
  pauseTransmission: () => void
  resumeTransmission: () => void
  stopTransmission: () => void
}

export const FRAME_INTERVALS = [
  { label: 'Very Fast', value: 800 },
  { label: 'Fast', value: 1500 },
  { label: 'Normal', value: 3000 },
  { label: 'Slow', value: 5000 },
] as const

export const DEFAULT_FRAME_INTERVAL = 800

export function useSender(): UseSenderReturn {
  const [state, setState] = useState<SenderTransfer>({
    state: 'idle',
    file: null,
    files: null,
    manifest: null,
    folderManifest: null,
    frames: [],
    currentFrameIndex: 0,
    totalFrames: 0,
    cyclesCompleted: 0,
    error: null,
    isFolder: false,
  })

  const [displayCells, setDisplayCells] = useState<QrGridCell[]>([])
  const [density, setDensity] = useState<QrDensity>(1)
  const [frameInterval, setFrameIntervalState] = useState<number>(DEFAULT_FRAME_INTERVAL)
  const [qrErrorLevel, setQrErrorLevel] = useState<QrErrorLevel>('L')
  const [qrVersion, setQrVersion] = useState<number | undefined>(20)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentIndexRef = useRef(0)
  const cyclesRef = useRef(0)
  const framesRef = useRef<EncodedFrame[]>([])
  const pauseRef = useRef(false)
  const intervalMsRef = useRef(DEFAULT_FRAME_INTERVAL)
  const selectedFileRef = useRef<File | null>(null)
  const selectedFilesRef = useRef<File[] | null>(null)
  const generatingRef = useRef(false)

  const buildUserConfig = useCallback((): QrGenConfig => ({
    errorCorrectionLevel: qrErrorLevel,
    version: qrVersion,
    width: 256,
    margin: 4,
  }), [qrErrorLevel, qrVersion])

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const advanceFrames = useCallback(async () => {
    if (generatingRef.current) return
    const frames = framesRef.current
    if (frames.length === 0) return

    generatingRef.current = true
    try {
      const { group, nextIndex, wrapped } = groupFramesForDisplay(
        frames,
        density,
        currentIndexRef.current,
      )

      currentIndexRef.current = nextIndex

      if (wrapped) {
        cyclesRef.current++
        setState((prev) => ({ ...prev, cyclesCompleted: cyclesRef.current }))
      }

      const userConfig = buildUserConfig()

      const dataUrls = await Promise.all(
        group.map(async (f) => {
          const qrData = frameToQrData(f.bytes)
          const baseConfig = f.isManifest ? MANIFEST_QR_CONFIG : userConfig
          const modules = (baseConfig.version ?? 10) * 4 + 17
          const minWidth = Math.min(Math.max(modules * 3, 256), 600)
          const renderConfig = { ...baseConfig, width: Math.max(baseConfig.width, minWidth) }
          return generateQrDataUrl(qrData, renderConfig)
        }),
      )

      const cells: QrGridCell[] = group.map((frame, index) => ({
        frame,
        dataUrl: dataUrls[index],
      }))

      setDisplayCells(cells)
    } finally {
      generatingRef.current = false
    }
  }, [density, buildUserConfig])

  const startTimer = useCallback(() => {
    clearTimer()
    if (pauseRef.current) return
    intervalRef.current = setInterval(() => {
      if (pauseRef.current) return
      advanceFrames()
    }, intervalMsRef.current)
  }, [clearTimer, advanceFrames])

  // Track previous config to detect real changes
  const prevConfigRef = useRef({ errorLevel: qrErrorLevel, version: qrVersion })

  // When QR config changes after file is ready, regenerate frames
  useEffect(() => {
    const prev = prevConfigRef.current
    prevConfigRef.current = { errorLevel: qrErrorLevel, version: qrVersion }

    if (prev.errorLevel === qrErrorLevel && prev.version === qrVersion) return
    if (selectedFileRef.current && !selectedFilesRef.current &&
        state.state !== 'idle' && state.state !== 'preparing' &&
        state.state !== 'transmitting' && state.state !== 'paused') {
      const doRegen = async () => {
        const config = buildUserConfig()
        setState((prev) => ({ ...prev, state: 'preparing' as SenderState }))
        try {
          const maxPayload = estimateMaxPayloadBytes(config)
          const chunks = await chunkFile(selectedFileRef.current!, maxPayload)
          const transferId = crypto.getRandomValues(new Uint8Array(16))
          const fileHash = await sha256(selectedFileRef.current!)
          const manifest: Manifest = {
            transferId,
            filename: selectedFileRef.current!.name,
            fileSize: selectedFileRef.current!.size,
            totalFrames: chunks.length,
            fileHash,
            protocolVersion: 1,
          }
          const manifestFrame = createManifestFrame(manifest)
          const dataFrames = chunks.map((chunk, i) =>
            createDataFrame(transferId, i, chunks.length, chunk.data),
          )
          const frames = [manifestFrame, ...dataFrames]
          framesRef.current = frames
          currentIndexRef.current = 0
          cyclesRef.current = 0
          setState((prev) => ({
            ...prev,
            state: 'ready',
            manifest,
            frames,
            currentFrameIndex: 0,
            totalFrames: frames.length,
            cyclesCompleted: 0,
            error: null,
          }))
        } catch {
          setState((prev) => ({ ...prev, state: 'ready' as SenderState }))
        }
      }
      doRegen()
    }
  }, [qrErrorLevel, qrVersion, buildUserConfig, state.state])

  const selectFile = useCallback(async (file: File) => {
    selectedFileRef.current = file
    selectedFilesRef.current = null
    setState((prev) => ({ ...prev, state: 'preparing', file, files: null, isFolder: false }))

    try {
      const config = buildUserConfig()
      const maxPayload = estimateMaxPayloadBytes(config)
      const chunks = await chunkFile(file, maxPayload)
      const transferId = crypto.getRandomValues(new Uint8Array(16))
      const fileHash = await sha256(file)

      const manifest: Manifest = {
        transferId,
        filename: file.name,
        fileSize: file.size,
        totalFrames: chunks.length,
        fileHash,
        protocolVersion: 1,
      }

      const manifestFrame = createManifestFrame(manifest)
      const dataFrames = chunks.map((chunk, i) =>
        createDataFrame(transferId, i, chunks.length, chunk.data),
      )
      const frames = [manifestFrame, ...dataFrames]
      framesRef.current = frames
      currentIndexRef.current = 0
      cyclesRef.current = 0

      setState((prev) => ({
        ...prev,
        state: 'ready',
        manifest,
        frames,
        currentFrameIndex: 0,
        totalFrames: frames.length,
        cyclesCompleted: 0,
        error: null,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        state: 'idle',
        error: err instanceof Error ? err.message : 'Failed to prepare file',
      }))
    }
  }, [buildUserConfig])

  const selectFolder = useCallback(async (files: File[]) => {
    selectedFilesRef.current = files
    selectedFileRef.current = null
    setState((prev) => ({ ...prev, state: 'preparing', file: null, files, isFolder: true }))

    try {
      const config = buildUserConfig()
      const maxPayload = estimateMaxPayloadBytes(config)
      const transferId = crypto.getRandomValues(new Uint8Array(16))

      // Build folder manifest
      let fileIdCounter = 0
      const manifestFiles: ManifestFileEntry[] = []
      const allChunks: { fileId: number; chunks: { index: number; data: Uint8Array }[]; file: File }[] = []

      for (const file of files) {
        const fileId = fileIdCounter++
        const chunks = await chunkFile(file, maxPayload)
        const fileHash = await sha256(file)
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name

        if (!isPathSafe(relPath)) {
          throw new Error(`Unsafe path: ${relPath}`)
        }

        manifestFiles.push({
          fileId,
          path: relPath,
          size: file.size,
          frameCount: chunks.length,
          sha256: fileHash,
        })

        allChunks.push({ fileId, chunks, file })
      }

      // Derive root name
      const rootName = deriveRootName(files)

      const folderManifest: FolderManifest = {
        transferId,
        rootName,
        files: manifestFiles,
      }

      // Serialize and fragment manifest
      const manifestBytes = serializeFolderManifest(folderManifest)
      const maxManifestFragmentSize = Math.min(maxPayload, 800)
      const manifestFragments = fragmentManifest(manifestBytes, maxManifestFragmentSize)

      // Create manifest frames (v2)
      const manifestFrames: EncodedFrame[] = manifestFragments.map((frag, i) =>
        createV2ManifestFrame(transferId, i, manifestFragments.length, frag),
      )

      // Create data frames (v2) for each file
      const dataFrames: EncodedFrame[] = []
      for (const { fileId, chunks: fileChunks } of allChunks) {
        for (const chunk of fileChunks) {
          dataFrames.push(
            createV2DataFrame(transferId, fileId, chunk.index, fileChunks.length, chunk.data),
          )
        }
      }

      const frames = [...manifestFrames, ...dataFrames]
      framesRef.current = frames
      currentIndexRef.current = 0
      cyclesRef.current = 0

      setState((prev) => ({
        ...prev,
        state: 'ready',
        folderManifest,
        frames,
        currentFrameIndex: 0,
        totalFrames: frames.length,
        cyclesCompleted: 0,
        error: null,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        state: 'idle',
        error: err instanceof Error ? err.message : 'Failed to prepare folder',
      }))
    }
  }, [buildUserConfig])

  const startTransmission = useCallback(() => {
    if (state.frames.length === 0) return

    pauseRef.current = false
    setState((prev) => ({ ...prev, state: 'transmitting' }))

    advanceFrames()
    startTimer()
  }, [state.frames.length, advanceFrames, startTimer])

  const pauseTransmission = useCallback(() => {
    pauseRef.current = true
    setState((prev) => ({ ...prev, state: 'paused' }))
  }, [])

  const resumeTransmission = useCallback(() => {
    pauseRef.current = false
    setState((prev) => ({ ...prev, state: 'transmitting' }))
    advanceFrames()
    startTimer()
  }, [advanceFrames, startTimer])

  const stopTransmission = useCallback(() => {
    pauseRef.current = true
    clearTimer()
    setState((prev) => ({ ...prev, state: 'stopped' }))
    setDisplayCells([])
  }, [clearTimer])

  const setFrameInterval = useCallback((ms: number) => {
    setFrameIntervalState(ms)
    intervalMsRef.current = ms
    if (!pauseRef.current && intervalRef.current) {
      startTimer()
    }
  }, [startTimer])

  const qrConfig: QrGenConfig = {
    errorCorrectionLevel: qrErrorLevel,
    version: qrVersion,
    width: 256,
    margin: 4,
  }

  const handleSetQrVersion = useCallback((v: number | undefined) => {
    setQrVersion(v)
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => clearTimer()
  }, [clearTimer])

  return {
    state,
    displayCells,
    density,
    setDensity,
    frameInterval,
    setFrameInterval,
    qrConfig,
    setQrErrorLevel,
    setQrVersion: handleSetQrVersion,
    selectFile,
    selectFolder,
    startTransmission,
    pauseTransmission,
    resumeTransmission,
    stopTransmission,
  }
}

function deriveRootName(files: File[]): string {
  if (files.length === 0) return 'folder'
  const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath
  if (firstPath) {
    const topDir = firstPath.split('/')[0]
    if (topDir) return topDir
  }
  return 'folder'
}