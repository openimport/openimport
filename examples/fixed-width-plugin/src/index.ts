import { definePlugin, type FormatAdapter, importError, type RawValue } from '@openimport/core'

export interface FixedWidthColumn {
  /** Header label the column gets (fixed-width files usually have no header line). */
  name: string
  /** 0-based start and exclusive end offset in the line. */
  start: number
  end: number
}

export interface FixedWidthOptions {
  columns: FixedWidthColumn[]
  extensions?: string[]
  /** Rows per yielded chunk. Default 1000. */
  chunkSize?: number
}

/**
 * Fixed-width text files (bank statements, ERP exports): every column lives
 * at a fixed character offset. Streams line by line, so memory stays flat.
 */
export function fixedWidthFormat(options: FixedWidthOptions): FormatAdapter {
  const { columns, chunkSize = 1000 } = options
  if (!columns.length) throw importError('invalid_plugin', 'fixedWidth() needs at least one column')
  const header = columns.map((c) => c.name)

  return {
    id: 'fixed-width',
    label: 'Fixed width',
    extensions: options.extensions ?? ['dat', 'fwf'],
    capabilities: { streaming: true, cancellation: true, sourceLocations: true },
    inspect: async (file) => ({ datasets: [{ id: 'lines', label: file.name, layout: 'grid' }] }),
    async *read(file, { signal }) {
      if (signal.aborted) throw signal.reason
      // The header row is synthesised from the column names; the core detects it like any other.
      let chunk: RawValue[][] = [header]
      for await (const line of lines(file.blob, signal)) {
        chunk.push(columns.map((c) => line.slice(c.start, c.end).trim()))
        if (chunk.length >= chunkSize) {
          yield chunk
          chunk = []
        }
      }
      if (signal.aborted) throw signal.reason
      if (chunk.length) yield chunk
    },
  }
}

async function* lines(blob: Blob, signal: AbortSignal): AsyncGenerator<string> {
  const reader = blob.stream().pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      if (signal.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        if (line.trim()) yield line
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) yield buffer.replace(/\r$/, '')
  } finally {
    reader.releaseLock()
  }
}

/** The plugin: the format plus an IBAN normaliser for mappings. */
export function fixedWidth(options: FixedWidthOptions) {
  return definePlugin({
    name: 'fixed-width',
    formats: [fixedWidthFormat(options)],
    transforms: [
      {
        op: 'iban',
        label: 'Normalize IBAN',
        description: 'Remove spaces and upper-case the IBAN.',
        arity: 'one',
        apply: (value) =>
          String(value ?? '')
            .replace(/\s+/g, '')
            .toUpperCase(),
      },
    ],
  })
}
