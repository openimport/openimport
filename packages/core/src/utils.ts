import type { RawValue } from './types'

/** `firstName` / `first_name` / `first-name` → `First name` */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** Segments that would reach `Object.prototype` when used as property names. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/** A dot path is safe when every segment is non-empty and can't reach a prototype. */
export function isSafePath(path: string): boolean {
  return path.split('.').every((p) => p !== '' && !UNSAFE_SEGMENTS.has(p))
}

export const isSafeKey = (key: string) => !UNSAFE_SEGMENTS.has(key)

/** Sets `value` at a dot path, creating intermediate objects. Refuses unsafe paths. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  if (!isSafePath(path)) throw new Error(`[openimport] Unsafe path "${path}"`)
  const parts = path.split('.')
  let node: Record<string, unknown> = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string
    const next = Object.hasOwn(node, part) ? node[part] : undefined
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[part] = {}
    node = node[part] as Record<string, unknown>
  }
  node[parts.at(-1) as string] = value
}

export function getPath(source: unknown, path: string): unknown {
  let node = source
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** Flat `{ 'a.b': 1 }` → nested `{ a: { b: 1 } }`, skipping `undefined`. */
export function nest(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue
    setPath(out, key, value)
  }
  return out
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** Display string for any raw value. */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  if (Array.isArray(value)) return value.map(stringify).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Yield to the event loop so long-running work keeps the UI responsive. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let counter = 0
export function createId(prefix = 'oi'): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function toRawString(value: RawValue): string {
  return stringify(value).trim()
}
