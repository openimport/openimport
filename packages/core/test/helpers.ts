import { definePlugin, type FormatAdapter, type RawValue } from '../src'

/** A naive CSV adapter for tests (the real one lives in @openimport/csv). */
export const testCsv: FormatAdapter = {
  id: 'test-csv',
  label: 'CSV',
  extensions: ['csv'],
  inspect: async () => ({ datasets: [{ id: 'default', label: 'Data', layout: 'grid' }] }),
  async *read(file) {
    const text = await file.blob.text()
    const rows = text
      .split(/\r?\n/)
      .filter((l, i, all) => l !== '' || i < all.length - 1)
      .map((l) => l.split(l.includes(';') ? ';' : ','))
    for (let i = 0; i < rows.length; i += 2) yield rows.slice(i, i + 2) as RawValue[][]
  },
}

export const testJson: FormatAdapter = {
  id: 'test-json',
  label: 'JSON',
  extensions: ['json'],
  inspect: async () => ({ datasets: [{ id: '$', label: 'Records', layout: 'records' }] }),
  async *read(file) {
    yield JSON.parse(await file.blob.text())
  },
}

export const testFormats = definePlugin({ name: 'test-formats', formats: [testCsv, testJson] })
