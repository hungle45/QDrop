/**
 * QR code generator — wraps the qrcode library for our use case.
 */

import QRCode from 'qrcode'

/**
 * Generate a QR code as a data URL.
 */
export async function generateQrDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: 'L', // Low error correction = higher data density
    margin: 1,
    width: 256,
  })
}

/**
 * Generate a QR code as an SVG string.
 */
export async function generateQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, {
    type: 'svg',
    errorCorrectionLevel: 'L',
    margin: 1,
  })
}

/**
 * Generate multiple QR codes for a set of frame strings.
 */
export async function generateQrBatch(dataStrings: string[]): Promise<string[]> {
  return Promise.all(dataStrings.map(generateQrDataUrl))
}