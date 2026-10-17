export type Segment = string | typeof ANY

/** Wildcard segment: every element of an array. */
export const ANY: unique symbol = Symbol('any')

export interface Collection {
  /** JSONPath-like id, e.g. `$.data.customers[*]`. */
  path: string
  segments: Segment[]
  /** Number of records found at this path. */
  count: number
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export const isPlainObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)

const IDENT = /^[A-Za-z_$][\w$]*$/

export function formatPath(segments: Segment[]): string {
  let out = '$'
  for (const s of segments) {
    if (s === ANY) out += '[*]'
    else out += IDENT.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`
  }
  return out
}

/** A record array: non-empty and (nearly) all elements are plain objects. */
function isRecordArray(value: Json[]): boolean {
  if (!value.length) return false
  let objects = 0
  for (const v of value) if (isPlainObject(v)) objects++
  return objects / value.length >= 0.9
}

/**
 * Finds every array of objects in a document, including arrays nested inside
 * records (`$.customers[*].orders[*]`). Element samples are bounded so huge
 * documents stay cheap to inspect.
 */
export function discoverCollections(doc: unknown, options: { maxDepth?: number; sampleSize?: number } = {}): Collection[] {
  const maxDepth = options.maxDepth ?? 8
  const sampleSize = options.sampleSize ?? 50
  const found = new Map<string, Collection>()

  const visit = (node: Json, segments: Segment[], depth: number) => {
    if (depth > maxDepth) return
    if (Array.isArray(node)) {
      if (isRecordArray(node)) {
        const path: Segment[] = [...segments, ANY]
        const id = formatPath(path)
        const existing = found.get(id)
        if (existing) existing.count += node.length
        else found.set(id, { path: id, segments: path, count: node.length })
        for (const item of node.slice(0, sampleSize)) if (isPlainObject(item)) visitObject(item, path, depth + 1)
      }
      return
    }
    if (isPlainObject(node)) visitObject(node, segments, depth + 1)
  }
  const visitObject = (obj: Record<string, Json>, segments: Segment[], depth: number) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) visit(value, [...segments, key] as Segment[], depth)
    }
  }

  visit(doc as Json, [], 0)
  // Nested collections were only sampled — count them exactly.
  for (const c of found.values()) {
    if (c.segments.length <= 1) continue
    let n = 0
    for (const item of resolve(doc, c.segments)) if (isPlainObject(item)) n++
    c.count = n
  }
  return [...found.values()].sort((a, b) => a.segments.length - b.segments.length || b.count - a.count)
}

/** Resolve all records at a path (wildcards fan out over arrays). */
export function* resolve(doc: unknown, segments: Segment[]): Generator<Json> {
  const walk = function* (node: Json, i: number): Generator<Json> {
    if (i === segments.length) {
      yield node
      return
    }
    const seg = segments[i] as Segment
    if (seg === ANY) {
      if (Array.isArray(node)) for (const item of node) yield* walk(item, i + 1)
    } else if (isPlainObject(node) && seg in node) {
      yield* walk(node[seg] as Json, i + 1)
    }
  }
  yield* walk(doc as Json, 0)
}

export type { Json }
