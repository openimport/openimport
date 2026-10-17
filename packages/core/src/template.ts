import type { ImportSchema } from './types'

const escapeCell = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * A CSV template users can download and fill in: one column per field, with
 * an optional example row built from `examples` / enum options.
 */
export function createTemplateCsv(schema: ImportSchema<unknown>, options: { examples?: boolean; delimiter?: string } = {}): string {
  const d = options.delimiter ?? ','
  const header = schema.fields.map((f) => escapeCell(f.label)).join(d)
  if (options.examples === false) return `${header}\r\n`
  const example = schema.fields.map((f) => escapeCell(f.examples?.[0] ?? f.options?.[0]?.value ?? '')).join(d)
  return `${header}\r\n${example}\r\n`
}
