/**
 * Custom hook for the sender state machine.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { type EncodedFrame, frameToQrData } from '@/protocol'
import { prepareTransfer, type SenderTransfer, type SenderState } from '@/transfer/sender'
import { generateQrDataUrl, MANIFEST_QR_CONFIG, type QrGenConfig, type QrErrorLevel } from '@/qr/generator'
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

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const advanceFrames = useCallback(async () => {
    const frames = framesRef.current
    if (frames.length === 0) return

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

    // Generate QR data URLs for the group
    // Manifest frames use MANIFEST_QR_CONFIG, data frames use user config
    const userConfig: QrGenConfig = {
      errorCorrectionLevel: qrErrorLevel,
      version: qrVersion,
      width: 256,
      margin: 4,
    }

    const dataUrls = await Promise.all(
      group.map(async (f) => {
        const qrData = frameToQrData(f.bytes)
        const config = f.isManifest ? MANIFEST_QR_CONFIG : userConfig
        return generateQrDataUrl(qrData, config)
      }),
    )

    const cells: QrGridCell[] = group.map((frame, index) => ({
      frame,
      dataUrl: dataUrls[index],
    }))

    setDisplayCells(cells)
  }, [density, qrErrorLevel, qrVersion])

  const startTimer = useCallback(() => {
    clearTimer()
    if (pauseRef.current) return
    intervalRef.current = setInterval(() => {
      if (pauseRef.current) return
      advanceFrames()
    }, intervalMsRef.current)
  }, [clearTimer, advanceFrames])

  // Clean up interval on unmount or state change
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [])

  const selectFile = useCallback(async (file: File) => {
    setState((prev) => ({ ...prev, state: 'preparing' as SenderState, file }))

    try {
      const { manifest, frames } = await prepareTransfer(file)
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
  }, [])

  const startTransmission = useCallback(() => {
    if (state.frames.length === 0) return

    pauseRef.current = false
    setState((prev) => ({ ...prev, state: 'transmitting' }))

    // Immediate first render
    advanceFrames()

    // Start cycling
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