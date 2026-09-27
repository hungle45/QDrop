/**
 * Custom hook for the receiver state machine.
 * Supports both single-file (Phase 1) and folder (Phase 2) transfers.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { decodeQrData } from '@/protocol'
import { sha256, equalBytes } from '@/protocol'
import { reconstructFolderManifest } from '@/protocol/manifest-v2'
import { isPathSafe } from '@/protocol/manifest-v2'
import {
  type ReceiverTransfer,
  type ReceiverState,
  isDuplicateFrame,
  isTransferComplete,
  isFolderTransferComplete,
  reconstructFile,
  reconstructFolderFiles,
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
          message: 'invalid QR data — CRC mismatch or bad format',
          time: Date.now(),
        }),
      }))
      return
    }

    // v1 manifest (single-file)
    if (decoded.type === 'manifest') {
      setTransfer((prev) => {
        if (prev.manifest) return prev
        const justReceived = new Map(prev.receivedFrames)
        const isComplete = isTransferComplete(justReceived, decoded.manifest.totalFrames)
        return {
          ...prev,
          manifest: decoded.manifest,
          totalFrames: decoded.manifest.totalFrames,
          receivedFrames: justReceived,
          state: isComplete ? 'reconstructing' as ReceiverState : 'receiving' as ReceiverState,
          frameLog: addToLog(prev.frameLog, {
            frameNumber: 0,
            type: 'manifest',
            message: `manifest received — ${decoded.manifest.filename} (${decoded.manifest.totalFrames} frames)`,
            time: Date.now(),
          }),
        }
      })
      return
    }

    // v2 manifest fragment (folder)
    if (decoded.type === 'manifest-v2') {
      setTransfer((prev) => {
        // Ignore duplicate manifest fragments
        if (prev.manifestFragments.has(decoded.manifestFragmentIndex)) return prev

        const updatedFragments = new Map(prev.manifestFragments)
        updatedFragments.set(decoded.manifestFragmentIndex, decoded.fragmentPayload)
        const totalFragments = decoded.manifestTotalFrames

        // Try to reconstruct the manifest
        const folderManifest = reconstructFolderManifest(updatedFragments, totalFragments)

        let newState = prev.state
        const fileProgress = new Map(prev.fileProgress)
        const fileData = new Map(prev.fileData)

        if (folderManifest && !prev.folderManifest) {
          // Build per-file progress tracking, reconciling with pre-manifest buffered frames
          for (const file of folderManifest.files) {
            if (!isPathSafe(file.path)) continue

            // Check if we already buffered frames for this file before the manifest arrived
            const existingFrames = prev.fileData.get(file.fileId)
            const received = existingFrames
              ? new Set(existingFrames.keys())
              : new Set<number>()

            fileProgress.set(file.fileId, {
              fileId: file.fileId,
              path: file.path,
              size: file.size,
              frameCount: file.frameCount,
              sha256: file.sha256,
              receivedFrames: received,
              verified: false,
            })

            // Preserve existing buffered data; create fresh map only if none
            if (!existingFrames) {
              fileData.set(file.fileId, new Map())
            }
          }

          newState = prev.state === 'scanning' ? 'receiving' : prev.state
        } else {
          if (isFolderTransferComplete(fileProgress)) {
            newState = 'reconstructing'
          }
          // Manifest not yet complete — keep any pre-manifest buffered data untouched
        }

        return {
          ...prev,
          folderManifest: folderManifest || prev.folderManifest,
          manifestFragments: updatedFragments,
          manifestTotalFragments: totalFragments,
          fileProgress,
          fileData,
          state: newState as ReceiverState,
          frameLog: addToLog(prev.frameLog, {
            frameNumber: decoded.manifestFragmentIndex,
            type: 'manifest-fragment',
            message: `manifest fragment ${decoded.manifestFragmentIndex + 1}/${totalFragments} received` +
              (folderManifest ? ' — manifest complete!' : ''),
            time: Date.now(),
          }),
        }
      })
      return
    }

    // v1 data frame
    if (decoded.type === 'data') {
      setTransfer((prev) => {
        if (isDuplicateFrame(prev.receivedFrames, decoded.frame)) {
          const updated = new Map(prev.receivedFrames)
          return { ...prev, receivedFrames: updated, duplicateCount: prev.duplicateCount + 1 }
        }

        const updated = new Map(prev.receivedFrames)
        updated.set(decoded.frame.header.frameNumber, decoded.frame.payload)

        const haveManifest = !!prev.manifest
        const isComplete = haveManifest && isTransferComplete(updated, prev.totalFrames)

        return {
          ...prev,
          receivedFrames: updated,
          state: isComplete ? 'reconstructing' as ReceiverState : (haveManifest ? 'receiving' as ReceiverState : prev.state),
          frameLog: addToLog(prev.frameLog, {
            frameNumber: decoded.frame.header.frameNumber,
            type: 'new',
            message: `scanned frame #${decoded.frame.header.frameNumber}` + (isComplete ? ' — completed!' : ''),
            time: Date.now(),
          }),
        }
      })
      return
    }

    // v2 data frame (with file_id)
    if (decoded.type === 'data-v2') {
      setTransfer((prev) => {
        const { fileId, fileFrameNumber, fileTotalFrames } = decoded

        // Track the frame per-file
        const fileProgress = new Map(prev.fileProgress)
        const fileData = new Map(prev.fileData)

        // Get or create progress for this file
        let progress = fileProgress.get(fileId)
        if (!progress) {
          // File not yet known from manifest — this can happen if data arrives before manifest
          // Buffer it temporarily with whatever info we have
          progress = {
            fileId,
            path: `file-${fileId}`,
            size: 0,
            frameCount: fileTotalFrames,
            sha256: new Uint8Array(32),
            receivedFrames: new Set(),
            verified: false,
          }
          fileProgress.set(fileId, progress)
        }

        // Check duplicate per-file
        if (progress.receivedFrames.has(fileFrameNumber)) {
          return {
            ...prev,
            fileProgress,
            fileData,
            duplicateCount: prev.duplicateCount + 1,
          }
        }

        // Store the frame data
        let fileFrames = fileData.get(fileId)
        if (!fileFrames) {
          fileFrames = new Map()
          fileData.set(fileId, fileFrames)
        }
        fileFrames.set(fileFrameNumber, decoded.frame.payload)

        // Update progress
        progress.receivedFrames = new Set(progress.receivedFrames)
        progress.receivedFrames.add(fileFrameNumber)

        const hasFolderManifest = !!prev.folderManifest
        const isFolderComplete = hasFolderManifest && isFolderTransferComplete(fileProgress)

        const newState = isFolderComplete
          ? 'reconstructing' as ReceiverState
          : (hasFolderManifest ? 'receiving' as ReceiverState : prev.state)

        return {
          ...prev,
          fileProgress,
          fileData,
          state: newState,
          frameLog: addToLog(prev.frameLog, {
            frameNumber: fileFrameNumber,
            type: 'new',
            message: `file #${fileId} frame ${fileFrameNumber + 1}/${fileTotalFrames}` +
              (isFolderComplete ? ' — folder complete!' : ''),
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

      // Folder transfer
      if (transfer.folderManifest) {
        const outputFiles = reconstructFolderFiles(transfer.fileProgress, transfer.fileData)

        if (outputFiles.size === 0) {
          setTransfer((prev) => ({
            ...prev,
            state: 'failed' as ReceiverState,
            error: 'Failed to reconstruct folder from received frames',
          }))
          return
        }

        // Verify each file's SHA-256
        const verifiedFiles = new Map<string, Blob>()

        for (const [path, blob] of outputFiles) {
          const fileEntry = transfer.folderManifest.files.find(f =>
            f.path === path && isPathSafe(f.path),
          )
          if (!fileEntry) {
            continue
          }
          const hash = await sha256(blob)
          if (!equalBytes(hash, fileEntry.sha256)) {
            // Update progress error
            const progress = new Map(transfer.fileProgress)
            const p = progress.get(fileEntry.fileId)
            if (p) {
              p.error = 'SHA-256 mismatch'
              progress.set(fileEntry.fileId, p)
            }
            setTransfer((prev) => ({ ...prev, fileProgress: progress }))
            continue
          }
          verifiedFiles.set(path, blob)

          // Mark as verified
          const progress = new Map(transfer.fileProgress)
          const p = progress.get(fileEntry.fileId)
          if (p) {
            p.verified = true
            progress.set(fileEntry.fileId, p)
          }
          setTransfer((prev) => ({ ...prev, fileProgress: progress }))
        }

        if (verifiedFiles.size === 0) {
          setTransfer((prev) => ({
            ...prev,
            state: 'failed' as ReceiverState,
            error: 'SHA-256 verification failed — data corrupted',
          }))
          return
        }

        setTransfer((prev) => ({
          ...prev,
          state: 'complete' as ReceiverState,
          outputFiles: verifiedFiles,
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
        return
      }

      // Single-file transfer
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
        }
      }

      setTransfer((prev) => ({
        ...prev,
        state: 'failed' as ReceiverState,
        error: message,
      }))
    }
  }, [])

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
    folderManifest: null,
    receivedFrames: new Map(),
    fileProgress: new Map(),
    fileData: new Map(),
    totalFrames: 0,
    duplicateCount: 0,
    invalidCount: 0,
    error: null,
    blob: null,
    outputFiles: new Map(),
    frameLog: [],
    manifestFragments: new Map(),
    manifestTotalFragments: 0,
  }
}