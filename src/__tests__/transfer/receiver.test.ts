import { describe, it, expect } from 'vitest'
import { addFrame, reconstructFile, type ReceiverTransfer } from '../../transfer/receiver'
import { type DataFrame, type FrameHeader, type Manifest } from '../../protocol/types'

function makeDataFrame(frameNumber: number, totalFrames: number, payload: Uint8Array): DataFrame {
  const header: FrameHeader = {
    magic: 0x5144524f,
    version: 1,
    transferId: new Uint8Array(16).fill(1),
    frameType: 1,
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
  describe('addFrame', () => {
    it('should add a new frame', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(5),
        receivedFrames: new Map(),
        totalFrames: 5,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      const frame = makeDataFrame(1, 5, new Uint8Array([1, 2, 3]))
      const { added, isComplete } = addFrame(state, frame)

      expect(added).toBe(true)
      expect(isComplete).toBe(false)
      expect(state.receivedFrames.size).toBe(1)
      expect(state.receivedFrames.has(1)).toBe(true)
    })

    it('should detect duplicate frames', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(5),
        receivedFrames: new Map(),
        totalFrames: 5,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      const frame = makeDataFrame(1, 5, new Uint8Array([1, 2, 3]))
      addFrame(state, frame)
      const { added, isComplete } = addFrame(state, frame)

      expect(added).toBe(false)
      expect(isComplete).toBe(false)
      expect(state.duplicateCount).toBe(1)
    })

    it('should handle out-of-order frames', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(5),
        receivedFrames: new Map(),
        totalFrames: 5,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      // Add frames in reverse order
      for (let i = 5; i >= 1; i--) {
        const frame = makeDataFrame(i, 5, new Uint8Array([i]))
        addFrame(state, frame)
      }

      expect(state.receivedFrames.size).toBe(5)

      // Verify frames are stored by frame number, not insert order
      for (let i = 1; i <= 5; i++) {
        expect(state.receivedFrames.has(i)).toBe(true)
      }
    })

    it('should detect completion when all frames received', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(3),
        receivedFrames: new Map(),
        totalFrames: 3,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      for (let i = 1; i <= 2; i++) {
        const frame = makeDataFrame(i, 3, new Uint8Array([i]))
        addFrame(state, frame)
      }

      const frame = makeDataFrame(3, 3, new Uint8Array([3]))
      const { added, isComplete } = addFrame(state, frame)
      expect(added).toBe(true)
      expect(isComplete).toBe(true)
    })
  })

  describe('reconstructFile', () => {
    it('should reconstruct file from frames in any order', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(4),
        receivedFrames: new Map(),
        totalFrames: 4,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      // Add frames out of order: 3, 1, 4, 2
      const frame3 = makeDataFrame(3, 4, new Uint8Array([3]))
      const frame1 = makeDataFrame(1, 4, new Uint8Array([1]))
      const frame4 = makeDataFrame(4, 4, new Uint8Array([4]))
      const frame2 = makeDataFrame(2, 4, new Uint8Array([2]))

      addFrame(state, frame3)
      addFrame(state, frame1)
      addFrame(state, frame4)
      addFrame(state, frame2)

      const blob = reconstructFile(state)
      expect(blob).not.toBeNull()

      return blob!.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf)
        // Should be in order: 1, 2, 3, 4
        expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
      })
    })

    it('should return null if not all frames received', () => {
      const state: ReceiverTransfer = {
        state: 'receiving',
        manifest: makeManifest(10),
        receivedFrames: new Map(),
        totalFrames: 10,
        duplicateCount: 0,
        invalidCount: 0,
        error: null,
        blob: null,
      }

      // Only add 5 frames
      for (let i = 1; i <= 5; i++) {
        const frame = makeDataFrame(i, 10, new Uint8Array([i]))
        addFrame(state, frame)
      }

      const blob = reconstructFile(state)
      expect(blob).toBeNull()
    })
  })
})