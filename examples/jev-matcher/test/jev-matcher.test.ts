import { createImporter } from '@openimport/core'
import { csv } from '@openimport/csv'
import type { ChoiceCriteria, ChoiceQuestion } from '@typesafe-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildJevRequest, fieldsToAsk, type JevClient, jevMatcher, NONE } from '../src'
import { file, schema } from '../src/sample'

type Pick = { column: string; p: number }

/** A stand-in for Jev: answers each field's question from a table. */
function fakeJev(answers: Record<string, Pick>) {
  const calls: Parameters<JevClient['systemOne']>[0][] = []
  const client = {
    systemOne: vi.fn(async (request: Parameters<JevClient['systemOne']>[0]) => {
      calls.push(request)
      const out: Record<string, unknown> = {}
      for (const [name, q] of Object.entries(request.questions as Record<string, ChoiceQuestion<ChoiceCriteria>>)) {
        const key = (q.instructions as { target_field: { key: string } }).target_field.key
        const pick = answers[key] ?? { column: NONE, p: 0.9 }
        const probabilities = Object.fromEntries(Object.keys(q.criteria).map((c) => [c, c === pick.column ? pick.p : (1 - pick.p) / 8]))
        out[name] = { type: 'choice', choice: pick.column, confidence: pick.p, probabilities }
      }
      return { model: 'fake', answers: out, usage: { input_tokens: 0, output_tokens: 0 } }
    }),
  }
  return { client: client as unknown as JevClient, calls, systemOne: client.systemOne }
}

async function load(client: JevClient) {
  const session = createImporter({ schema, plugins: [csv(), jevMatcher({ client })], recipes: false }).createSession()
  await session.loadFile(file)
  const { mapping, sourceFields } = session.getState()
  const header = (k?: string) => sourceFields.find((f) => f.key === k)?.label
  return Object.fromEntries(schema.fields.map((f) => [f.key, header(mapping[f.key]?.sources[0])]))
}

const JEV = {
  email: { column: 'c2', p: 0.97 },
  customerNumber: { column: 'c5', p: 0.91 },
  status: { column: 'c6', p: 0.88 },
  signupDate: { column: 'c7', p: 0.86 },
}

describe('jev matcher', () => {
  it('asks only about the fields the fuzzy matcher is unsure of, with real columns as the options', async () => {
    const { client, calls } = fakeJev(JEV)
    await load(client)
    expect(calls).toHaveLength(1) // one request for all fields
    const questions = Object.values(calls[0]?.questions ?? {}) as ChoiceQuestion<ChoiceCriteria>[]
    const asked = questions.map((q) => (q.instructions as { target_field: { key: string } }).target_field.key)
    expect(asked).toEqual(['email', 'customerNumber', 'status', 'signupDate'])
    expect(Object.keys(questions[0]?.criteria ?? {})).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', NONE])
  })

  it("combines Jev's answers with the fuzzy matches", async () => {
    const { client } = fakeJev(JEV)
    expect(await load(client)).toEqual({
      firstName: 'Vorname',
      lastName: 'Nachname',
      email: 'Kontakt',
      phone: 'Mobil',
      company: 'Firma',
      customerNumber: 'KDNR',
      status: 'Spalte 7',
      signupDate: 'seit',
    })
  })

  it('drops "none" and unsure answers', async () => {
    const { client } = fakeJev({ ...JEV, customerNumber: { column: NONE, p: 0.95 }, status: { column: 'c6', p: 0.3 } })
    const mapping = await load(client)
    expect(mapping.customerNumber).toBeUndefined()
    expect(mapping.status).toBeUndefined()
    expect(mapping.email).toBe('Kontakt')
  })

  it('falls back to the fuzzy matches when Jev fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = { systemOne: vi.fn(async () => Promise.reject(new Error('rate limited'))) } as unknown as JevClient
    const mapping = await load(client)
    expect(mapping.firstName).toBe('Vorname')
    expect(mapping.email).toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("doesn't call Jev when the fuzzy matcher is sure of everything", async () => {
    const { client, systemOne } = fakeJev({})
    const session = createImporter({ schema, plugins: [csv(), jevMatcher({ client, skipAbove: 0 })], recipes: false }).createSession()
    await session.loadFile(file)
    expect(systemOne).not.toHaveBeenCalled()
  })

  it('can send headers without sample values', async () => {
    const session = createImporter({ schema, plugins: [csv()], recipes: false }).createSession()
    await session.loadFile(file)
    const ctx = { schema, sourceFields: session.getState().sourceFields, mapping: {}, transforms: [], signal: new AbortController().signal }
    const request = buildJevRequest(ctx, await fieldsToAsk(ctx), { maxSamples: 0 })
    expect(JSON.stringify(request.state)).not.toContain('Bestandskunde')
  })
})
