/**
 * QR code scanner — wraps jsQR for browser camera scanning.
 */

import jsQR from 'jsqr'

export interface ScanResult {
  data: string
  /** Position corners of the detected QR code */
  location?: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } }
}

/**
 * Decode QR codes from an ImageData (from canvas/camera).
 * Returns all QR codes found in the image.
 */
export function scanImageData(imageData: ImageData): ScanResult[] {
  const results: ScanResult[] = []

  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  })

  if (code && code.data) {
    results.push({
      data: code.data,
      location: code.location ? {
        topLeft: code.location.topLeftCorner,
        topRight: code.location.topRightCorner,
        bottomRight: code.location.bottomRightCorner,
        bottomLeft: code.location.bottomLeftCorner,
      } : undefined,
    })
  }

  // jsQR only returns one code per call.
  // For multi-QR support, we'd need a more advanced scanner.
  // For V1, we scan one QR at a time which is fine for 1×1 and
  // sufficient for 2×2 if the camera frame rate is high enough.
  // Future: use a scanner that supports multiple QR codes per frame.

  return results
}

/**
 * Read ImageData from a video element.
 */
export function getImageDataFromVideo(video: HTMLVideoElement): ImageData | null {
  if (video.readyState < 2) return null

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(video, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Get available cameras.
 */
export async function getCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput')
}

/**
 * Start camera stream.
 */
export async function startCamera(
  facingMode: 'user' | 'environment' = 'environment',
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  })
  return stream
}

/**
 * Stop all tracks in a media stream.
 */
export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}