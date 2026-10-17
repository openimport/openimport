/**
 * The worker protocol over a real MessageChannel: one end runs the session
 * (as it would in a Web Worker), the other drives it like the UI does.
 */
import { createImporter, defineSchema, field, type ImportEvent, memoryRecipeStore, sourceFromString } from '@openimport/core'
import { csv } from '@openimport/csv'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AdaptiveSession, createWorkerSession, exposeImporter, type RemoteSession, workerSession } from '../src'

const schema = defineSchema({
  id: 'people',
  fields: {
    name: field.string({ required: true }),
    email: field.email({ required: true, unique: true }),
    status: field.enum(['active', 'inactive']),
  },
})

const makeImporter = (onSubmit?: (batch: { records: unknown[] }) => void) =>
  createImporter({ schema, plugins: [csv()], recipes: memoryRecipeStore(), batchSize: 2, ...(onSubmit ? { onSubmit } : {}) })

const CSV = 'Name;E-Mail;Status\nAda;ada@x.io;Active\n;bad;active\nAlan;ADA@x.io;inaktiv\nGrace;grace@x.io;active\n'

const open: (() => void)[] = []
afterEach(() => {
  for (const close of open.splice(0)) close()
})

/** A "worker" (port2) and a page-side session (port1). */
function connect(options: { workerSubmit?: (batch: { records: unknown[] }) => void; onEvent?: (e: ImportEvent) => void } = {}) {
  const { port1, port2 } = new MessageChannel()
  const stop = exposeImporter(makeImporter(options.workerSubmit), port2 as never)
  const session = createWorkerSession(makeImporter(), port1 as never, { ...(options.onEvent ? { onEvent: options.onEvent } : {}) })
  open.push(() => {
    stop()
    session.dispose()
    port1.close()
    port2.close()
  })
  return session as unknown as RemoteSession<Record<string, unknown>>
}

