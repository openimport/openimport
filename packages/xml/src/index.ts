import type { DatasetInfo, FormatAdapter, ImportError, ImportPlugin, RawValue, SourceFile } from '@openimport/core'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export interface XmlOptions {
  /** Keep namespace prefixes (`ns:name`). Default `false` (prefixes are stripped). */
  keepNamespaces?: boolean
  /** Key used for an element's text when it also has attributes or children. Default `#text`. */
  textKey?: string
  /** Rows per yielded chunk. Default `1000`. */
  chunkSize?: number
}

type Node = string | Node[] | { [key: string]: Node }

const ATTR = '@_'
const TEXT = '#text'
const isObject = (v: unknown): v is Record<string, Node> => typeof v === 'object' && v !== null && !Array.isArray(v)
const fail = (message: string, cause?: unknown): ImportError => ({ code: 'parse_failed', message, ...(cause ? { cause } : {}) })
const isElementKey = (k: string) => !k.startsWith(ATTR) && k !== TEXT && !k.startsWith('?')

/** Decode respecting a BOM or the `encoding` in the XML declaration (e.g. ISO-8859-1). */
export async function decodeXml(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200))
  const declared = /^\s*<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head)?.[1]
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(declared ?? 'utf-8')
  } catch {
    decoder = new TextDecoder('utf-8')
  }
  return decoder.decode(bytes)
}

/** Every item at an element path, fanning out over repeated elements. */
function* resolve(node: Node, path: string[], i = 0): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* resolve(item, path, i)
    return
  }
  if (i === path.length) {
    yield node
    return
  }
  if (isObject(node)) {
    const next = node[path[i] as string]
    if (next !== undefined) yield* resolve(next, path, i + 1)
  }
}

/** `customers`/`customer`, `orderList`/`order`, `Items`/`Item`, `people`/`person` … */
function isPluralOf(parent: string, child: string): boolean {
  const p = parent.toLowerCase()
  const c = child.toLowerCase()
  return (
    p === `${c}s` ||
    p === `${c}es` ||
    p === `${c.replace(/y$/, '')}ies` ||
    p === `${c}list` ||
    p === `${c}collection` ||
    (c === 'person' && p === 'people')
  )
}

/**
 * Finds repeated elements (record collections). The parser only creates arrays
 * for ≥2 siblings, so a lone child of a plural container (`<customers>` with one
 * `<customer>`) is recognised by name as a fallback.
 */
export function discoverElements(doc: Node, maxDepth = 10): string[][] {
  const found = new Map<string, string[]>()
  const visit = (node: Node, path: string[], depth: number) => {
    if (depth > maxDepth || !isObject(node)) return
    for (const [key, value] of Object.entries(node)) {
      if (!isElementKey(key)) continue
      const next = [...path, key]
      if (Array.isArray(value)) {
        // Empty elements (`<item/>`) parse as '' — they're still records.
        const objects = value.filter(isObject)
        const records = objects.length + value.filter((v) => v === '').length
        if (objects.length && records >= value.length * 0.9) found.set(next.join('/'), next)
        for (const item of objects.slice(0, 50)) visit(item, next, depth + 1)
      } else if (isObject(value)) {
        if (path.length && isPluralOf(path.at(-1) as string, key)) found.set(next.join('/'), next)
        visit(value, next, depth + 1)
      }
    }
  }
  visit(doc, [], 0)
  return [...found.values()]
}

/** Element → plain record: attributes lose their prefix (unless a child has the same name). */
function toRecord(node: Node, textKey: string): RawValue {
  if (Array.isArray(node)) return node.map((n) => toRecord(n, textKey))
  if (!isObject(node)) return node
  const out: Record<string, RawValue> = {}
  const children = new Set(Object.keys(node).filter(isElementKey))
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('?')) continue
    if (key.startsWith(ATTR)) {
      const name = key.slice(ATTR.length)
      out[children.has(name) ? `@${name}` : name] = value as string
    } else if (key === TEXT) out[children.has(textKey) ? TEXT : textKey] = value as string
    else out[key] = toRecord(value, textKey)
  }
  return out
}

interface Parsed {
  doc: Node
  datasets: { info: DatasetInfo; path: string[] }[]
}

/**
 * XML format adapter. Repeated elements become datasets (`/customers/customer`);
 * attributes and child elements become (nested) record properties. All values
 * stay strings — the importer coerces them according to your schema.
 */
export function xmlFormat(options: XmlOptions = {}): FormatAdapter {
  const textKey = options.textKey ?? TEXT
  const chunkSize = options.chunkSize ?? 1000
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR,
    textNodeName: TEXT,
    removeNSPrefix: !options.keepNamespaces,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    cdataPropName: false,
  })
  const cache = new WeakMap<Blob, Promise<Parsed>>()
  const parse = (file: SourceFile): Promise<Parsed> => {
    let pending = cache.get(file.blob)
    if (!pending) {
      pending = decodeXml(file.blob).then((text) => {
        const valid = XMLValidator.validate(text)
        if (valid !== true) {
          cache.delete(file.blob)
          throw fail(`Invalid XML on line ${valid.err.line}: ${valid.err.msg}`, valid.err)
        }
        const doc = parser.parse(text) as Node
        let paths = discoverElements(doc)
        if (!paths.length && isObject(doc)) {
          // No collections: treat the root element as a single record.
          const root = Object.keys(doc).find(isElementKey)
          if (root) paths = [[root]]
        }
        const datasets = paths
          .map((path) => {
            const p = `/${path.join('/')}`
            let count = 0
            for (const _ of resolve(doc, path)) count++
            return { info: { id: p, label: path.at(-1) as string, path: p, layout: 'records' as const, rowCount: count }, path }
          })
          .sort((a, b) => a.path.length - b.path.length || (b.info.rowCount ?? 0) - (a.info.rowCount ?? 0))
        return { doc, datasets }
      })
      cache.set(file.blob, pending)
    }
    return pending
  }

  return {
    id: 'xml',
    label: 'XML',
    capabilities: { streaming: false, cancellation: true, sourceLocations: false },
    extensions: ['xml'],
    mimeTypes: ['application/xml', 'text/xml'],
    inspect: async (file) => ({ datasets: (await parse(file)).datasets.map((d) => d.info) }),
    read: async function* (file, { dataset, signal }) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const { doc, datasets } = await parse(file)
      const match = datasets.find((d) => d.info.id === dataset.id)
      if (!match) throw fail(`Element "${dataset.id}" not found`)
      let chunk: Record<string, RawValue>[] = []
      for (const node of resolve(doc, match.path)) {
        const record = node === '' ? {} : toRecord(node, textKey)
        chunk.push(isObject(record) ? (record as Record<string, RawValue>) : { [textKey]: record })
        if (chunk.length >= chunkSize) {
          if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
          yield chunk
          chunk = []
        }
      }
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      if (chunk.length) yield chunk
    },
  }
}

/** OpenImport plugin for XML documents. */
export function xml(options: XmlOptions = {}): ImportPlugin {
  return { name: 'xml', formats: [xmlFormat(options)] }
}

export default xml
