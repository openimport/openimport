/** The ready-made UI driving a session whose rows live in a "worker" (a MessageChannel here). */
import { createImporter, defineSchema, field, memoryRecipeStore, sourceFromString } from '@openimport/core'
import { csv } from '@openimport/csv'
import { createWorkerSession, exposeImporter } from '@openimport/worker'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Importer } from '../src'

const schema = defineSchema({ fields: { name: field.string({ required: true }), email: field.email({ required: true }) } })
const make = () => createImporter({ schema, plugins: [csv()], recipes: memoryRecipeStore() })

afterEach(cleanup)

/**
 * Two endpoints that deliver messages asynchronously, like a worker. (happy-dom's
 * Blob can't go through Node's native MessageChannel; real cloning is covered
 * by the @openimport/worker tests.)
 */
function pair() {
  const make = () => {
    const listeners = new Set<(e: MessageEvent) => void>()
    return {
      listeners,
      addEventListener: (type: string, l: (e: MessageEvent) => void) => {
        if (type === 'message') listeners.add(l)
      },
      removeEventListener: (type: string, l: (e: MessageEvent) => void) => {
        if (type === 'message') listeners.delete(l)
      },
      postMessage: (_: unknown) => {},
    }
  }
  const a = make()
  const b = make()
  a.postMessage = (data) =>
    setTimeout(() => {
      for (const l of b.listeners) l({ data } as MessageEvent)
    })
  b.postMessage = (data) =>
    setTimeout(() => {
      for (const l of a.listeners) l({ data } as MessageEvent)
    })
  return [a, b] as const
}

it('works end to end with a worker session', async () => {
  const [page, worker] = pair()
  exposeImporter(make(), worker)
  const session = createWorkerSession(make(), page)
  const onSubmit = vi.fn()
  const onComplete = vi.fn()
  render(<Importer importer={make()} session={session} onSubmit={onSubmit} onComplete={onComplete} />)

  const rows = Array.from({ length: 30 }, (_, i) => (i === 7 ? ';broken' : `P${i};p${i}@x.io`))
  await act(() => session.loadFile(sourceFromString(`Name;E-Mail\n${rows.join('\n')}\n`, 'people.csv')))

  // Mapping previews come back asynchronously from the worker
  await screen.findByText('2 of 2 fields mapped')
  await screen.findByText('P0')

  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByText('Fix or remove 1 rows with errors to continue')

  // The row count comes from the worker (happy-dom has no layout, so the virtual grid itself renders no rows here)
  await screen.findByText(/^30 rows/)

  // "Next error" asks the worker where it is, then loads that row's page to show its issue
  fireEvent.click(screen.getByRole('button', { name: /Next error/ }))
  await screen.findByText('Name is required')
  expect(screen.getByText(/Row 9/)).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /Remove 1 rows with errors/ }))
  await screen.findByText('29 rows ready to import')
  fireEvent.click(screen.getByRole('button', { name: 'Import 29 rows' }))
  await screen.findByText('Import complete')
  expect(onSubmit).toHaveBeenCalled()
  expect(onComplete.mock.calls[0]?.[0].records).toHaveLength(29)
})
