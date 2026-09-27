import { describe, it, expect } from 'vitest'
import { isDuplicateFrame, isTransferComplete, reconstructFile } from '../../transfer/receiver'
import { type DataFrame, type FrameHeader, type Manifest } from '../../protocol/types'

function makeDataFrame(frameNumber: number, totalFrames: number, payload: Uint8Array): DataFrame {
  const header: FrameHeader = {
    magic: 0x5144524f,
    version: 1,
    transferId: new Uint8Array(16).fill(1),
    frameType: 1,
    fileIdOrManifestFrag: 0,
    frameNumber,
    totalFrames,
    payloadLength: payload.length,
    crc32: 0,
  }
  return { header, payload }
}

function makeManifest(totalFrames: number): Manifest {
  return {
    transferId: new Uint8Array(16).fill(1),
    filename: 'test.bin',
    fileSize: 100,
    totalFrames,
    fileHash: new Uint8Array(32).fill(0),
    protocolVersion: 1,
  }
}

describe('Receiver', () => {
  describe('isDuplicateFrame', () => {
    it('should detect a new frame', () => {
      const received = new Map<number, Uint8Array>()
      const frame = makeDataFrame(1, 5, new Uint8Array([1, 2, 3]))
      expect(isDuplicateFrame(received, frame)).toBe(false)
    })

    it('should detect duplicate frames', () => {
      const received = new Map<number, Uint8Array>()
      received.set(1, new Uint8Array([1, 2, 3]))
      const frame = makeDataFrame(1, 5, new Uint8Array([4, 5, 6]))
      expect(isDuplicateFrame(received, frame)).toBe(true)
    })

    it('should not treat manifest frames as duplicates', () => {
      const received = new Map<number, Uint8Array>()
      const header: FrameHeader = {
        magic: 0x5144524f,
        version: 1,
        transferId: new Uint8Array(16).fill(1),
        frameType: 0,
        fileIdOrManifestFrag: 0,
        frameNumber: 0,
        totalFrames: 5,
        payloadLength: 3,
        crc32: 0,
      }
      const frame: DataFrame = { header, payload: new Uint8Array([1, 2, 3]) }
      expect(isDuplicateFrame(received, frame)).toBe(false)
    })
  })

  describe('isTransferComplete', () => {
    it('should detect completion', () => {
      const received = new Map<number, Uint8Array>()
      received.set(1, new Uint8Array([1]))
      received.set(2, new Uint8Array([2]))
      received.set(3, new Uint8Array([3]))
      expect(isTransferComplete(received, 3)).toBe(true)
    })

    it('should detect incomplete transfer', () => {
      const received = new Map<number, Uint8Array>()
      received.set(1, new Uint8Array([1]))
      received.set(2, new Uint8Array([2]))
      expect(isTransferComplete(received, 3)).toBe(false)
    })

    it('should handle empty received frames', () => {
      const received = new Map<number, Uint8Array>()
      expect(isTransferComplete(received, 5)).toBe(false)
    })
  })

  describe('reconstructFile', () => {
    it('should reconstruct file from frames in any order', () => {
      const received = new Map<number, Uint8Array>()
      received.set(3, new Uint8Array([3]))
      received.set(1, new Uint8Array([1]))
      received.set(4, new Uint8Array([4]))
      received.set(2, new Uint8Array([2]))

      const state = {
        state: 'receiving' as const,
        manifest: makeManifest(4),
        receivedFrames: received,
        totalFrames: 4,
        duplicateCount: 0,
        invalidCount: 0,
        error: null as string | null,
        blob: null as Blob | null,
        frameLog: [] as never[],
        folderManifest: null,
        fileProgress: new Map(),
        fileData: new Map(),
        outputFiles: new Map(),
        manifestFragments: new Map(),
        manifestTotalFragments: 0,
      }

      const blob = reconstructFile(state)
      expect(blob).not.toBeNull()

      return blob!.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf)
        expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
      })
    })

    it('should return null if not all frames received', () => {
      const received = new Map<number, Uint8Array>()
      for (let i = 1; i <= 5; i++) {
        received.set(i, new Uint8Array([i]))
      }

      const state = {
        state: 'receiving' as const,
        manifest: makeManifest(10),
        receivedFrames: received,
        totalFrames: 10,
        duplicateCount: 0,
        invalidCount: 0,
        error: null as string | null,
        blob: null as Blob | null,
        frameLog: [] as never[],
        folderManifest: null,
        fileProgress: new Map(),
        fileData: new Map(),
        outputFiles: new Map(),
        manifestFragments: new Map(),
        manifestTotalFragments: 0,
      }

      const blob = reconstructFile(state)
      expect(blob).toBeNull()
    })
  })
})