import { type Importer, type SessionLike, type SessionState, type SourceFile, toSourceFile } from '@openimport/core'
import type { Endpoint } from './protocol'
import { RemoteSession, type WorkerSessionOptions } from './remote'

export interface WorkerSessionFactoryOptions extends WorkerSessionOptions {
  /** Creates the worker, e.g. `() => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })`. */
  worker: () => Endpoint & { terminate?: () => void }
  /**
   * Only use the worker for files larger than this many bytes; smaller files
   * stay on the main thread. Omit to always use the worker.
   */
  above?: number
}

type Listener = (state: SessionState, previous: SessionState) => void

/**
 * Picks the main thread or the worker per file, by size. Behaves like a
 * single session to the UI: subscribers follow it when it switches.
 */
export class AdaptiveSession<T = Record<string, unknown>> implements SessionLike<T> {
  readonly importer: Importer<T>
  readonly id = `adaptive_${Math.random().toString(36).slice(2, 10)}`
  #options: WorkerSessionFactoryOptions & { above: number }
  #local: SessionLike<T>
  #remote: RemoteSession<T> | null = null
  #current: SessionLike<T>
  #listeners = new Set<Listener>()
  #unsubscribe: () => void

  constructor(importer: Importer<T>, options: WorkerSessionFactoryOptions & { above: number }) {
    this.importer = importer
    this.#options = options
    this.#local = importer.createSession()
    this.#current = this.#local
    this.#unsubscribe = this.#follow(this.#current)
  }

  get schema() {
    return this.#current.schema
  }

  /** Where the current import runs. */
  get runsIn(): 'main' | 'worker' {
    return this.#current === this.#local ? 'main' : 'worker'
  }

  #follow(session: SessionLike<T>) {
    return session.subscribe((state, previous) => {
      for (const l of this.#listeners) l(state, previous)
    })
  }

  #switchTo(next: SessionLike<T>) {
    if (next === this.#current) return
    const previous = this.#current.getState()
    void this.#current.reset()
    this.#unsubscribe()
    this.#current = next
    this.#unsubscribe = this.#follow(next)
    const state = next.getState()
    for (const l of this.#listeners) l(state, previous)
  }

  getState = (): SessionState => this.#current.getState()
  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  loadFile(input: Blob | File | SourceFile, name?: string): Promise<void> {
    const file = toSourceFile(input, name)
    if (file.size > this.#options.above) {
      this.#remote ??= new RemoteSession(this.importer, this.#options.worker(), this.#options)
      this.#switchTo(this.#remote)
    } else this.#switchTo(this.#local)
    return this.#current.loadFile(file)
  }

  selectDataset: SessionLike<T>['selectDataset'] = (...a) => this.#current.selectDataset(...a)
  setHeaderRow: SessionLike<T>['setHeaderRow'] = (...a) => this.#current.setHeaderRow(...a)
  confirmHeader: SessionLike<T>['confirmHeader'] = () => this.#current.confirmHeader()
  setMapping: SessionLike<T>['setMapping'] = (...a) => this.#current.setMapping(...a)
  assign: SessionLike<T>['assign'] = (...a) => this.#current.assign(...a)
  clearMapping: SessionLike<T>['clearMapping'] = () => this.#current.clearMapping()
  addCustomField: SessionLike<T>['addCustomField'] = (input) => this.#current.addCustomField(input)
  removeCustomField: SessionLike<T>['removeCustomField'] = (key) => this.#current.removeCustomField(key)
  suggestCustomField: SessionLike<T>['suggestCustomField'] = (key) => this.#current.suggestCustomField(key)
  autoMap: SessionLike<T>['autoMap'] = () => this.#current.autoMap()
  previewField: SessionLike<T>['previewField'] = (...a) => this.#current.previewField(...a)
  distinctValues: SessionLike<T>['distinctValues'] = (...a) => this.#current.distinctValues(...a)
  confirmMapping: SessionLike<T>['confirmMapping'] = (...a) => this.#current.confirmMapping(...a)
  exportRecipe: SessionLike<T>['exportRecipe'] = (...a) => this.#current.exportRecipe(...a)
  countRows: SessionLike<T>['countRows'] = (...a) => this.#current.countRows(...a)
  getRows: SessionLike<T>['getRows'] = (...a) => this.#current.getRows(...a)
  rowIds: SessionLike<T>['rowIds'] = (...a) => this.#current.rowIds(...a)
  findIssue: SessionLike<T>['findIssue'] = (...a) => this.#current.findIssue(...a)
  editCell: SessionLike<T>['editCell'] = (...a) => this.#current.editCell(...a)
  replaceValues: SessionLike<T>['replaceValues'] = (...a) => this.#current.replaceValues(...a)
  deleteRows: SessionLike<T>['deleteRows'] = (...a) => this.#current.deleteRows(...a)
  deleteInvalidRows: SessionLike<T>['deleteInvalidRows'] = () => this.#current.deleteInvalidRows()
  submit: SessionLike<T>['submit'] = (...a) => this.#current.submit(...a)
  reviewRejected: SessionLike<T>['reviewRejected'] = () => this.#current.reviewRejected()
  back: SessionLike<T>['back'] = () => this.#current.back()
  reset: SessionLike<T>['reset'] = () => this.#current.reset()
  abort: SessionLike<T>['abort'] = () => this.#current.abort()
  clearError: SessionLike<T>['clearError'] = () => this.#current.clearError()

  dispose(): void {
    this.#unsubscribe()
    this.#local.dispose?.()
    this.#remote?.dispose()
  }
}

/**
 * A session factory for `useImporterSession(importer, factory)`:
 *
 *   const session = useImporterSession(importer, workerSession({
 *     worker: () => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }),
 *     above: 20 * 1024 * 1024, // optional: only files over 20 MB
 *   }))
 */
export function workerSession(options: WorkerSessionFactoryOptions) {
  return <T>(importer: Importer<T>): SessionLike<T> =>
    options.above === undefined
      ? new RemoteSession(importer, options.worker(), options)
      : new AdaptiveSession(importer, { ...options, above: options.above })
}
