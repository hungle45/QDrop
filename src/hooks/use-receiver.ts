/**
 * Custom hook for the receiver state machine.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { decodeQrData } from '@/protocol'
import { sha256, equalBytes } from '@/protocol'
import {
  type ReceiverTransfer,
  type ReceiverState,
  isDuplicateFrame,
  isTransferComplete,
  reconstructFile,
  addToLog,
} from '@/transfer/receiver'
import { startCamera, stopCamera, getImageDataFromVideo, scanImageData, type ScanResult } from '@/qr/scanner'

interface UseReceiverReturn {
  state: ReceiverTransfer
  videoRef: React.RefObject<HTMLVideoElement | null>
  startReceiving: () => Promise<void>
  stopReceiving: () => void
  retry: () => void
}

export function useReceiver(): UseReceiverReturn {
  const [transfer, setTransfer] = useState<ReceiverTransfer>(createInitialState('idle'))

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const processScanResult = useCallback((scanResult: ScanResult) => {
    const decoded = decodeQrData(scanResult.data)

    if (decoded.type === 'invalid') {
      setTransfer((prev) => ({
        ...prev,
        invalidCount: prev.invalidCount + 1,
        frameLog: addToLog(prev.frameLog, {
          frameNumber: -1,
          type: 'invalid',
          time: Date.now(),
        }),
      }))
      return
    }

    if (decoded.type === 'manifest') {
      setTransfer((prev) => {
        if (prev.manifest) return prev
        return {
          ...prev,
          manifest: decoded.manifest,
          totalFrames: decoded.manifest.totalFrames,
          state: 'receiving' as ReceiverState,
          frameLog: addToLog(prev.frameLog, {
            frameNumber: 0,
            type: 'manifest',
            time: Date.now(),
          }),
        }
      })
      return
    }

    if (decoded.type === 'data') {
      setTransfer((prev) => {
        if (!prev.manifest) return prev

        if (isDuplicateFrame(prev.receivedFrames, decoded.frame)) {
          return {
            ...prev,
            duplicateCount: prev.duplicateCount + 1,
            frameLog: addToLog(prev.frameLog, {
              frameNumber: decoded.frame.header.frameNumber,
              type: 'duplicate',
              time: Date.now(),
            }),
          }
        }

        const updated = new Map(prev.receivedFrames)
        updated.set(decoded.frame.header.frameNumber, decoded.frame.payload)
        const isComplete = isTransferComplete(updated, prev.totalFrames)

        return {
          ...prev,
          receivedFrames: updated,
          state: isComplete ? 'reconstructing' as ReceiverState : 'receiving' as ReceiverState,
          frameLog: addToLog(prev.frameLog, {
            frameNumber: decoded.frame.header.frameNumber,
            type: 'new',
            time: Date.now(),
          }),
        }
      })
    }
  }, [])

  const processScanResultRef = useRef(processScanResult)
  processScanResultRef.current = processScanResult

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
        setTransfer((prev) => ({ ...prev, state: 'failed', error: 'Camera preview unavailable. Please refresh and try again.' }))
        return
      }

      video.srcObject = stream
      await video.play()

      setTransfer((prev) => ({ ...prev, state: 'scanning' }))

      // Start scan loop
      scanIntervalRef.current = setInterval(() => {
        const videoEl = videoRef.current
        if (!videoEl) return

        const imageData = getImageDataFromVideo(videoEl)
        if (!imageData) return

        const results = scanImageData(imageData)
        for (const result of results) {
          processScanResultRef.current(result)
        }
      }, 200)
    } catch (err) {
      console.error('Camera error:', err)

      let message = 'Camera access failed.'
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotFoundError':
            message = 'No camera found. Connect a camera and try again.'
            break
          case 'NotAllowedError':
            message = 'Camera permission denied. Allow camera access in your browser settings.'
            break
          case 'NotReadableError':
            message = 'Camera is already in use by another application.'
            break
          case 'OverconstrainedError':
            message = 'Camera does not support the required resolution.'
            break
          case 'AbortError':
            message = 'Camera access was aborted.'
            break
          default:
            message = `Camera error: ${err.message}`
        }
      } else if (err instanceof Error) {
        message = err.message
      }

      setTransfer((prev) => ({
        ...prev,
        state: 'failed' as ReceiverState,
        error: message,
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
    frameLog: [],
  }
}