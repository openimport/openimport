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
    email: field.email({ required: true }),
  },
})

const CSV = 'Vorname;E-Mail;Tier\nAda;ada@example.com;gold\nAlan;alan@example.com;silver\n'

function setup(customFields: boolean) {
  const onSubmit = vi.fn()
  const importer = createImporter({ schema, plugins: [csv()], recipes: memoryRecipeStore(), customFields })
  let session!: ReturnType<typeof useImporterSession<any>>
  function Harness() {
    session = useImporterSession(importer)
    return <Importer importer={importer} session={session} title="Import people" onSubmit={onSubmit} />
  }
  render(<Harness />)
  return { session: () => session, onSubmit }
}

afterEach(cleanup)

describe('custom fields in <Importer>', () => {
  it('adds an unused column as a new field and imports it in $custom', async () => {
    const { session, onSubmit } = setup(true)
    await act(() => session().loadFile(new File([CSV], 'people.csv', { type: 'text/csv' })))
    await screen.findByText('2 of 2 fields mapped')
    expect(screen.getByText('Click one to import it as a new field.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add as field: Tier' }))
    await screen.findByText('New field from “Tier”')
    const name = (await screen.findByRole('textbox', { name: 'Name' })) as HTMLInputElement
    expect(name.value).toBe('Tier')
    fireEvent.change(name, { target: { value: 'Loyalty tier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))

    await screen.findByText('3 of 3 fields mapped')
    expect(screen.getByText('Loyalty tier')).toBeTruthy()
    expect(screen.getByText('New field')).toBeTruthy()
    expect(screen.getByText('Every column is used.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 rows' }))
    await screen.findByText('Import complete')
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const batch = onSubmit.mock.calls[0]?.[0]
    expect(batch.records).toEqual([
      { firstName: 'Ada', email: 'ada@example.com', $custom: { loyalty_tier: 'gold' } },
      { firstName: 'Alan', email: 'alan@example.com', $custom: { loyalty_tier: 'silver' } },
    ])
    expect(batch.customFields).toEqual([{ key: 'loyalty_tier', label: 'Loyalty tier', type: 'string' }])
  })

  it('shows the error when a name is taken, and can remove a field', async () => {
    const { session } = setup(true)
    await act(() => session().loadFile(new File([CSV], 'people.csv', { type: 'text/csv' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Add as field: Tier' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/)

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Tier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await screen.findByText('3 of 3 fields mapped')
    fireEvent.click(screen.getByRole('button', { name: 'Remove this field' }))
    await screen.findByText('2 of 2 fields mapped')
    expect(screen.getByRole('button', { name: 'Add as field: Tier' })).toBeTruthy()
  })

  it('keeps unused columns as plain chips when custom fields are off', async () => {
    const { session } = setup(false)
    await act(() => session().loadFile(new File([CSV], 'people.csv', { type: 'text/csv' })))
    await screen.findByText('2 of 2 fields mapped')
    expect(screen.queryByRole('button', { name: 'Add as field: Tier' })).toBeNull()
    expect(screen.getByText('Tier')).toBeTruthy()
  })
})
