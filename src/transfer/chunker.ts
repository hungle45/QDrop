/**
 * File chunker — splits a file into fixed-size chunks.
 */

export const DEFAULT_CHUNK_SIZE = 800 // bytes per chunk — must fit comfortably in a QR code (~3KB base64)

export interface Chunk {
  index: number
  data: Uint8Array
}

export function chunkFile(file: File, chunkSize: number = DEFAULT_CHUNK_SIZE): Promise<Chunk[]> {
  return new Promise((resolve, reject) => {
    const chunks: Chunk[] = []
    const reader = new FileReader()
    let offset = 0

    reader.onerror = () => reject(reader.error)

    const readNext = () => {
      if (offset >= file.size) {
        resolve(chunks)
        return
      }

      const blob = file.slice(offset, offset + chunkSize)
      reader.readAsArrayBuffer(blob)
    }

    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer
      chunks.push({
        index: chunks.length,
        data: new Uint8Array(arrayBuffer),
      })
      offset += chunkSize
      readNext()
    }

    readNext()
  })
}