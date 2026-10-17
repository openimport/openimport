import { createImporter, defineSchema, field, type ImportPlugin, memoryRecipeStore, sourceFromString } from '@openimport/core'
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ImporterProvider, useImporterSession, useImportState, useMapping, useReview, useSession } from '../src'

const lines: ImportPlugin = {
  name: 'lines',
  formats: [
    {
      id: 'lines',
      label: 'Lines',
      extensions: ['csv'],
      inspect: async () => ({ datasets: [{ id: 'd', label: 'd', layout: 'grid' }] }),
      async *read(file) {
        yield (await file.blob.text())
          .trim()
          .split('\n')
          .map((l) => l.split(','))
      },
    },
  ],
}

const schema = defineSchema({
  fields: { name: field.string({ required: true }), email: field.email({ required: true }), age: field.integer() },
})
const makeImporter = () => createImporter({ schema, plugins: [lines], recipes: memoryRecipeStore() })

describe('@openimport/react', () => {
  it('throws a helpful error outside a provider', () => {
    expect(() => renderHook(() => useSession())).toThrow(/ImporterProvider/)
  })

  it('re-renders selector consumers only when the selection changes', async () => {
    const importer = makeImporter()
    const session = importer.createSession()
    let renders = 0
    function Step() {
      renders++
      return <span data-testid="step">{useImportState((s) => s.step)}</span>
    }
    render(
      <ImporterProvider session={session}>
        <Step />
      </ImporterProvider>,
    )
    expect(screen.getByTestId('step').textContent).toBe('upload')
    const before = renders
    await act(() => session.loadFile(sourceFromString('name,email,age\nAda,ada@x.io,36\n', 'a.csv')))
    expect(screen.getByTestId('step').textContent).toBe('mapping')
    // Many state updates happened during loading, but the step changed only once.
    expect(renders - before).toBe(1)
  })

  it('derives mapping and review state', async () => {
    const importer = makeImporter()
    const wrapper = ({ children }: { children: ReactNode }) => <ImporterProvider importer={importer}>{children}</ImporterProvider>
    const { result } = renderHook(() => ({ session: useSession(), mapping: useMapping(), review: useReview({ filter: 'errors' }) }), {
      wrapper,
    })
    await act(() => result.current.session.loadFile(sourceFromString('Person,Mail\nAda,ada@x.io\nAlan,nope\n', 'a.csv')))
    expect(result.current.mapping.mappedCount).toBe(1)
    expect(result.current.mapping.requiredMissing.map((f) => f.key)).toEqual(['name'])
    expect(result.current.mapping.canConfirm).toBe(false)
    act(() => result.current.session.assign('name', 'c0'))
    expect(result.current.mapping.canConfirm).toBe(true)
    expect(result.current.mapping.unusedSources).toEqual([])
    await act(() => result.current.session.confirmMapping())
    expect(result.current.review.total).toBe(1)
    expect(result.current.review.getRow(0)?.values.email).toBeUndefined()
    expect(result.current.review.stats.withErrors).toBe(1)
    expect(result.current.review.canSubmit).toBe(false)
  })

  it('useImporterSession keeps one session per importer', () => {
    const importer = makeImporter()
    const { result, rerender } = renderHook(() => useImporterSession(importer))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
