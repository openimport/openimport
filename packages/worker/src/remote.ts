import {
  type CustomField,
  type CustomFieldInput,
  type DistinctValue,
  type FieldMapping,
  type FieldPreview,
  type ImportEvent,
  type Importer,
  type ImportRecord,
  initialState,
  type MaybePromise,
  type Recipe,
  type ReviewRow,
  type RowQuery,
  type SessionLike,
  type SessionState,
  type SourceFile,
  type SubmitHandler,
  type SubmitResult,
  toSourceFile,
  withCustomFields,
} from '@openimport/core'
import { type Endpoint, type FromWorker, type Method, reconcile, reviveError, serializeError, type ToWorker } from './protocol'

export interface WorkerSessionOptions {
  /** Lifecycle events from the worker (the importer's own listeners run in the worker). */
  onEvent?: (event: ImportEvent) => void
}

type Listener = (state: SessionState, previous: SessionState) => void

/**
 * A session whose work happens in a Web Worker. It implements the same
 * interface as an in-process session, so `<Importer session={…}>` and the
 * React hooks work unchanged. Review rows stay in the worker; the grid
 * fetches the rows it shows.
 */
export class RemoteSession<T = Record<string, unknown>> implements SessionLike<T> {
  readonly importer: Importer<T>
  readonly id: string
  #endpoint: Endpoint & { terminate?: () => void }
  #state: SessionState = initialState()
  #listeners = new Set<Listener>()
  #next = 1
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  #handlers = new Map<number, { handler: SubmitHandler<T>; controller: AbortController }>()
  #onEvent: ((event: ImportEvent) => void) | undefined
  #disposed = false

  constructor(importer: Importer<T>, endpoint: Endpoint & { terminate?: () => void }, options: WorkerSessionOptions = {}) {
    this.importer = importer
    this.id = `worker_${Math.random().toString(36).slice(2, 10)}`
    this.#endpoint = endpoint
    this.#onEvent = options.onEvent
    endpoint.addEventListener('message', this.#onMessage)
    ;(endpoint as unknown as EventTarget).addEventListener?.('error', this.#onWorkerError as EventListener)
    endpoint.start?.()
  }

  /** The importer's schema plus the custom fields added in the worker (same object until they change). */
  get schema() {
    return withCustomFields(this.importer.schema, this.#state.customFields)
  }

  getState = (): SessionState => this.#state
  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #setState(incoming: SessionState) {
    const previous = this.#state
    const next = reconcile(previous, incoming)
    if (previous === next) return
    this.#state = next
    for (const l of this.#listeners) l(next, previous)
  }

  #onMessage = (event: MessageEvent) => {
    const message = event.data as FromWorker
    if (!message || typeof message !== 'object') return
    switch (message.t) {
      case 'hello': {
        const here = this.importer.schema.fields.map((f) => f.key).join(',')
        if (here !== message.fields.join(',')) {
          console.error(
            '[openimport] The worker importer has a different schema than the one on the page. Create both from the same module.',
          )
        }
        return
      }
      case 'state':
        this.#setState(message.state)
        return
      case 'result': {
        if (message.state) this.#setState(message.state)
        const p = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        this.#handlers.delete(message.id)
        p?.resolve(message.value)
        return
      }
      case 'error': {
        const p = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        this.#handlers.delete(message.id)
        p?.reject(reviveError(message.error))
        return
      }
      case 'batch':
        void this.#runBatch(message)
        return
      case 'event':
        this.#onEvent?.(message.event)
        return
    }
  }

  #onWorkerError = (event: ErrorEvent) => {
    const message = `The import worker failed: ${event.message || 'it could not be loaded'}`
    this.#state = { ...this.#state, busy: false, error: { code: 'unknown', message } }
    for (const l of this.#listeners) l(this.#state, this.#state)
    for (const p of this.#pending.values()) p.reject(new Error(message))
    this.#pending.clear()
  }

  async #runBatch(message: Extract<FromWorker, { t: 'batch' }>) {
    const entry = this.#handlers.get(message.id)
    const reply = (m: ToWorker) => this.#endpoint.postMessage(m)
    if (!entry)
      return reply({
        t: 'feedback',
        id: message.id,
        batch: message.batch,
        ok: false,
        error: { name: 'Error', message: 'No submit handler' },
      })
    try {
      const { records, rows, index, total, batchId, customFields } = message.payload
      const value = await entry.handler({
        records: records as ImportRecord<T>[],
        rows: rows as ReviewRow[],
        index,
        total,
        batchId,
        customFields,
        signal: entry.controller.signal,
      })
      reply({ t: 'feedback', id: message.id, batch: message.batch, ok: true, value: value ?? undefined })
    } catch (error) {
      reply({ t: 'feedback', id: message.id, batch: message.batch, ok: false, error: serializeError(error) })
    }
  }

  #call<R>(method: Method, args: unknown[] = []): Promise<R> {
    if (this.#disposed) return Promise.reject(new Error('[openimport] This worker session was disposed'))
    const id = this.#next++
    return new Promise<R>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.#endpoint.postMessage({ t: 'call', id, method, args } satisfies ToWorker)
    })
  }

