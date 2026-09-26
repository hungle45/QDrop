/**
 * Custom hook for the sender state machine.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { chunkFile } from '@/transfer/chunker'
import { createManifestFrame, createDataFrame, frameToQrData, sha256 } from '@/protocol'
import type { Manifest, EncodedFrame } from '@/protocol'
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

export const DEFAULT_FRAME_INTERVAL = 3000

export function useSender(): UseSenderReturn {
  const [state, setState] = useState<SenderTransfer>({
    state: 'idle',
    file: null,
    manifest: null,
    frames: [],
    currentFrameIndex: 0,
    totalFrames: 0,
    cyclesCompleted: 0,
    error: null,
  })

  const [displayCells, setDisplayCells] = useState<QrGridCell[]>([])
  const [density, setDensity] = useState<QrDensity>(1)
  const [frameInterval, setFrameIntervalState] = useState<number>(DEFAULT_FRAME_INTERVAL)
  const [qrErrorLevel, setQrErrorLevel] = useState<QrErrorLevel>('M')
  const [qrVersion, setQrVersion] = useState<number | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentIndexRef = useRef(0)
  const cyclesRef = useRef(0)
  const framesRef = useRef<EncodedFrame[]>([])
  const pauseRef = useRef(false)
  const intervalMsRef = useRef(DEFAULT_FRAME_INTERVAL)
  const selectedFileRef = useRef<File | null>(null)
  const generatingRef = useRef(false)

  const buildUserConfig = useCallback((): QrGenConfig => ({
    errorCorrectionLevel: qrErrorLevel,
    version: qrVersion,
    width: 256,
    margin: 4,
  }), [qrErrorLevel, qrVersion])

  const regenerateFrames = useCallback(async (file: File, config: QrGenConfig) => {
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

    return { manifest, frames }
  }, [])

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const advanceFrames = useCallback(async () => {
    if (generatingRef.current) return // already generating
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

      // Manifest frames use MANIFEST_QR_CONFIG, data frames use user config
      const userConfig = buildUserConfig()

      const dataUrls = await Promise.all(
        group.map(async (f) => {
          const qrData = frameToQrData(f.bytes)
          const baseConfig = f.isManifest ? MANIFEST_QR_CONFIG : userConfig
          // Scale pixel width for higher versions so modules stay readable (~3px min)
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

  const selectFile = useCallback(async (file: File) => {
    selectedFileRef.current = file
    setState((prev) => ({ ...prev, state: 'preparing' as SenderState, file }))

    try {
      const config = buildUserConfig()
      const { manifest, frames } = await regenerateFrames(file, config)
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
  }, [buildUserConfig, regenerateFrames])

  // Track previous config to detect real changes
  const prevConfigRef = useRef({ errorLevel: qrErrorLevel, version: qrVersion })

  // When QR config changes after file is ready, regenerate frames
  useEffect(() => {
    const prev = prevConfigRef.current
    prevConfigRef.current = { errorLevel: qrErrorLevel, version: qrVersion }

    // Only regenerate if config actually changed
    if (prev.errorLevel === qrErrorLevel && prev.version === qrVersion) return

    // Skip during transmission or if no file is ready
    if (!selectedFileRef.current || state.state === 'idle' || state.state === 'preparing') return
    if (state.state === 'transmitting' || state.state === 'paused') return

    const doRegen = async () => {
      const config = buildUserConfig()
      setState((prev) => ({ ...prev, state: 'preparing' as SenderState }))
      try {
        const { manifest, frames } = await regenerateFrames(selectedFileRef.current!, config)
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
        setState((prev) => ({ ...prev, state: 'ready' as SenderState }))
      }
    }
    doRegen()
  }, [qrErrorLevel, qrVersion, buildUserConfig, regenerateFrames, state.state])

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
    startTransmission,
    pauseTransmission,
    resumeTransmission,
    stopTransmission,
  }
}