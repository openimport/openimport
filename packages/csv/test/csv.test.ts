import { createImporter, defineSchema, field, type SourceFile, sourceFromString, toSourceFile } from '@openimport/core'
import { describe, expect, it } from 'vitest'
import { createCsvParser, csv, csvFormat, detectEncoding, parseCsv, sniffDelimiter } from '../src'

const signal = new AbortController().signal

async function readAll(file: SourceFile, options = {}) {
  const format = csvFormat(options)
  const { datasets } = await format.inspect(file, { signal })
  const rows: unknown[][] = []
  for await (const chunk of format.read(file, { dataset: datasets[0]!, signal })) rows.push(...(chunk as unknown[][]))
  return { rows, dataset: datasets[0]! }
}

/** A Blob-like whose stream() emits exactly the given byte chunks. */
function chunkedFile(parts: Uint8Array[], name = 'data.csv'): SourceFile {
  const whole = new Blob(parts as BlobPart[])
  const blob = {
    size: whole.size,
    type: '',
    slice: (...args: Parameters<Blob['slice']>) => whole.slice(...args),
    arrayBuffer: () => whole.arrayBuffer(),
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const p of parts) controller.enqueue(p)
          controller.close()
        },
      }),
  } as unknown as Blob
  return toSourceFile(blob, name)
}

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted fields with delimiters, newlines and escaped quotes', () => {
    const text = 'name,note\n"Doe, Jane","said ""hi""\nthen left"\n'
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nthen left'],
    ])
  })

  it('handles CRLF, CR and LF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4\n5,6')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ])
  })

  it('strips a BOM and keeps the last row without trailing newline', () => {
    expect(parseCsv('﻿a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps ragged rows and empty fields', () => {
    expect(parseCsv('a,b,c\n1\n,,\n"",x', { delimiter: ',' })).toEqual([['a', 'b', 'c'], ['1'], ['', '', ''], ['', 'x']])
  })

  it('treats stray quotes in unquoted fields literally', () => {
    expect(parseCsv('a,b\n5" screen,x\n', { delimiter: ',' })).toEqual([
      ['a', 'b'],
      ['5" screen', 'x'],
    ])
  })

  it('supports a custom quote character', () => {
    expect(parseCsv("a,b\n'x, y',z", { delimiter: ',', quote: "'" })).toEqual([
      ['a', 'b'],
      ['x, y', 'z'],
    ])
  })
})

describe('createCsvParser (incremental)', () => {
  const text = 'id,text,more\r\n1,"multi\r\nline, with ""quotes""",x\r\n2,plain,"y"\r\n\r\n3,"",z'
  const expected = [['id', 'text', 'more'], ['1', 'multi\r\nline, with "quotes"', 'x'], ['2', 'plain', 'y'], [], ['3', '', 'z']]

  it('produces the same rows regardless of where the input is split', () => {
    for (let i = 0; i <= text.length; i++) {
      for (const j of [i, Math.min(i + 1, text.length), Math.min(i + 3, text.length)]) {
        const p = createCsvParser({ delimiter: ',' })
        const rows = [...p.push(text.slice(0, i)), ...p.push(text.slice(i, j)), ...p.push(text.slice(j)), ...p.flush()]
        expect(rows, `split at ${i}/${j}`).toEqual(expected)
      }
    }
  })

  it('handles single-character pushes', () => {
    const p = createCsvParser({ delimiter: ',' })
    const rows: string[][] = []
    for (const c of text) rows.push(...p.push(c))
    rows.push(...p.flush())
    expect(rows).toEqual(expected)
  })

  it('emits nothing for empty input', () => {
    const p = createCsvParser()
    expect([...p.push(''), ...p.flush()]).toEqual([])
  })
})

describe('sniffDelimiter', () => {
  it('detects semicolons (German Excel)', () => {
    expect(sniffDelimiter('Name;Betrag;Datum\nMüller;1.234,56;01.02.2024\nSchmidt;99,00;03.02.2024\n')).toBe(';')
  })

  it('detects tabs', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6\n')).toBe('\t')
  })

  it('detects pipes', () => {
    expect(sniffDelimiter('a|b\n1|2\n')).toBe('|')
  })

  it('ignores delimiters inside quotes', () => {
    expect(sniffDelimiter('a;b\n"x, y, z";2\n"p, q";3\n')).toBe(';')
  })

  it('prefers the consistent delimiter over the frequent one', () => {
    expect(sniffDelimiter('name,note\nA,"x"\nB,"y; z; w; v"\nC,c\n')).toBe(',')
  })

  it('defaults to comma for single-column data', () => {
    expect(sniffDelimiter('email\na@b.de\nc@d.de\n')).toBe(',')
  })
})

describe('detectEncoding', () => {
  it('detects BOMs', () => {
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('utf-8')
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le')
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be')
  })

  it('falls back to windows-1252 for invalid UTF-8', () => {
    // "Müller;Größe" in windows-1252
    expect(detectEncoding(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x3b, 0x47, 0x72, 0xf6, 0xdf, 0x65]))).toBe('windows-1252')
  })

  it('accepts UTF-8 cut in the middle of a multi-byte character', () => {
    const bytes = new TextEncoder().encode('Grüße')
    expect(detectEncoding(bytes.slice(0, 3))).toBe('utf-8')
  })
})

