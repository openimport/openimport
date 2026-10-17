import {
  builtinTransforms,
  createImporter,
  defineFormat,
  defineSchema,
  field,
  type MatchContext,
  type RawValue,
  type SourceField,
  sourceFromString,
} from '@openimport/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiMatcher, aiMatching, buildMatchPrompt, type GenerateRequest, parseMatchResponse } from '../src'

const schema = defineSchema({
  id: 'contacts',
  fields: {
    firstName: field.string({ required: true, aliases: ['given name'] }),
    lastName: field.string({ description: 'Family name' }),
    email: field.email({ required: true }),
    status: field.enum(['active', 'inactive']),
  },
})

const column = (key: string, label: string, samples: RawValue[], inferredType: SourceField['inferredType'] = 'string'): SourceField => ({
  key,
  label,
  index: Number(key.slice(1)),
  samples,
  inferredType,
  emptyRatio: 0,
})

const sourceFields = [
  column('c0', 'Full name', ['Ada Lovelace', 'Alan Turing']),
  column('c1', 'Kontakt', ['ada@example.com'], 'email'),
  column('c2', 'State', ['aktiv']),
]
const ctx = (mapping: MatchContext['mapping'] = {}): MatchContext => ({
  schema,
  sourceFields,
  mapping,
  transforms: [],
  signal: new AbortController().signal,
})

/** Minimal comma-separated grid format so the test doesn't depend on @openimport/csv. */
const tinyCsv = defineFormat({
  id: 'tiny',
  label: 'Tiny CSV',
  extensions: ['csv'],
  inspect: async () => ({ datasets: [{ id: 'main', label: 'main', layout: 'grid' }] }),
  read: async function* (file) {
    const text = await file.blob.text()
    yield text
      .trim()
      .split('\n')
      .map((line) => line.split(','))
  },
})

afterEach(() => vi.restoreAllMocks())

describe('buildMatchPrompt', () => {
  it('describes unmapped fields, columns and samples', () => {
    const { system, prompt } = buildMatchPrompt(ctx({ email: { sources: ['c1'] } }))
    expect(system).toMatch(/JSON/)
    expect(prompt).toContain('"key":"firstName"')
    expect(prompt).toContain('"aliases":["given name"]')
    expect(prompt).toContain('"description":"Family name"')
    expect(prompt).toContain('"options":["active","inactive"]')
    expect(prompt).not.toContain('"key":"email"')
    expect(prompt).toContain('"label":"Full name"')
    expect(prompt).toContain('Ada Lovelace')
    expect(prompt).toContain('split')
    expect(prompt).toContain('["c1"]') // already used columns
  })

  it('omits samples when includeSamples is false', () => {
    const { prompt } = buildMatchPrompt(ctx(), { includeSamples: false })
    expect(prompt).not.toContain('Ada Lovelace')
    expect(prompt).not.toContain('samples')
    expect(prompt).toContain('"label":"Kontakt"')
  })

  it('limits samples and omits transforms when disabled', () => {
    const { prompt } = buildMatchPrompt(ctx(), { maxSamples: 1, transforms: false })
    expect(prompt).toContain('Ada Lovelace')
    expect(prompt).not.toContain('Alan Turing')
    expect(prompt).not.toContain('"transforms"')
  })

  it('is deterministic', () => {
    expect(buildMatchPrompt(ctx())).toEqual(buildMatchPrompt(ctx()))
  })
})

