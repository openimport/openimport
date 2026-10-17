import type { ImportEvent, Importer, SubmitBatch, SubmitFeedback } from '@openimport/core'
import { type Endpoint, type FromWorker, METHODS, portableState, QUERIES, reviveError, serializeError, type ToWorker } from './protocol'

/**
 * Run an importer's session in this worker and serve it to the main thread.
 * Create the importer in the worker module (functions can't be sent between
 * threads), usually by importing the same module the app uses:
 *
 *   // import.worker.ts
 *   import { exposeImporter } from '@openimport/worker'
 *   import { importer } from './importer'
 *   exposeImporter(importer)
 */
export function exposeImporter<T>(importer: Importer<T>, endpoint: Endpoint = globalThis as unknown as Endpoint): () => void {
  const session = importer.createSession()
  const post = (message: FromWorker) => endpoint.postMessage(message)

  // Forward lifecycle events (the importer's own listeners run here, in the worker).
  const emit = importer.emit
  importer.emit = (event: ImportEvent) => {
    emit(event)
    try {
      post({ t: 'event', event })
    } catch {
      // events with unclonable payloads are only observed in the worker
    }
  }

  // Coalesce state updates within a tick into one message.
  let scheduled = false
  const unsubscribe = session.subscribe(() => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      post({ t: 'state', state: portableState(session.getState()) })
    })
  })

  // Submissions bridged to a handler on the main thread.
  const feedback = new Map<string, { resolve: (v: SubmitFeedback | undefined) => void; reject: (e: Error) => void }>()
  const bridge =
    (id: number) =>
    (batch: SubmitBatch<T>): Promise<SubmitFeedback | undefined> =>
      new Promise((resolve, reject) => {
        feedback.set(`${id}:${batch.index}`, { resolve, reject })
        post({
          t: 'batch',
          id,
          batch: batch.index,
          payload: { records: batch.records, rows: batch.rows, index: batch.index, total: batch.total, batchId: batch.batchId },
        })
      })

  const onMessage = async (event: MessageEvent) => {
    const message = event.data as ToWorker
    if (!message || typeof message !== 'object') return
    if (message.t === 'feedback') {
      const key = `${message.id}:${message.batch}`
      const waiting = feedback.get(key)
      feedback.delete(key)
      if (message.ok) waiting?.resolve(message.value)
      else waiting?.reject(reviveError(message.error))
      return
    }
    if (message.t !== 'call') return
    const { id, method, args } = message
    try {
      if (!(METHODS as readonly string[]).includes(method)) throw new Error(`[openimport] "${method}" can't be called on a worker session`)
      const callArgs = method === 'submit' ? [args[0] === true ? bridge(id) : undefined] : args
      const fn = (session as unknown as Record<string, (...a: unknown[]) => unknown>)[method] as (...a: unknown[]) => unknown
      const value = await fn.apply(session, callArgs)
      post(QUERIES.has(method) ? { t: 'result', id, value } : { t: 'result', id, value, state: portableState(session.getState()) })
    } catch (error) {
      post({ t: 'error', id, error: serializeError(error) })
    }
  }

  endpoint.addEventListener('message', onMessage)
  endpoint.start?.()
  post({ t: 'hello', fields: importer.schema.fields.map((f) => f.key), formats: importer.formats.map((f) => f.id) })
  post({ t: 'state', state: portableState(session.getState()) })

  return () => {
    unsubscribe()
    endpoint.removeEventListener('message', onMessage)
    importer.emit = emit
  }
}
