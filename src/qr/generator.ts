/**
 * QR code generator — wraps the qrcode library for our use case.
 */

import QRCode from 'qrcode'

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrGenConfig {
  /** Error correction level: L (7%), M (15%), Q (25%), H (30%) */
  errorCorrectionLevel: QrErrorLevel
  /** QR version 1-40, or undefined for auto-detect */
  version?: number
  /** Width in pixels */
  width: number
  /** Quiet zone margin in modules */
  margin: number
}

export const DEFAULT_QR_CONFIG: QrGenConfig = {
  errorCorrectionLevel: 'M',
  version: 30,
  width: 256,
  margin: 4,
}

export const QR_ERROR_LEVELS: { label: string; value: QrErrorLevel; recovery: string }[] = [
  { label: 'L', value: 'L', recovery: '~7%' },
  { label: 'M', value: 'M', recovery: '~15%' },
  { label: 'Q', value: 'Q', recovery: '~25%' },
  { label: 'H', value: 'H', recovery: '~30%' },
]

/**
 * Generate a QR code as a data URL.
 */
export async function generateQrDataUrl(
  data: string,
  config: QrGenConfig = DEFAULT_QR_CONFIG,
): Promise<string> {
  return QRCode.toDataURL(data, {
    errorCorrectionLevel: config.errorCorrectionLevel,
    margin: config.margin,
    width: config.width,
    version: config.version,
  })
}

/**
 * Generate a QR code as an SVG string.
 */
export async function generateQrSvg(
  data: string,
  config: QrGenConfig = DEFAULT_QR_CONFIG,
): Promise<string> {
  return QRCode.toString(data, {
    type: 'svg',
    errorCorrectionLevel: config.errorCorrectionLevel,
    margin: config.margin,
    version: config.version,
  })
}

/**
 * Generate multiple QR codes for a set of frame strings.
 */
export async function generateQrBatch(
  dataStrings: string[],
  config: QrGenConfig = DEFAULT_QR_CONFIG,
): Promise<string[]> {
  return Promise.all(dataStrings.map((s) => generateQrDataUrl(s, config)))
}