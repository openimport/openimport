import { describe, expect, it } from 'vitest'
import { applyRecipe, createRecipe, fieldsFromGrid, findRecipe } from '../src'

const fields = fieldsFromGrid([['Vorname', 'Mail', 'Ort']], 0)

describe('recipes', () => {
  it('round-trips a mapping through labels', () => {
    const recipe = createRecipe(
      { firstName: { sources: ['c0'], origin: 'user' }, email: { sources: ['c1'], transforms: [{ op: 'trim' }] } },
      fields,
      {
        name: 'CRM export',
      },
    )
    expect(recipe.mapping.firstName).toEqual({ sources: ['Vorname'] })
    const other = fieldsFromGrid([['Ort', 'mail', 'Extra', 'Vorname']], 0)
    expect(applyRecipe(recipe, other)).toEqual({
      firstName: { sources: ['c3'], origin: 'recipe' },
      email: { sources: ['c1'], transforms: [{ op: 'trim' }], origin: 'recipe' },
    })
  })

  it('finds the best-fitting recipe and ignores unrelated ones', () => {
    const a = createRecipe({ firstName: { sources: ['c0'] }, email: { sources: ['c1'] } }, fields)
    const b = createRecipe({ x: { sources: ['c0'] } }, fieldsFromGrid([['Totally', 'Different']], 0))
    expect(findRecipe([b, a], fields)?.id).toBe(a.id)
    expect(findRecipe([b], fields)).toBeUndefined()
  })
})