describe('worker session', () => {
  it('runs the full flow in the worker; rows stay there and are paged on request', async () => {
    const session = connect()
    await session.loadFile(sourceFromString(CSV, 'people.csv'))
    let state = session.getState()
    expect(state.step).toBe('mapping')
    expect(state.rowCount).toBe(4)
    expect(Object.keys(state.mapping).sort()).toEqual(['email', 'name', 'status'])
    expect((await session.previewField('name'))[0]?.output).toBe('Ada')

    await session.confirmMapping()
    state = session.getState()
    expect(state.step).toBe('review')
    expect(state.rows).toEqual([]) // never shipped
    expect(state.stats).toMatchObject({ total: 4, withErrors: 2 })
    expect(await session.countRows({ filter: 'errors' })).toBe(2)
    const [bad] = await session.getRows({ filter: 'errors' }, 0, 1)
    expect(bad?.issues.map((i) => i.code).sort()).toEqual(['invalid_email', 'required'])
    expect(await session.findIssue({}, null, ['name', 'email', 'status'])).toEqual({ row: 1, col: 0 })

    await session.editCell(bad!.id, 'name', 'Linus')
    await session.editCell(bad!.id, 'email', 'linus@x.io')
    const version = session.getState().rowsVersion
    expect(await session.deleteInvalidRows()).toBe(1) // Alan: duplicate of Ada
    expect(session.getState().rowsVersion).toBeGreaterThan(version)
    expect(session.getState().stats).toMatchObject({ total: 3, withErrors: 0 })
  })

  it('bridges submission to a handler on the main thread, with feedback and errors', async () => {
    const session = connect()
    await session.loadFile(sourceFromString('Name;E-Mail\nA;a@x.io\nB;b@x.io\nC;c@x.io\n', 'p.csv'))
    await session.confirmMapping()
    const seen: string[] = []
    let fail = true
    const handler = vi.fn(
      async ({ records, rows, batchId }: { records: Record<string, unknown>[]; rows: { id: string }[]; batchId: string }) => {
        expect(batchId).toMatch(/:/)
        if (fail && records[0]?.name === 'C') throw new Error('network down')
        seen.push(...records.map((r) => String(r.name)))
        return records[0]?.name === 'A' ? { rejected: [{ rowId: rows[0]!.id, code: 'server', message: 'exists' }] } : undefined
      },
    )
    expect(await session.submit(handler)).toBeUndefined()
    expect(session.getState().error?.message).toMatch(/2 of 3 rows were imported|1 of 2 rows were imported/)
    fail = false
    const result = await session.submit(handler)
    expect(seen).toEqual(['A', 'B', 'C'])
    expect(result).toMatchObject({ submitted: 2, rejected: [{ message: 'exists' }] })
    expect(session.getState().step).toBe('complete')
  })

  it('persists in the worker when no handler is passed (records never cross threads)', async () => {
    const workerSubmit = vi.fn()
    const session = connect({ workerSubmit })
    await session.loadFile(sourceFromString('Name;E-Mail\nA;a@x.io\nB;b@x.io\nC;c@x.io\n', 'p.csv'))
    await session.confirmMapping()
    expect(await session.submit()).toMatchObject({ submitted: 3 })
    expect(workerSubmit).toHaveBeenCalledTimes(2)
  })

  it('forwards errors and events, and rejects unknown methods', async () => {
    const events: string[] = []
    const session = connect({ onEvent: (e) => events.push(e.type) })
    await session.loadFile(sourceFromString('%PDF', 'scan.pdf'))
    expect(session.getState().error?.code).toBe('unsupported_file')
    await session.loadFile(sourceFromString('Name;E-Mail\nA;a@x.io\n', 'p.csv'))
    expect(events).toEqual(expect.arrayContaining(['error', 'file:loaded', 'rows:loaded', 'mapping:suggested']))
  })

  it('only serves allow-listed session methods', async () => {
    const { port1, port2 } = new MessageChannel()
    const stop = exposeImporter(makeImporter(), port2 as never)
    open.push(() => {
      stop()
      port1.close()
      port2.close()
    })
    const reply = new Promise<{ t: string; error?: { message: string } }>((resolve) => {
      port1.addEventListener('message', (e) => {
        if (e.data.t === 'error' || e.data.t === 'result') resolve(e.data)
      })
      port1.start()
    })
    port1.postMessage({ t: 'call', id: 1, method: 'constructor', args: [] })
    expect(await reply).toMatchObject({ t: 'error', error: { message: expect.stringMatching(/can't be called/) } })
  })

  it('rejects pending calls after dispose', async () => {
    const session = connect()
    session.dispose()
    await expect(session.countRows()).rejects.toThrow(/disposed/)
  })
})

describe('adaptive session', () => {
  it('keeps small files on the main thread and sends large ones to the worker', async () => {
    const workers: MessagePort[] = []
    const factory = workerSession({
      worker: () => {
        const { port1, port2 } = new MessageChannel()
        exposeImporter(makeImporter(), port2 as never)
        workers.push(port1, port2)
        return port1 as never
      },
      above: 200,
    })
    const session = factory(makeImporter()) as unknown as AdaptiveSession<Record<string, unknown>>
    open.push(() => {
      session.dispose()
      for (const p of workers) p.close()
    })
    const states: string[] = []
    session.subscribe((s) => states.push(`${session.runsIn}:${s.step}`))

    await session.loadFile(sourceFromString('Name;E-Mail\nA;a@x.io\n', 'small.csv'))
    expect(session.runsIn).toBe('main')
    expect(workers).toHaveLength(0)
    expect(session.getState().step).toBe('mapping')

    const big = `Name;E-Mail\n${Array.from({ length: 50 }, (_, i) => `P${i};p${i}@x.io`).join('\n')}\n`
    await session.loadFile(sourceFromString(big, 'big.csv'))
    expect(session.runsIn).toBe('worker')
    expect(session.getState().rowCount).toBe(50)
    await session.confirmMapping()
    expect(await session.countRows()).toBe(50)
    expect(states.some((s) => s.startsWith('worker:'))).toBe(true)
  })
})

describe('state identity', () => {
  it('keeps unchanged parts of the state as the same objects across messages', async () => {
    const session = connect()
    await session.loadFile(sourceFromString(CSV, 'people.csv'))
    const before = session.getState()
    // Queries don't touch state at all…
    await session.previewField('name')
    await session.countRows()
    expect(session.getState()).toBe(before)
    // …and an action that changes one part keeps the others.
    await session.assign('status', null)
    const after = session.getState()
    expect(after.mapping).not.toBe(before.mapping)
    expect(after.sourceFields).toBe(before.sourceFields)
    expect(after.file).toBe(before.file)
  })
})
