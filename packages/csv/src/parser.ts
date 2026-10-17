export type Delimiter = ',' | ';' | '\t' | '|' | (string & {})

export interface CsvParserOptions {
  /** Field delimiter. Sniffed by `parseCsv` when omitted; required for `createCsvParser`. */
  delimiter?: Delimiter
  /** Quote character. Default `"`. */
  quote?: string
}

export interface CsvParser {
  /** Feed the next piece of text. Returns rows completed by it. */
  push: (text: string) => string[][]
  /** Signal end of input. Returns the last row, if any. */
  flush: () => string[][]
}

/**
 * Incremental RFC 4180 parser. Text can be split anywhere — inside quoted
 * fields, between `\r` and `\n`, or between an escaped `""` pair.
 *
 * Blank lines yield an empty array so row indices keep matching file lines.
 */
export function createCsvParser(options: CsvParserOptions = {}): CsvParser {
  const delimiter = options.delimiter ?? ','
  const quote = options.quote ?? '"'
  if (delimiter.length !== 1 || quote.length !== 1) throw new Error('[openimport/csv] delimiter and quote must be single characters')
  const DELIM = delimiter.charCodeAt(0)
  const QUOTE = quote.charCodeAt(0)
  const CR = 13
  const LF = 10

  let row: string[] = []
  let field = ''
  let inQuotes = false
  /** A closing quote was just seen; a following quote means an escaped quote. */
  let afterQuote = false
  /** Current field began with a quote (so text after the closing quote is appended verbatim). */
  let quoted = false
  /** Anything has been read for the current row. */
  let rowStarted = false
  /** Last chunk ended with `\r`; swallow a leading `\n`. */
  let skipLF = false

  const endField = () => {
    row.push(field)
    field = ''
    quoted = false
    afterQuote = false
  }

  const push = (text: string): string[][] => {
    const rows: string[][] = []
    const endRow = () => {
      endField()
      rows.push(row.length === 1 && row[0] === '' && !rowStarted ? [] : row)
      row = []
      rowStarted = false
    }
    const n = text.length
    let i = 0
    if (skipLF && n > 0) {
      if (text.charCodeAt(0) === LF) i = 1
      skipLF = false
    }
    while (i < n) {
      if (inQuotes) {
        const next = text.indexOf(quote, i)
        if (next === -1) {
          field += text.slice(i)
          break
        }
        field += text.slice(i, next)
        inQuotes = false
        afterQuote = true
        i = next + 1
        continue
      }
      const c = text.charCodeAt(i)
      if (c === QUOTE) {
        rowStarted = true
        if (afterQuote) {
          // `""` inside a quoted field → literal quote
          field += quote
          inQuotes = true
          afterQuote = false
        } else if (field === '' && !quoted) {
          inQuotes = true
          quoted = true
        } else {
          field += quote // stray quote inside an unquoted field: keep it
        }
        i++
        continue
      }
      afterQuote = false
      if (c === DELIM) {
        rowStarted = true
        endField()
        i++
      } else if (c === LF) {
        endRow()
        i++
      } else if (c === CR) {
        endRow()
        i++
        if (i < n) {
          if (text.charCodeAt(i) === LF) i++
        } else skipLF = true
      } else {
        // Fast path: consume a run of ordinary characters.
        let j = i + 1
        while (j < n) {
          const d = text.charCodeAt(j)
          if (d === DELIM || d === LF || d === CR || d === QUOTE) break
          j++
        }
        field += text.slice(i, j)
        rowStarted = true
        i = j
      }
    }
    return rows
  }

  const flush = (): string[][] => {
    if (!rowStarted && field === '' && row.length === 0) return []
    endField()
    const last = row
    row = []
    rowStarted = false
    inQuotes = false
    return [last]
  }

  return { push, flush }
}

const CANDIDATES: Delimiter[] = [',', ';', '\t', '|']

/**
 * Picks the delimiter whose per-line count is most consistent across the first
 * lines (quoted sections are ignored). Falls back to `,`.
 */
export function sniffDelimiter(sample: string, candidates: Delimiter[] = CANDIDATES, maxLines = 30): Delimiter {
  const counts: Map<Delimiter, number[]> = new Map(candidates.map((d) => [d, []]))
  const current = new Map<Delimiter, number>(candidates.map((d) => [d, 0]))
  let inQuotes = false
  let lines = 0
  let lineHasContent = false
  const endLine = () => {
    if (lineHasContent) {
      for (const d of candidates) counts.get(d)?.push(current.get(d) ?? 0)
      lines++
    }
    for (const d of candidates) current.set(d, 0)
    lineHasContent = false
  }
  for (let i = 0; i < sample.length && lines < maxLines; i++) {
    const c = sample[i] as string
    if (c === '"') inQuotes = !inQuotes
    else if (inQuotes) continue
    else if (c === '\n' || c === '\r') endLine()
    else {
      lineHasContent = true
      if (current.has(c)) current.set(c, (current.get(c) ?? 0) + 1)
    }
  }
  // An unterminated last line in a truncated sample is still informative when it's the only one.
  if (lines === 0) endLine()

  let best: Delimiter = ','
  let bestScore = 0
  for (const d of candidates) {
    const list = counts.get(d) ?? []
    if (!list.length) continue
    const freq = new Map<number, number>()
    for (const n of list) if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1)
    const mode = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    if (!mode) continue
    const [modeCount, modeLines] = mode
    const consistency = modeLines / list.length
    // Consistency dominates; more columns breaks ties.
    const score = consistency * 1000 + Math.min(modeCount, 999)
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** Parse a complete CSV string. The delimiter is sniffed unless given. Blank lines are dropped. */
export function parseCsv(text: string, options: CsvParserOptions = {}): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const parser = createCsvParser({ ...options, delimiter: options.delimiter ?? sniffDelimiter(input.slice(0, 64 * 1024)) })
  return [...parser.push(input), ...parser.flush()].filter((r) => r.length > 0)
}