describe('parseMatchResponse', () => {
  const answer = {
    matches: [
      { target: 'email', sources: ['c1'], confidence: 0.9, reason: 'contains emails' },
      { target: 'firstName', sources: ['c0'], confidence: 0.8, transforms: [{ op: 'split', separator: ' ', index: 0 }] },
    ],
  }

  it('parses fenced JSON', () => {
    const result = parseMatchResponse(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, ctx())
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ target: 'email', sources: ['c1'], confidence: 0.9, reason: 'AI: contains emails' })
    expect(result[1]?.transforms).toEqual([{ op: 'split', separator: ' ', index: 0 }])
  })

  it('parses JSON surrounded by prose, and bare arrays', () => {
    expect(parseMatchResponse(`Sure! Here you go:\n${JSON.stringify(answer)}\nHope that helps.`, ctx())).toHaveLength(2)
    expect(parseMatchResponse(JSON.stringify(answer.matches), ctx())).toHaveLength(2)
  })

  it('returns nothing for garbage', () => {
    expect(parseMatchResponse('no idea', ctx())).toEqual([])
    expect(parseMatchResponse('{"matches": "nope"}', ctx())).toEqual([])
  })

  it('drops invalid entries and clamps confidence', () => {
    const result = parseMatchResponse(
      JSON.stringify({
        matches: [
          { target: 'unknown', sources: ['c0'], confidence: 1 },
          { target: 'lastName', sources: ['c9'], confidence: 1 },
          { target: 'lastName', sources: [], confidence: 1 },
          'garbage',
          null,
          { target: 'email', sources: ['Kontakt'], confidence: 7 }, // label instead of key
          { target: 'status', sources: ['c2'], confidence: -3 },
        ],
      }),
      ctx(),
    )
    expect(result).toEqual([
      { target: 'email', sources: ['c1'], confidence: 1 },
      { target: 'status', sources: ['c2'], confidence: 0 },
    ])
  })

  it('skips targets that are already mapped', () => {
    const result = parseMatchResponse(JSON.stringify(answer), ctx({ email: { sources: ['c1'] } }))
    expect(result.map((r) => r.target)).toEqual(['firstName'])
  })

  it('dedupes by target, keeping the most confident', () => {
    const result = parseMatchResponse(
      JSON.stringify([
        { target: 'email', sources: ['c0'], confidence: 0.6 },
        { target: 'email', sources: ['c1'], confidence: 0.95 },
      ]),
      ctx(),
    )
    expect(result).toEqual([{ target: 'email', sources: ['c1'], confidence: 0.95 }])
  })

  it('whitelists transform ops and keeps only primitive params', () => {
    const [s] = parseMatchResponse(
      JSON.stringify([
        {
          target: 'firstName',
          sources: ['c0'],
          confidence: 0.8,
          transforms: [{ op: 'split', separator: ' ', index: 0, evil: { $where: 1 } }, { op: 'eval', code: 'process.exit()' }, 'trim'],
        },
      ]),
      ctx(),
    )
    expect(s?.transforms).toEqual([{ op: 'split', separator: ' ', index: 0 }])
    expect(s?.confidence).toBe(0.2) // 0.8 halved for each dropped step
  })

  it('drops transforms entirely when disabled, and applies minConfidence', () => {
    const result = parseMatchResponse(JSON.stringify(answer), ctx(), { transforms: false, minConfidence: 0.85 })
    expect(result).toEqual([{ target: 'email', sources: ['c1'], confidence: 0.9, reason: 'AI: contains emails' }])
  })
})

describe('aiMatcher', () => {
  it('calls generate with the prompt and returns parsed suggestions', async () => {
    const generate = vi.fn(async (_: GenerateRequest) =>
      JSON.stringify({ matches: [{ target: 'email', sources: ['c1'], confidence: 0.9 }] }),
    )
    const matcher = aiMatcher({ generate })
    expect(matcher).toMatchObject({ id: 'ai', priority: 10 })
    const result = await matcher.match(ctx())
    expect(result).toEqual([{ target: 'email', sources: ['c1'], confidence: 0.9 }])
    const request = generate.mock.calls[0]?.[0]
    expect(request?.prompt).toContain('"key":"firstName"')
    expect(request?.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not call the model when everything is mapped or the signal is aborted', async () => {
    const generate = vi.fn(async () => '[]')
    const all = Object.fromEntries(schema.fields.map((f) => [f.key, { sources: ['c0'] }]))
    expect(await aiMatcher({ generate }).match(ctx(all))).toEqual([])
    const controller = new AbortController()
    controller.abort()
    expect(await aiMatcher({ generate }).match({ ...ctx(), signal: controller.signal })).toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })

  it('returns [] and warns on errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await aiMatcher({
      generate: async () => {
        throw new Error('rate limited')
      },
    }).match(ctx())
    expect(result).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('times out even if generate ignores the signal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await aiMatcher({ generate: () => new Promise(() => {}), timeoutMs: 20 }).match(ctx())
    expect(result).toEqual([])
    expect(String(warn.mock.calls[0]?.[1])).toMatch(/timed out/)
  })

  it('aborts generate when the session aborts', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const pending = aiMatcher({
      generate: ({ signal }) => {
        seen = signal
        return new Promise(() => {})
      },
    }).match({ ...ctx(), signal: controller.signal })
    controller.abort()
    expect(await pending).toEqual([])
    expect(seen?.aborted).toBe(true)
  })
})

