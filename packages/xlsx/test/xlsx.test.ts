import { createImporter, defineSchema, field, toSourceFile } from '@openimport/core'
import { describe, expect, it } from 'vitest'
import { xlsx, xlsxFormat } from '../src'
import { makeXlsx } from './make-xlsx'

const signal = new AbortController().signal
const born = new Date(Date.UTC(1990, 4, 17))

const workbook = () =>
  toSourceFile(
    new Blob([
      makeXlsx({
        People: [
          ['Export 2024', null, null, null],
          [null, null, null, null],
          ['Name', 'Born', 'Active', 'Score'],
          ['  Ann  ', born, true, 3.5],
          ['Bob', null, false, 2],
          [null, null, null, null],
        ],
        Orders: [
          ['Order', 'Amount'],
          ['A-1', 10],
        ],
        Empty: [],
      }) as BlobPart,
    ]),
    'export.xlsx',
  )

describe('xlsx format adapter', () => {
  it('lists every non-empty sheet as a grid dataset', async () => {
    const { datasets } = await xlsxFormat().inspect(workbook(), { signal })
    expect(datasets.map((d) => [d.id, d.layout, d.rowCount])).toEqual([
      ['People', 'grid', 4],
      ['Orders', 'grid', 1],
    ])
  })

  it('includes empty sheets on request', async () => {
    const { datasets } = await xlsxFormat({ includeEmptySheets: true }).inspect(workbook(), { signal })
    expect(datasets.map((d) => d.id)).toEqual(['People', 'Orders', 'Empty'])
  })

  it('reads strings, numbers, booleans and dates and trims trailing empties', async () => {
    const format = xlsxFormat()
    const file = workbook()
    const { datasets } = await format.inspect(file, { signal })
    const rows: unknown[][] = []
    for await (const chunk of format.read(file, { dataset: datasets[0]!, signal })) rows.push(...(chunk as unknown[][]))
    expect(rows).toEqual([['Export 2024'], [], ['Name', 'Born', 'Active', 'Score'], ['Ann', born, true, 3.5], ['Bob', null, false, 2]])
    expect(rows[3]![1]).toBeInstanceOf(Date)
  })

  it('reads a second sheet', async () => {
    const format = xlsxFormat()
    const file = workbook()
    const { datasets } = await format.inspect(file, { signal })
    const rows: unknown[][] = []
    for await (const chunk of format.read(file, { dataset: datasets[1]!, signal })) rows.push(...(chunk as unknown[][]))
    expect(rows).toEqual([
      ['Order', 'Amount'],
      ['A-1', 10],
    ])
  })

  it('rejects legacy .xls with a helpful message', async () => {
    const file = toSourceFile(new Blob(['nope']), 'old.xls')
    await expect(xlsxFormat().inspect(file, { signal })).rejects.toMatchObject({ code: 'unsupported_file' })
  })

  it('does not claim CSV files that Windows labels as Excel', () => {
    const s = (name: string, type = '') => xlsxFormat().supports!(toSourceFile(new Blob([''], { type }), name))
    expect(s('data.csv', 'application/vnd.ms-excel')).toBe(false)
    expect(s('book.XLSX')).toBe(true)
    expect(s('download', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true)
  })

  it('reports corrupt files as parse errors', async () => {
    const file = toSourceFile(new Blob(['not a zip']), 'broken.xlsx')
    await expect(xlsxFormat().inspect(file, { signal })).rejects.toMatchObject({ code: 'parse_failed' })
  })
})

describe('xlsx with an import session', () => {
  it('detects the header row below the title and maps the columns', async () => {
    const importer = createImporter({
      schema: defineSchema({
        fields: {
          name: field.string({ required: true }),
          born: field.date(),
          active: field.boolean(),
          score: field.number(),
        },
      }),
      plugins: [xlsx()],
      recipes: false,
    })
    const session = importer.createSession()
    await session.loadFile(workbook())
    expect(session.getState().step).toBe('dataset')
    await session.selectDataset('People')
    expect(session.getState().step).toBe('header')
    expect(session.getState().detectedHeaderRow).toBe(2)
    await session.confirmHeader()
    expect(session.getState().step).toBe('mapping')
    await session.confirmMapping({ saveRecipe: false })
    expect(await session.getRecords()).toEqual([
      { name: 'Ann', born: '1990-05-17', active: true, score: 3.5 },
      { name: 'Bob', active: false, score: 2 },
    ])
  })
})
