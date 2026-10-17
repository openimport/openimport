export type DetectedEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | (string & {})

/** Length of a byte-order mark at the start of `bytes`, if any. */
export function bomLength(bytes: Uint8Array): number {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 3
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return 2
  return 0
}

/**
 * Detects the text encoding of a sample: BOM first, then strict UTF-8, then
 * windows-1252 — the usual encoding of CSVs exported by Excel on Windows.
 */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  try {
    // `stream: true` tolerates a multi-byte sequence cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
    return 'utf-8'
  } catch {
    return 'windows-1252'
  }
}
