/**
 * Custom hook for the receiver state machine.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { decodeQrData } from '@/protocol'
import { sha256, equalBytes } from '@/protocol'
import { type ReceiverTransfer, type ReceiverState, addFrame, reconstructFile } from '@/transfer/receiver'
import { startCamera, stopCamera, getImageDataFromVideo, scanImageData, type ScanResult } from '@/qr/scanner'

interface UseReceiverReturn {
  state: ReceiverTransfer
  videoRef: React.RefObject<HTMLVideoElement | null>
  startReceiving: () => Promise<void>
  stopReceiving: () => void
  retry: () => void
}

export function useReceiver(): UseReceiverReturn {
  const [transfer, setTransfer] = useState<ReceiverTransfer>({
    state: 'idle',
    manifest: null,
    receivedFrames: new Map(),
    totalFrames: 0,
    duplicateCount: 0,
    invalidCount: 0,
    error: null,
    blob: null,
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transferRef = useRef(transfer)

  // Keep ref in sync
  useEffect(() => {
    transferRef.current = transfer
  }, [transfer])

  const processScanResult = useCallback((scanResult: ScanResult) => {
    const current = transferRef.current
    if (current.state !== 'scanning' && current.state !== 'receiving') return

    const decoded = decodeQrData(scanResult.data)

    if (decoded.type === 'invalid') {
      setTransfer((prev) => ({ ...prev, invalidCount: prev.invalidCount + 1 }))
      return
    }

    if (decoded.type === 'manifest' && !current.manifest) {
      const manifest = decoded.manifest
      setTransfer((prev) => ({
        ...prev,
        manifest,
        totalFrames: manifest.totalFrames,
        state: 'receiving' as ReceiverState,
      }))
      return
    }

    if (decoded.type === 'data' && current.manifest) {
      const { added } = addFrame(
        { ...current },
        decoded.frame,
      )

      if (added) {
        setTransfer((prev) => {
          const updated = new Map(prev.receivedFrames)
          updated.set(decoded.frame.header.frameNumber, decoded.frame.payload)
          const isDone = updated.size >= prev.totalFrames

          return {
            ...prev,
            receivedFrames: updated,
            state: isDone ? 'reconstructing' as ReceiverState : 'receiving' as ReceiverState,
            duplicateCount: prev.duplicateCount,
            invalidCount: prev.invalidCount,
          }
        })
      } else {
        // duplicate
        setTransfer((prev) => ({ ...prev, duplicateCount: prev.duplicateCount + 1 }))
      }
    }
  }, [])

  // When state becomes 'reconstructing', do the reconstruction
  useEffect(() => {
    if (transfer.state !== 'reconstructing') return

    const doReconstruction = async () => {
      setTransfer((prev) => ({ ...prev, state: 'verifying' as ReceiverState }))

      const blob = reconstructFile(transfer)
      if (!blob) {
        setTransfer((prev) => ({
          ...prev,
          state: 'failed' as ReceiverState,
          error: 'Failed to reconstruct file from received frames',
        }))
        return
      }

      // Verify SHA-256
      if (transfer.manifest) {
        const hash = await sha256(blob)
        if (!equalBytes(hash, transfer.manifest.fileHash)) {
          setTransfer((prev) => ({
            ...prev,
            state: 'failed' as ReceiverState,
            error: 'SHA-256 verification failed — data corrupted',
          }))
          return
        }
      }

      setTransfer((prev) => ({
        ...prev,
        state: 'complete' as ReceiverState,
        blob,
      }))

      // Stop scanning
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
        scanIntervalRef.current = null
      }
      if (streamRef.current) {
        stopCamera(streamRef.current)
        streamRef.current = null
      }
    }

    doReconstruction()
  }, [transfer.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current)
      }
      if (streamRef.current) {
        stopCamera(streamRef.current)
      }
    }
  }, [])

  const startReceiving = useCallback(async () => {
    setTransfer(createInitialState('camera_permission'))

    try {
      const stream = await startCamera()
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        setTransfer((prev) => ({ ...prev, state: 'failed', error: 'Video element not found' }))
        return
      }

      video.srcObject = stream
      await video.play()

      setTransfer((prev) => ({ ...prev, state: 'scanning' }))

      // Start scan loop
      scanIntervalRef.current = setInterval(() => {
        const current = transferRef.current
        if (current.state !== 'scanning' && current.state !== 'receiving') return

        const videoEl = videoRef.current
        if (!videoEl) return

        const imageData = getImageDataFromVideo(videoEl)
        if (!imageData) return

        const results = scanImageData(imageData)
        for (const result of results) {
          processScanResult(result)
        }
      }, 200) // 5 scans/second
    } catch (err) {
      setTransfer((prev) => ({
        ...prev,
        state: 'failed' as ReceiverState,
        error: err instanceof Error ? err.message : 'Camera access denied',
      }))
    }
  }, [processScanResult])

  const stopReceiving = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      stopCamera(streamRef.current)
      streamRef.current = null
    }
    setTransfer(createInitialState('idle'))
  }, [])

  const retry = useCallback(() => {
    setTransfer(createInitialState('idle'))
  }, [])

  return {
    state: transfer,
    videoRef,
    startReceiving,
    stopReceiving,
    retry,
  }
}

function createInitialState(state: ReceiverState = 'idle'): ReceiverTransfer {
  return {
    state,
    manifest: null,
    receivedFrames: new Map(),
    totalFrames: 0,
    duplicateCount: 0,
    invalidCount: 0,
    error: null,
    blob: null,
  }
}