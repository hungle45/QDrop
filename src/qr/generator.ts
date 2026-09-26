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

/** Config used for the manifest frame — high reliability, auto version */
export const MANIFEST_QR_CONFIG: QrGenConfig = {
  errorCorrectionLevel: 'H',
  version: undefined,
  width: 256,
  margin: 4,
}

/** Default config for data frames */
export const DEFAULT_QR_CONFIG: QrGenConfig = {
  errorCorrectionLevel: 'M',
  version: undefined,
  width: 256,
  margin: 4,
}

export const QR_ERROR_LEVELS: { label: string; value: QrErrorLevel; recovery: string }[] = [
  { label: 'L', value: 'L', recovery: '~7%' },
  { label: 'M', value: 'M', recovery: '~15%' },
  { label: 'Q', value: 'Q', recovery: '~25%' },
  { label: 'H', value: 'H', recovery: '~30%' },
]

export const QR_VERSION_PRESETS = [
  { label: 'Auto', value: undefined as number | undefined },
  { label: 'v5', value: 5 },
  { label: 'v10', value: 10 },
  { label: 'v15', value: 15 },
  { label: 'v20', value: 20 },
  { label: 'v25', value: 25 },
  { label: 'v30', value: 30 },
  { label: 'v35', value: 35 },
  { label: 'v40', value: 40 },
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