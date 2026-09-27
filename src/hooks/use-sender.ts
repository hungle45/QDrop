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
import { parseMissingFrameList } from '@/transfer/range-parser'
import {
  findGitignoreFile,
  readGitignoreContent,
  getRelativePath,
  filterByGitignore,
  filterByRemovedPaths,
  filterAlwaysExcluded,
} from '@/filter/folder-filter'
import { parseGitignore } from '@/filter/gitignore'
import type { GitignoreRule } from '@/filter/gitignore'

export type { QrDensity }

/** Current folder filter state, exposed to the UI for controls and display. */
export interface FolderFilterState {
  /** Whether .gitignore rules are being applied. */
  respectGitignore: boolean
  /** Relative paths the user has explicitly removed. */
  removedPaths: string[]
  /** Parsed .gitignore rules (null if no .gitignore file found). */
  gitignoreRules: GitignoreRule[] | null
  /** File count after filtering (0 means all files were removed). */
  filteredFileCount: number
  /** The filtered file list — what will be transferred. */
  filteredFiles: File[] | null
  /** The raw (unfiltered) file list from the directory picker. */
  rawFiles: File[] | null
}

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
  submitMissingFrames: (input: string) => void
  clearRetransmit: () => void
  /** Folder filter state for UI controls. */
  folderFilter: FolderFilterState
  /** Toggle whether .gitignore rules are respected. Triggers re-prepare. */
  setRespectGitignore: (respect: boolean) => void
  /** Add or remove a path from the removal set. Triggers re-prepare. */
  toggleRemovePath: (path: string) => void
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
    retransmitFrameCount: null,
    retransmitLabel: null,
    framesLoading: false,
  })

  const [displayCells, setDisplayCells] = useState<QrGridCell[]>([])
  const [density, setDensity] = useState<QrDensity>(1)
  const [frameInterval, setFrameIntervalState] = useState<number>(DEFAULT_FRAME_INTERVAL)
  const [qrErrorLevel, setQrErrorLevel] = useState<QrErrorLevel>('L')
  const [qrVersion, setQrVersion] = useState<number | undefined>(15)

  // Filter state
  const [folderFilter, setFolderFilter] = useState<FolderFilterState>({
    respectGitignore: true,
    removedPaths: [],
    gitignoreRules: null,
    filteredFileCount: 0,
    filteredFiles: null,
    rawFiles: null,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentIndexRef = useRef(0)
  const cyclesRef = useRef(0)
  const framesRef = useRef<EncodedFrame[]>([])
  const retransmitFramesRef = useRef<EncodedFrame[] | null>(null)
  const pauseRef = useRef(false)
  const intervalMsRef = useRef(DEFAULT_FRAME_INTERVAL)
  const selectedFileRef = useRef<File | null>(null)
  const selectedFilesRef = useRef<File[] | null>(null)
  const generatingRef = useRef(false)

  // Refs for filter state (avoids stale closures in async operations)
  const respectGitignoreRef = useRef(true)
  const removedPathsRef = useRef<Set<string>>(new Set())
  const gitignoreRulesRef = useRef<GitignoreRule[] | null>(null)
  const filteredFilesRef = useRef<File[] | null>(null)
  const rawFilesRef = useRef<File[] | null>(null)

  // Cache for folder content that doesn't depend on QR config.
  // When QR config changes we reuse this instead of re-hashing / re-detecting root name.
  const folderContentCacheRef = useRef<{
    files: File[]
    transferId: Uint8Array
    fileHashes: Map<string, Uint8Array>
    rootName: string
  } | null>(null)

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
    const frames = retransmitFramesRef.current ?? framesRef.current
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

  /**
   * Apply current filter settings (gitignore + removed paths) and update refs + state.
   * Does NOT trigger frame preparation — use prepareFolderFrames for that.
   */
  const applyFilter = useCallback(() => {
    const rawFiles = rawFilesRef.current
    if (!rawFiles) return [] as File[]

    const rules = gitignoreRulesRef.current
    const removed = removedPathsRef.current
    const respect = respectGitignoreRef.current

    // Always exclude .git and other hard-coded paths
    const withoutAlwaysExcluded = filterAlwaysExcluded(rawFiles)

    // Apply .gitignore filter
    const gitignoreFiltered = rules ? filterByGitignore(withoutAlwaysExcluded, rules, respect) : withoutAlwaysExcluded

    // Apply user removals
    const finalFiltered = filterByRemovedPaths(gitignoreFiltered, removed)

    filteredFilesRef.current = finalFiltered

    setFolderFilter((prev) => ({
      ...prev,
      filteredFileCount: finalFiltered.length,
      filteredFiles: finalFiltered,
      respectGitignore: respect,
    }))

    return finalFiltered
  }, [])

  /**
   * Prepare folder frames from the current filtered files.
   * Used by selectFolder and whenever filter state / QR config changes.
   */
  const prepareFolderFrames = useCallback(async () => {
    const files = filteredFilesRef.current
    if (!files || files.length === 0) {
      // No files after filtering — update state without frames
      setState((prev) => ({
        ...prev,
        state: 'ready',
        folderManifest: null,
        frames: [],
        totalFrames: 0,
        currentFrameIndex: 0,
        cyclesCompleted: 0,
        error: prev.error,
      }))
      return
    }

    // Mark frames as loading — the UI shows a local spinner on the frame count
    // instead of a full-page "Preparing folder..." banner.
    // We KEEP the existing folderManifest so the UI skeleton stays visible.
    const existingCache = folderContentCacheRef.current
    const needsHashing = !existingCache || files.some((f) => !existingCache.fileHashes.has(getRelativePath(f)))

    setState((prev) => ({
      ...prev,
      state: needsHashing ? ('preparing' as SenderState) : prev.state,
      framesLoading: true,
    }))

    try {
      const config = buildUserConfig()
      const maxPayload = estimateMaxPayloadBytes(config)
      const transferId = existingCache?.transferId ?? crypto.getRandomValues(new Uint8Array(16))

      let fileIdCounter = 0
      const manifestFiles: ManifestFileEntry[] = []
      const allChunks: { fileId: number; chunks: { index: number; data: Uint8Array }[]; file: File }[] = []

      const fileHashes = new Map(existingCache?.fileHashes ?? [])

      for (const file of files) {
        const fileId = fileIdCounter++
        const chunks = await chunkFile(file, maxPayload)
        const relPath = getRelativePath(file)

        if (!isPathSafe(relPath)) {
          throw new Error(`Unsafe path: ${relPath}`)
        }

        // Reuse cached hash if available — skip expensive sha256 I/O
        let fileHash = fileHashes.get(relPath)
        if (!fileHash) {
          fileHash = await sha256(file)
          fileHashes.set(relPath, fileHash)
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

      const rootName = existingCache?.rootName ?? deriveRootName(files)

      // Update cache with latest filtered file list + accumulated hashes
      folderContentCacheRef.current = {
        files,
        transferId,
        fileHashes,
        rootName,
      }

      const folderManifest: FolderManifest = {
        transferId,
        rootName,
        files: manifestFiles,
      }

      const manifestBytes = serializeFolderManifest(folderManifest)
      const maxManifestFragmentSize = Math.min(maxPayload, 800)
      const manifestFragments = fragmentManifest(manifestBytes, maxManifestFragmentSize)

      const manifestFrames: EncodedFrame[] = manifestFragments.map((frag, i) =>
        createV2ManifestFrame(transferId, i, manifestFragments.length, frag),
      )

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
        framesLoading: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        state: 'ready',
        error: err instanceof Error ? err.message : 'Failed to prepare folder',
        framesLoading: false,
      }))
    }
  }, [buildUserConfig])

  /**
   * Regenerate folder frames WITHOUT re-hashing or re-deriving metadata.
   *
   * Uses the cached folder content (sha256 hashes, transferId, root name)
   * and only re-chunks files with the current QR payload size.
   * Does NOT set 'preparing' state — avoids the "Preparing folder..." flash
   * when the user only changes QR configuration.
   *
   * Falls back to a full prepareFolderFrames if the cache is missing.
   */
  const regenFolderFrames = useCallback(async () => {
    const cache = folderContentCacheRef.current
    if (!cache) {
      // No cached content — need full preparation
      await prepareFolderFrames()
      return
    }

    const { files, fileHashes, transferId, rootName } = cache

    setState((prev) => ({ ...prev, framesLoading: true }))

    try {
      const config = buildUserConfig()
      const maxPayload = estimateMaxPayloadBytes(config)

      let fileIdCounter = 0
      const manifestFiles: ManifestFileEntry[] = []
      const allChunks: { fileId: number; chunks: { index: number; data: Uint8Array }[]; file: File }[] = []

      for (const file of files) {
        const fileId = fileIdCounter++
        const chunks = await chunkFile(file, maxPayload)
        const relPath = getRelativePath(file)
        const fileHash = fileHashes.get(relPath)

        if (!fileHash) {
          // Shouldn't happen unless cache is stale — fall back to full prep
          await prepareFolderFrames()
          return
        }

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

      const folderManifest: FolderManifest = {
        transferId,
        rootName,
        files: manifestFiles,
      }

      const manifestBytes = serializeFolderManifest(folderManifest)
      const maxManifestFragmentSize = Math.min(maxPayload, 800)
      const manifestFragments = fragmentManifest(manifestBytes, maxManifestFragmentSize)

      const manifestFrames: EncodedFrame[] = manifestFragments.map((frag, i) =>
        createV2ManifestFrame(transferId, i, manifestFragments.length, frag),
      )

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
        framesLoading: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        state: 'ready',
        error: err instanceof Error ? err.message : 'Failed to regenerate folder frames',
        framesLoading: false,
      }))
    }
  }, [buildUserConfig, prepareFolderFrames])

  // Track previous config to detect real changes
  const prevConfigRef = useRef({ errorLevel: qrErrorLevel, version: qrVersion })

  // When QR config changes after file is ready, regenerate frames
  useEffect(() => {
    const prev = prevConfigRef.current
    prevConfigRef.current = { errorLevel: qrErrorLevel, version: qrVersion }

    if (prev.errorLevel === qrErrorLevel && prev.version === qrVersion) return

    const isFileMode = !!selectedFileRef.current && !selectedFilesRef.current
    const isFolderMode = !!selectedFilesRef.current && !selectedFileRef.current
    if (!isFileMode && !isFolderMode) return
    if (state.state === 'idle' || state.state === 'preparing') return
    if (state.state === 'transmitting' || state.state === 'paused') return

    const doRegen = async () => {
      const config = buildUserConfig()
      if (isFileMode) {
        // Single-file mode: needs full re-chunk + re-hash
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
      } else {
        // Folder mode: reuse cached hashes + transferId — no "Preparing folder..." flash
        await regenFolderFrames()
      }
    }
    doRegen()
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
    rawFilesRef.current = files

    // New folder selection — clear cache so we re-hash all files
    folderContentCacheRef.current = null

    setState((prev) => ({ ...prev, state: 'preparing', file: null, files, isFolder: true }))

    try {
      // --- Filtering step: detect .gitignore and apply rules ---

      // Find and parse .gitignore
      const gitignoreFile = findGitignoreFile(files)
      let rules: GitignoreRule[] | null = null

      if (gitignoreFile) {
        const content = await readGitignoreContent(gitignoreFile)
        rules = parseGitignore(content)
      }

      gitignoreRulesRef.current = rules
      const respect = respectGitignoreRef.current

      // Always exclude .git and other hard-coded paths
      const withoutAlwaysExcluded = filterAlwaysExcluded(files)

      // Apply .gitignore filter (if enabled and rules exist)
      const gitignoreFiltered = rules ? filterByGitignore(withoutAlwaysExcluded, rules, respect) : withoutAlwaysExcluded

      // Apply user removals (none at this point — empty set)
      const removed = removedPathsRef.current
      const finalFiltered = filterByRemovedPaths(gitignoreFiltered, removed)

      filteredFilesRef.current = finalFiltered

      // Update filter state for UI
      const rootName = deriveRootName(files)

      setFolderFilter({
        respectGitignore: respect,
        removedPaths: [],
        gitignoreRules: rules,
        filteredFileCount: finalFiltered.length,
        filteredFiles: finalFiltered,
        rawFiles: files,
      })

      // --- Frame preparation: only for the filtered files ---
      if (finalFiltered.length === 0) {
        setState((prev) => ({
          ...prev,
          state: 'ready',
          folderManifest: null,
          frames: [],
          totalFrames: 0,
          currentFrameIndex: 0,
          cyclesCompleted: 0,
          error: null,
        }))
        return
      }

      // Delegate to the shared preparation function
      await prepareFolderFrames()
    } catch (err) {
      setState((prev) => ({
        ...prev,
        state: 'idle',
        error: err instanceof Error ? err.message : 'Failed to prepare folder',
      }))
    }
  }, [prepareFolderFrames])

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

  const submitMissingFrames = useCallback((input: string) => {
    if (!input.trim()) return

    const allFrames = framesRef.current
    if (allFrames.length === 0) return

    const isFolder = allFrames.some((f) => f.fileId !== undefined)

    const parsed = parseMissingFrameList(input)
    if (parsed.size === 0) {
      setState((prev) => ({ ...prev, error: 'Invalid missing frame list format' }))
      return
    }

    let selected: EncodedFrame[]
    const labelParts: string[] = []

    if (isFolder) {
      // Folder mode: match file paths from the parsed input
      const folderManifest = state.folderManifest
      if (!folderManifest) {
        setState((prev) => ({ ...prev, error: 'No folder manifest loaded' }))
        return
      }

      const fileIdByPath = new Map<string, number>()
      for (const file of folderManifest.files) {
        fileIdByPath.set(file.path, file.fileId)
      }

      const missingSetByFileId = new Map<number, Set<number>>()
      let hasFileEntries = false
      for (const [path, frames] of parsed) {
        if (path === '@manifest') continue
        const fileId = fileIdByPath.get(path)
        if (fileId === undefined) {
          setState((prev) => ({ ...prev, error: `Unknown file path: ${path}` }))
          return
        }
        missingSetByFileId.set(fileId, frames)
        hasFileEntries = true
      }

      // Include @manifest — select all manifest frames if requested
      const hasManifest = parsed.has('@manifest')

      selected = allFrames.filter((frame) => {
        if (frame.isManifest) {
          return hasManifest
        }
        if (frame.fileId === undefined) return false
        const missing = missingSetByFileId.get(frame.fileId)
        if (!missing) return false
        return missing.has(frame.number)
      })

      if (hasManifest) {
        const manifestCount = allFrames.filter((f) => f.isManifest).length
        labelParts.push(`${manifestCount} manifest frame(s)`)
      }
      if (hasFileEntries) {
        const totalRequested = Array.from(missingSetByFileId.values())
          .reduce((sum, s) => sum + s.size, 0)
        labelParts.push(`${totalRequested} frame(s) from ${missingSetByFileId.size} file(s)`)
      }
    } else {
      // File mode: data frames + optional @manifest
      const missingFrames = parsed.get('')
      const manifestRequested = parsed.has('@manifest')

      if ((!missingFrames || missingFrames.size === 0) && !manifestRequested) {
        setState((prev) => ({ ...prev, error: 'No frames specified' }))
        return
      }

      selected = allFrames.filter((frame) => {
        if (frame.isManifest) {
          return manifestRequested
        }
        // frame.number is 1-indexed for v1 data frames
        return missingFrames ? missingFrames.has(frame.number - 1) : false
      })

      if (manifestRequested) labelParts.push('manifest')
      if (missingFrames && missingFrames.size > 0) {
        labelParts.push(`${missingFrames.size} data frame(s)`)
      }
    }

    if (selected.length === 0) {
      setState((prev) => ({ ...prev, error: 'No matching frames to retransmit' }))
      return
    }

    const label = labelParts.join(' + ')

    // Set retransmit mode
    retransmitFramesRef.current = selected
    currentIndexRef.current = 0
    cyclesRef.current = 0
    setState((prev) => ({
      ...prev,
      retransmitFrameCount: selected.length,
      retransmitLabel: label,
      error: null,
    }))
  }, [state.folderManifest])

  const clearRetransmit = useCallback(() => {
    retransmitFramesRef.current = null
    currentIndexRef.current = 0
    setState((prev) => ({
      ...prev,
      retransmitFrameCount: null,
      retransmitLabel: null,
    }))
  }, [])

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

  /**
   * Toggle whether .gitignore rules are respected.
   * Re-applies filtering and re-prepares frames.
   */
  const setRespectGitignore = useCallback((respect: boolean) => {
    respectGitignoreRef.current = respect

    // Re-apply filter
    const filtered = applyFilter()

    if (!filtered || filtered.length === 0) {
      // No files left after toggling gitignore — update manifest to empty
      setState((prev) => ({
        ...prev,
        folderManifest: null,
        frames: [],
        totalFrames: 0,
      }))
      return
    }

    // Re-prepare frames with the new filter
    prepareFolderFrames()
  }, [applyFilter, prepareFolderFrames])

  /**
   * Add or remove a path from the removal set.
   * If the path is already removed, re-adds it; otherwise removes it.
   * Re-applies filtering and re-prepares frames.
   */
  const toggleRemovePath = useCallback((path: string) => {
    const current = removedPathsRef.current
    const updated = new Set(current)

    if (updated.has(path)) {
      updated.delete(path)
    } else {
      updated.add(path)
    }

    removedPathsRef.current = updated

    setFolderFilter((prev) => ({
      ...prev,
      removedPaths: Array.from(updated).sort(),
    }))

    // Re-apply filter
    const filtered = applyFilter()

    if (!filtered || filtered.length === 0) {
      setState((prev) => ({
        ...prev,
        folderManifest: null,
        frames: [],
        totalFrames: 0,
      }))
      return
    }

    // Re-prepare frames with the new filter
    prepareFolderFrames()
  }, [applyFilter, prepareFolderFrames])

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
    submitMissingFrames,
    clearRetransmit,
    folderFilter,
    setRespectGitignore,
    toggleRemovePath,
  }
}

function deriveRootName(files: File[]): string {
  if (files.length === 0) return 'folder'
  // Skip hidden/system files like .DS_Store when deriving root name
  const firstRealFile = files.find(f => {
    const relPath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    return !relPath.startsWith('.') && !relPath.includes('/.')
  })
  const target = firstRealFile || files[0]
  const firstPath = (target as File & { webkitRelativePath?: string }).webkitRelativePath
  if (firstPath) {
    const topDir = firstPath.split('/')[0]
    if (topDir) return topDir
  }
  return 'folder'
}