describe('csv format adapter', () => {
  it('inspects a file: one grid dataset with delimiter, encoding and row count', async () => {
    const file = sourceFromString('a;b\n1;2\n3;4\n', 'x.csv')
    const { datasets } = await csvFormat().inspect(file, { signal })
    expect(datasets).toEqual([{ id: 'csv', label: 'x.csv', layout: 'grid', rowCount: 2, meta: { delimiter: ';', encoding: 'utf-8' } }])
  })

  it('reads windows-1252 files with umlauts', async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Name;Stadt\n'),
      0x4d,
      0xfc,
      0x6c,
      0x6c,
      0x65,
      0x72,
      0x3b, // Müller;
      0x4b,
      0xf6,
      0x6c,
      0x6e,
      0x0a, // Köln\n
      0x47,
      0x72,
      0xf6,
      0xdf,
      0x65,
      0x3b,
      0x80,
      0x0a, // Größe;€\n
    ])
    const { rows, dataset } = await readAll(toSourceFile(new Blob([bytes]), 'export.csv'))
    expect(dataset.meta).toMatchObject({ encoding: 'windows-1252', delimiter: ';' })
    expect(rows).toEqual([
      ['Name', 'Stadt'],
      ['Müller', 'Köln'],
      ['Größe', '€'],
    ])
  })

  it('reads UTF-16LE with BOM', async () => {
    const text = 'a\tb\nä\tö\n'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes[0] = 0xff
    bytes[1] = 0xfe
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      bytes[2 + i * 2] = code & 0xff
      bytes[3 + i * 2] = code >> 8
    }
    const { rows } = await readAll(toSourceFile(new Blob([bytes]), 'u16.tsv'))
    expect(rows).toEqual([
      ['a', 'b'],
      ['ä', 'ö'],
    ])
  })

  it('strips a UTF-8 BOM', async () => {
    const { rows } = await readAll(sourceFromString('﻿email\nx@y.de\n', 'bom.csv'))
    expect(rows[0]).toEqual(['email'])
  })

  it('handles stream chunks splitting quoted fields, CRLF and multi-byte characters', async () => {
    const bytes = new TextEncoder().encode('name,city\r\n"Jürgen, ""JJ""",Köln\r\nAnna,"Mün\nchen"\r\n')
    // split into 1..7 byte chunks
    const parts: Uint8Array[] = []
    for (let i = 0, n = 1; i < bytes.length; i += n, n = (n % 7) + 1) parts.push(bytes.slice(i, i + n))
    const { rows } = await readAll(chunkedFile(parts))
    expect(rows).toEqual([
      ['name', 'city'],
      ['Jürgen, "JJ"', 'Köln'],
      ['Anna', 'Mün\nchen'],
    ])
  })

  it('yields rows in chunks of `chunkSize`', async () => {
    const text = `n\n${Array.from({ length: 2500 }, (_, i) => i).join('\n')}\n`
    const format = csvFormat({ chunkSize: 1000 })
    const file = sourceFromString(text, 'big.csv')
    const { datasets } = await format.inspect(file, { signal })
    const sizes: number[] = []
    for await (const chunk of format.read(file, { dataset: datasets[0]!, signal })) sizes.push(chunk.length)
    expect(sizes).toEqual([1000, 1000, 501])
  })

  it('estimates the row count for files larger than the sample', async () => {
    const line = 'alpha,beta,gamma,delta\n'
    const text = line.repeat(10_000)
    const { datasets } = await csvFormat().inspect(sourceFromString(text, 'large.csv'), { signal })
    expect(datasets[0]!.meta?.estimated).toBe(true)
    expect(datasets[0]!.rowCount).toBeGreaterThan(9_000)
    expect(datasets[0]!.rowCount).toBeLessThan(11_000)
  })

  it('honours forced delimiter and encoding', async () => {
    const { rows, dataset } = await readAll(sourceFromString('a;b,c\n1;2,3\n', 'f.csv'), { delimiter: ';', encoding: 'utf-8' })
    expect(dataset.meta).toMatchObject({ delimiter: ';' })
    expect(rows[1]).toEqual(['1', '2,3'])
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    const format = csvFormat({ chunkSize: 10 })
    const file = sourceFromString(`n\n${'x\n'.repeat(100)}`, 'a.csv')
    const { datasets } = await format.inspect(file, { signal })
    const run = async () => {
      for await (const _ of format.read(file, { dataset: datasets[0]!, signal: controller.signal })) controller.abort()
    }
    await expect(run()).rejects.toThrow()
  })

  it('supports files by extension or MIME type, but not foreign formats', () => {
    const format = csvFormat()
    const s = (name: string, type = '') => format.supports!(toSourceFile(new Blob([''], { type }), name))
    expect(s('a.csv')).toBe(true)
    expect(s('a.TSV')).toBe(true)
    expect(s('export', 'text/csv')).toBe(true)
    expect(s('data.json', 'text/plain')).toBe(false)
    expect(s('a.xlsx')).toBe(false)
  })
})

describe('csv plugin with the core importer', () => {
  it('runs a headless import end to end', async () => {
    const importer = createImporter({
      schema: defineSchema({
        fields: {
          firstName: field.string({ required: true }),
          email: field.email({ required: true }),
          amount: field.number(),
        },
      }),
      plugins: [csv()],
      recipes: false,
    })
    const file = sourceFromString('Vorname;E-Mail;Betrag\nJana;jana@example.com;1.234,50\nOle;kaputt;3\n', 'kunden.csv')
    const records: unknown[] = []
    let errors = 0
    for await (const chunk of importer.run(file)) {
      records.push(...chunk.records)
      errors += chunk.invalid.length
    }
    expect(records).toEqual([{ firstName: 'Jana', email: 'jana@example.com', amount: 1234.5 }])
    expect(errors).toBe(1)
  })
})