describe('aiMatching in a real session', () => {
  const csv = 'Full name,Email,Mail backup\nAda Lovelace,ada@example.com,ada@backup.org\nAlan Turing,alan@example.com,alan@backup.org\n'

  it('lets AI suggestions win over fuzzy ones and keeps transforms in the mapping', async () => {
    const generate = vi.fn(async (_: GenerateRequest) =>
      JSON.stringify({
        matches: [
          // fuzzy maps "Email" → email with confidence 1; AI prefers another column at the same confidence
          { target: 'email', sources: ['c2'], confidence: 1, reason: 'primary address' },
          { target: 'firstName', sources: ['c0'], confidence: 0.9, transforms: [{ op: 'split', separator: ' ', index: 0 }] },
        ],
      }),
    )
    const importer = createImporter({ schema, recipes: false, plugins: [{ name: 'tiny', formats: [tinyCsv] }, aiMatching({ generate })] })
    expect(importer.matchers.map((m) => m.id)).toEqual(['ai', 'fuzzy'])

    const session = importer.createSession()
    await session.loadFile(sourceFromString(csv, 'people.csv'))
    const state = session.getState()
    expect(state.error).toBeNull()
    expect(state.step).toBe('mapping')
    expect(generate).toHaveBeenCalledOnce()

    expect(state.mapping.email?.sources).toEqual(['c2'])
    expect(state.mapping.firstName).toMatchObject({
      sources: ['c0'],
      transforms: [{ op: 'split', separator: ' ', index: 0 }],
      origin: 'suggestion',
    })
    expect(session.previewField('firstName').map((p) => p.output)).toEqual(['Ada', 'Alan'])
    expect(state.suggestions.find((s) => s.target === 'email')?.reason).toBe('AI: primary address')
  })

  it('falls back to fuzzy matching when the model fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const importer = createImporter({
      schema,
      recipes: false,
      plugins: [{ name: 'tiny', formats: [tinyCsv] }, aiMatching({ generate: async () => 'not json at all' })],
    })
    const session = importer.createSession()
    await session.loadFile(sourceFromString(csv, 'people.csv'))
    expect(session.getState().mapping.email?.sources).toEqual(['c1'])
  })
})

describe('custom transforms', () => {
  it('offers registered plugin transforms to the model and accepts them', () => {
    const iban = { op: 'iban', label: 'Normalize IBAN', arity: 'one' as const, apply: (v: unknown) => v }
    const withCustom = { ...ctx(), transforms: [...builtinTransforms, iban] }
    expect(buildMatchPrompt(withCustom).prompt).toContain('- iban')
    const text = JSON.stringify({
      matches: [{ target: 'email', sources: ['c1'], confidence: 0.9, transforms: [{ op: 'iban' }, { op: 'split', index: 'x' }] }],
    })
    const [s] = parseMatchResponse(text, withCustom)
    // the custom op is kept; the step with an invalid param is dropped (and lowers confidence)
    expect(s?.transforms).toEqual([{ op: 'iban' }])
    expect(s?.confidence).toBe(0.45)
    // without the plugin registered, the op is unknown
    expect(parseMatchResponse(text, { ...ctx(), transforms: builtinTransforms })[0]?.transforms).toBeUndefined()
  })
})
