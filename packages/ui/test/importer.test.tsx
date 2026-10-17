import { createImporter, defineSchema, field, memoryRecipeStore } from '@openimport/core'
import { csv } from '@openimport/csv'
import { useImporterSession } from '@openimport/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Importer } from '../src'

const schema = defineSchema({
  id: 'people',
  fields: {
    firstName: field.string({ required: true }),
    email: field.email({ required: true, unique: true }),
    status: field.enum(['active', 'inactive']),
  },
})

function setup(onComplete = vi.fn()) {
  const importer = createImporter({ schema, plugins: [csv()], recipes: memoryRecipeStore() })
  let session!: ReturnType<typeof useImporterSession<any>>
  function Harness() {
    session = useImporterSession(importer)
    return <Importer importer={importer} session={session} title="Import people" onComplete={onComplete} />
  }
  render(<Harness />)
  return { session: () => session, onComplete }
}

afterEach(cleanup)

const CSV = 'Vorname;E-Mail;Status\nAda;ada@example.com;Active\nAlan;alan@example.com;inaktiv\n'

describe('<Importer>', () => {
  it('renders the upload step with formats and expected fields', () => {
    setup()
    expect(screen.getByText('Import people')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Browse files' })).toBeTruthy()
    expect(screen.getByText('CSV')).toBeTruthy()
    expect(screen.getByText('Download template')).toBeTruthy()
  })

  it('goes from upload to mapping to review to complete', async () => {
    const { session, onComplete } = setup()
    await act(() => session().loadFile(new File([CSV], 'people.csv', { type: 'text/csv' })))

    // Mapping step with auto-matched columns
    await screen.findByText('3 of 3 fields mapped')
    expect(screen.getByText('Vorname')).toBeTruthy()
    expect(screen.getByText('All required fields mapped')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByText('2 rows ready to import')

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }))
    await screen.findByText('Import complete')
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0]?.[0].records).toEqual([
      { firstName: 'Ada', email: 'ada@example.com', status: 'active' },
      { firstName: 'Alan', email: 'alan@example.com', status: 'inactive' },
    ])
  })

  it('blocks submission while rows have errors', async () => {
    const { session } = setup()
    await act(() => session().loadFile(new File(['Vorname;E-Mail\nAda;not-an-email\n'], 'p.csv')))
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }))
    await screen.findByText('Fix or remove 1 rows with errors to continue')
    expect((screen.getByRole('button', { name: 'Import 0 rows' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Remove 1 rows with errors/ }))
    await screen.findByText('No rows match your filters.')
  })

  it('shows required fields that are not mapped', async () => {
    const { session } = setup()
    await act(() => session().loadFile(new File(['Foo;Bar\n1;2\n'], 'p.csv')))
    await screen.findByText(/2 required field\(s\) missing: First name, Email/)
    expect((screen.getByRole('button', { name: /Continue/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('surfaces unsupported files as an alert', async () => {
    const { session } = setup()
    await act(() => session().loadFile(new File(['%PDF'], 'scan.pdf')))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't supported/)
  })

  it('is translatable', () => {
    const importer = createImporter({ schema, plugins: [csv()], recipes: false })
    render(<Importer importer={importer} locale="de" messages={{ upload: { browse: 'Datei wählen' } }} />)
    expect(screen.getByText('Daten importieren')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Datei wählen' })).toBeTruthy()
  })
})

describe('<Importer> submit contract', () => {
  it('persists in onSubmit, notifies in onComplete, and survives a failed attempt', async () => {
    const importer = createImporter({ schema, plugins: [csv()], recipes: false })
    let attempts = 0
    const onSubmit = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw new Error('network down')
    })
    const onComplete = vi.fn()
    let session!: ReturnType<typeof useImporterSession<any>>
    function Harness() {
      session = useImporterSession(importer)
      return <Importer importer={importer} session={session} onSubmit={onSubmit} onComplete={onComplete} />
    }
    render(<Harness />)
    await act(() => session.loadFile(new File([CSV], 'people.csv')))
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 rows' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/network down/)
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.queryByText('Import complete')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }))
    await screen.findByText('Import complete')
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0]?.[0].records).toHaveLength(2)
  })
})
