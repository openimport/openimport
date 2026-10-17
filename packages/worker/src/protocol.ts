import type { ImportError, ImportEvent, SessionState, SubmitFeedback } from '@openimport/core'

/** Anything that can exchange messages: a `Worker`, the worker's `self`, a `MessagePort`. */
export interface Endpoint {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  start?(): void
}

/** Read-only queries: their results don't change state, so no state is sent back with them. */
export const QUERIES = new Set<string>(['previewField', 'distinctValues', 'exportRecipe', 'countRows', 'getRows', 'rowIds', 'findIssue'])

/** Session methods the main thread may call. Everything else is rejected. */
export const METHODS = [
  'loadFile',
  'selectDataset',
  'setHeaderRow',
  'confirmHeader',
  'setMapping',
  'assign',
  'clearMapping',
  'autoMap',
  'previewField',
  'distinctValues',
  'confirmMapping',
  'exportRecipe',
  'countRows',
  'getRows',
  'rowIds',
  'findIssue',
  'editCell',
  'replaceValues',
  'deleteRows',
  'deleteInvalidRows',
  'submit',
  'reviewRejected',
  'back',
  'reset',
  'abort',
  'clearError',
] as const
export type Method = (typeof METHODS)[number]

export type ToWorker =
  | { t: 'call'; id: number; method: Method; args: unknown[] }
  | { t: 'feedback'; id: number; batch: number; ok: true; value: SubmitFeedback | undefined }
  | { t: 'feedback'; id: number; batch: number; ok: false; error: SerializedError }

export type FromWorker =
  | { t: 'hello'; fields: string[]; formats: string[] }
  | { t: 'state'; state: SessionState }
  | { t: 'result'; id: number; value: unknown; state?: SessionState }
  | { t: 'error'; id: number; error: SerializedError }
  | {
      t: 'batch'
      id: number
      batch: number
      payload: { records: unknown[]; rows: unknown[]; index: number; total: number; batchId: string }
    }
  | { t: 'event'; event: ImportEvent }

export interface SerializedError {
  name: string
  message: string
  code?: ImportError['code']
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error)
    return { name: error.name, message: error.message, ...('code' in error ? { code: (error as ImportError).code } : {}) }
  if (typeof error === 'object' && error && 'message' in error)
    return {
      name: 'Error',
      message: String((error as { message: unknown }).message),
      ...('code' in error ? { code: (error as ImportError).code } : {}),
    }
  return { name: 'Error', message: String(error) }
}

export function reviveError(e: SerializedError): Error {
  const error = new Error(e.message) as Error & { code?: string }
  error.name = e.name
  if (e.code) error.code = e.code
  return error
}

/** State without the rows (they stay in the worker) and without unclonable error causes. */
export function portableState(state: SessionState): SessionState {
  return {
    ...state,
    rows: [],
    error: state.error ? { code: state.error.code, message: state.error.message } : null,
  }
}

const sameFile = (a: SessionState['file'], b: SessionState['file']) =>
  a === b || (!!a && !!b && a.name === b.name && a.size === b.size && a.type === b.type && a.extension === b.extension)

/**
 * Every message is a fresh copy, so keep the previous object for each part of
 * the state that didn't change. Without this, memoised UI (and queries keyed
 * on e.g. the mapping) would re-run on every message.
 */
export function reconcile(previous: SessionState, next: SessionState): SessionState {
  let changed = false
  const out = { ...next } as Record<string, unknown>
  for (const key of Object.keys(next) as (keyof SessionState)[]) {
    const a = previous[key]
    const b = next[key]
    if (Object.is(a, b)) continue
    const same =
      key === 'file'
        ? sameFile(a as SessionState['file'], b as SessionState['file'])
        : typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b)
    if (same) out[key] = a
    else changed = true
  }
  return changed ? (out as unknown as SessionState) : previous
}
