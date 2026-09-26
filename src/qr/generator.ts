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
  { label: 'v25', value: 25 },
  { label: 'v30', value: 30 },
  { label: 'v35', value: 35 },
  { label: 'v40', value: 40 },
]

/**
 * QR version → max byte capacity at each EC level.
 * Source: https://www.qrcode.com/en/about/version.html
 * These are for byte mode (the library uses byte mode for base64 strings).
 *
 * We use the table to estimate the max payload per frame for a given version/EC.
 * The frame header + CRC overhead is ~42 bytes, and base64 expands by ~4/3.
 * So usable payload ≈ (capacity * 0.73) - 42 (rough estimate).
 */
const QR_CAPACITY: Record<number, Record<QrErrorLevel, number>> = {
  1:  { L: 17, M: 14, Q: 11, H: 9 },
  2:  { L: 32, M: 26, Q: 20, H: 16 },
  3:  { L: 53, M: 42, Q: 32, H: 26 },
  4:  { L: 78, M: 62, Q: 46, H: 36 },
  5:  { L: 106, M: 84, Q: 60, H: 46 },
  6:  { L: 134, M: 106, Q: 74, H: 56 },
  7:  { L: 154, M: 122, Q: 86, H: 64 },
  8:  { L: 192, M: 152, Q: 108, H: 80 },
  9:  { L: 230, M: 180, Q: 130, H: 96 },
  10: { L: 271, M: 213, Q: 151, H: 112 },
  11: { L: 321, M: 251, Q: 177, H: 130 },
  12: { L: 367, M: 287, Q: 203, H: 148 },
  13: { L: 425, M: 331, Q: 241, H: 178 },
  14: { L: 458, M: 362, Q: 258, H: 190 },
  15: { L: 520, M: 412, Q: 292, H: 214 },
  16: { L: 586, M: 450, Q: 322, H: 234 },
  17: { L: 644, M: 504, Q: 364, H: 264 },
  18: { L: 718, M: 560, Q: 394, H: 290 },
  19: { L: 792, M: 624, Q: 442, H: 326 },
  20: { L: 858, M: 666, Q: 482, H: 354 },
  21: { L: 929, M: 711, Q: 509, H: 378 },
  22: { L: 1003, M: 779, Q: 565, H: 414 },
  23: { L: 1091, M: 857, Q: 614, H: 438 },
  24: { L: 1171, M: 911, Q: 656, H: 458 },
  25: { L: 1273, M: 997, Q: 728, H: 530 },
  26: { L: 1367, M: 1075, Q: 784, H: 560 },
  27: { L: 1465, M: 1144, Q: 820, H: 594 },
  28: { L: 1528, M: 1228, Q: 862, H: 624 },
  29: { L: 1621, M: 1284, Q: 924, H: 666 },
  30: { L: 1732, M: 1332, Q: 936, H: 688 },
  31: { L: 1804, M: 1426, Q: 1026, H: 742 },
  32: { L: 1919, M: 1499, Q: 1080, H: 782 },
  33: { L: 2052, M: 1594, Q: 1140, H: 830 },
  34: { L: 2144, M: 1684, Q: 1202, H: 886 },
  35: { L: 2281, M: 1781, Q: 1268, H: 928 },
  36: { L: 2421, M: 1902, Q: 1362, H: 986 },
  37: { L: 2556, M: 2003, Q: 1440, H: 1032 },
  38: { L: 2682, M: 2120, Q: 1516, H: 1080 },
  39: { L: 2807, M: 2208, Q: 1584, H: 1122 },
  40: { L: 2981, M: 2360, Q: 1690, H: 1206 },
}

/**
 * Estimate how many payload bytes fit in one QR frame for a given config.
 * Accounts for base64 encoding overhead (~33%) and frame header+CRC (~42 bytes).
 */
export function estimateMaxPayloadBytes(config: QrGenConfig): number {
  const v = config.version ?? 40 // pessimistic: assume worst case for auto
  const cap = QR_CAPACITY[v]?.[config.errorCorrectionLevel]
  if (!cap) return 500 // fallback

  // We encode binary frame → base64 string (×4/3 expansion)
  // The QR library stores the base64 in byte mode.
  // Each byte of capacity holds ~0.75 bytes of input (before base64).
  // Subtract frame header (38) + CRC (4) = 42 bytes overhead.
  const maxFrameBytes = Math.floor(cap * 0.73) // approximate after base64 expansion
  const maxPayload = Math.max(maxFrameBytes - 42, 50) // leave room for header+CRC
  return maxPayload
}

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