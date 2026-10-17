import { strToU8, zipSync } from 'fflate'

export type Cell = string | number | boolean | Date | null

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Excel serial date (days since 1899-12-30, UTC). */
const serial = (d: Date) => d.getTime() / 86_400_000 + 25569

/**
 * Builds a minimal but valid .xlsx workbook (shared strings, a date style,
 * booleans, numbers) — enough to exercise real spreadsheet readers in tests.
 */
export function makeXlsx(sheets: Record<string, Cell[][]>): Uint8Array {
  const strings: string[] = []
  const stringIndex = new Map<string, number>()
  const sharedString = (s: string) => {
    let i = stringIndex.get(s)
    if (i === undefined) {
      i = strings.length
      strings.push(s)
      stringIndex.set(s, i)
    }
    return i
  }

  const names = Object.keys(sheets)
  const files: Record<string, Uint8Array> = {}
  names.forEach((name, si) => {
    const rows = (sheets[name] ?? [])
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${colName(c)}${r + 1}`
            if (cell === null) return ''
            if (typeof cell === 'string') return `<c r="${ref}" t="s"><v>${sharedString(cell)}</v></c>`
            if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`
            if (cell instanceof Date) return `<c r="${ref}" s="1"><v>${serial(cell)}</v></c>`
            return `<c r="${ref}"><v>${cell}</v></c>`
          })
          .join('')
        return `<row r="${r + 1}">${cells}</row>`
      })
      .join('')
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    )
  })

  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join(
        '',
      )}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  )
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  )
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        '',
      )}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${names.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join('')}</sst>`,
  )
  files['xl/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  )
  return zipSync(files)
}