  // ── actions ───────────────────────────────────────────────────────────

  loadFile(input: Blob | File | SourceFile, name?: string): Promise<void> {
    // Send a plain { name, blob } source: File objects lose their name when cloned in some runtimes.
    return this.#call('loadFile', [toSourceFile(input, name)])
  }
  selectDataset = (id: string) => this.#call<void>('selectDataset', [id])
  setHeaderRow = (index: number) => this.#call<void>('setHeaderRow', [index])
  confirmHeader = () => this.#call<void>('confirmHeader')
  setMapping = (target: string, mapping: FieldMapping | null) => this.#call<void>('setMapping', [target, mapping])
  assign = (target: string, source: string | null) => this.#call<void>('assign', [target, source])
  clearMapping = () => this.#call<void>('clearMapping')
  addCustomField = (input: CustomFieldInput) => this.#call<CustomField>('addCustomField', [input])
  removeCustomField = (key: string) => this.#call<void>('removeCustomField', [key])
  suggestCustomField = (sourceKey: string) => this.#call<CustomFieldInput | null>('suggestCustomField', [sourceKey])
  autoMap = () => this.#call<void>('autoMap')
  previewField = (target: string, mapping?: FieldMapping, limit?: number) =>
    this.#call<FieldPreview[]>('previewField', [target, mapping, limit])
  distinctValues = (target: string, mapping?: FieldMapping, limit?: number) =>
    this.#call<(DistinctValue & { matched?: string })[]>('distinctValues', [target, mapping, limit])
  confirmMapping = (options?: { saveRecipe?: boolean | string }) => this.#call<void>('confirmMapping', [options])
  exportRecipe = (name?: string) => this.#call<Recipe>('exportRecipe', [name])

  countRows = (query: RowQuery = {}) => this.#call<number>('countRows', [query])
  getRows = (query: RowQuery, start: number, end: number) => this.#call<ReviewRow[]>('getRows', [query, start, end])
  rowIds = (query: RowQuery = {}) => this.#call<string[]>('rowIds', [query])
  findIssue = (query: RowQuery, from: { row: number; col: number } | null, fields: string[]) =>
    this.#call<{ row: number; col: number } | null>('findIssue', [query, from, fields])

  editCell = (rowId: string, field: string, value: unknown) => this.#call<void>('editCell', [rowId, field, value])
  replaceValues = (field: string, find: string, replace: string, options?: { rowIds?: string[]; match?: 'cell' | 'substring' }) =>
    this.#call<number>('replaceValues', [field, find, replace, options])
  deleteRows = (ids: string[]) => this.#call<void>('deleteRows', [ids])
  deleteInvalidRows = () => this.#call<number>('deleteInvalidRows')

  /**
   * Without a handler, the worker's importer `onSubmit` persists the records:
   * they never cross to the main thread. With a handler, each batch is sent
   * here and the handler's feedback goes back to the worker.
   */
  submit(handler?: SubmitHandler<T>): Promise<SubmitResult | undefined> {
    if (!handler) return this.#call('submit', [false])
    const id = this.#next
    this.#handlers.set(id, { handler, controller: new AbortController() })
    return this.#call('submit', [true])
  }
  reviewRejected = () => this.#call<void>('reviewRejected')

  back = () => this.#call<void>('back')
  reset = () => this.#call<void>('reset')
  abort = (): MaybePromise<void> => {
    for (const { controller } of this.#handlers.values()) controller.abort(new DOMException('Aborted', 'AbortError'))
    return this.#disposed ? undefined : this.#call<void>('abort')
  }
  clearError = () => this.#call<void>('clearError')

  /** Terminate the worker and reject anything still pending. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#endpoint.removeEventListener('message', this.#onMessage)
    this.#endpoint.terminate?.()
    for (const p of this.#pending.values()) p.reject(new Error('[openimport] Worker session disposed'))
    this.#pending.clear()
  }
}

/** Connect to a worker that called `exposeImporter()`. `importer` must come from the same module. */
export function createWorkerSession<T>(
  importer: Importer<T>,
  worker: Endpoint & { terminate?: () => void },
  options?: WorkerSessionOptions,
): RemoteSession<T> {
  return new RemoteSession(importer, worker, options)
}
