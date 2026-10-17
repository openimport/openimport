/**
 * Edits update uniqueness and stats incrementally (LiveRows). These tests check
 * that the result is always identical to recomputing everything from scratch.
 */
import { describe, expect, it } from 'vitest'
import { createImporter, defineSchema, field, type ImportSession, type ReviewRow, sourceFromString } from '../src'
import { applyUniqueness, computeStats } from '../src/validate'
import { testFormats } from './helpers'

const fields = {
  name: field.string({ required: true }),
  email: field.email({ unique: true }),
  code: field.string({ unique: true }),
  amount: field.number({ min: 0 }),
}
const schema = defineSchema({ fields })
const withBatch = defineSchema({
  fields,
  validateBatch: async (rows) =>
    rows.filter((r) => r.values.code === 'K2').map((r) => ({ rowId: r.id, field: 'code', code: 'taken', message: 'Taken' })),
})

// A small deterministic PRNG, so a failure can be replayed.
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

const EMAILS = ['a@x.io', 'b@x.io', 'B@X.io ', 'c@x.io', 'not-an-email', '']
const CODES = ['K1', 'K2', 'k1', 'K3', '']
const NAMES = ['Ada', 'Alan', '']
const AMOUNTS = ['1', '-5', 'abc', '']

async function load(rows: number, rand: () => number, s: typeof schema = schema) {
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)] as T
  const lines = ['name,email,code,amount']
  for (let i = 0; i < rows; i++) lines.push([pick(NAMES), pick(EMAILS), pick(CODES), pick(AMOUNTS)].join(','))
  return open(lines, s)
}

async function open(lines: string[], s: typeof schema = schema) {
  // Random data can look like a header, so pin the header to the first line.
  const session = createImporter({ schema: s, plugins: [testFormats], recipes: false, headerSelection: 'always' }).createSession()
  await session.loadFile(sourceFromString(lines.join('\n'), 'a.csv'))
  session.setHeaderRow(0)
  await session.confirmHeader()
  await session.confirmMapping()
  // (a line of only separators is blank and skipped)
  expect(session.getState().rows).toHaveLength(lines.slice(1).filter((l) => l.replaceAll(',', '')).length)
  return session
}

/** What a full recompute over the current rows produces. */
function expectConsistent(session: ImportSession<any>) {
  const { rows, stats } = session.getState()
  const stripped: ReviewRow[] = rows.map((r) => ({ ...r, issues: r.issues.filter((i) => i.code !== 'duplicate') }))
  const expected = applyUniqueness(stripped, session.schema)
  // Same issues per row; their order within a row carries no meaning.
  const sorted = (list: ReviewRow[]) => list.map((r) => r.issues.map((i) => JSON.stringify(i)).sort())
  expect(sorted(rows)).toEqual(sorted(expected))
  expect(stats).toEqual(computeStats(rows))
}

describe('incremental edits', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`match a full recompute after random edits (seed ${seed})`, async () => {
      const rand = random(seed)
      const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)] as T
      const session = await load(40, rand)
      expectConsistent(session)
      for (let step = 0; step < 150; step++) {
        const rows = session.getState().rows
        if (!rows.length) break
        const id = (pick(rows) as ReviewRow).id
        const r = rand()
        if (r < 0.6) {
          const f = pick(['name', 'email', 'code', 'amount'] as const)
          session.editCell(id, f, pick({ name: NAMES, email: EMAILS, code: CODES, amount: AMOUNTS }[f]))
        } else if (r < 0.8) {
          // several cells at once, including the same row twice
          session.editCells([
            { rowId: id, field: 'email', value: pick(EMAILS) },
            { rowId: (pick(rows) as ReviewRow).id, field: 'code', value: pick(CODES) },
            { rowId: id, field: 'code', value: pick(CODES) },
          ])
        } else if (r < 0.9) {
          session.replaceValues('email', pick(EMAILS), pick(EMAILS))
        } else {
          session.deleteRows([id]) // a structural change: the index is rebuilt
        }
        expectConsistent(session)
      }
    })
  }

  it('keep row identity for rows an edit does not affect', async () => {
    // rows 1 and 3 share an email; row 2 is unique
    const session = await open(['name,email,code,amount', 'Ada,a@x.io,K1,1', 'Alan,b@x.io,K2,2', 'Grace,a@x.io,K3,3'])
    const before = session.getState().rows
    const target = before[1] as ReviewRow
    session.editCell(target.id, 'name', 'Linus')
    const after = session.getState().rows
    expect(after).not.toBe(before)
    const changed = after.filter((r, i) => r !== before[i]).map((r) => r.id)
    expect(changed).toEqual([target.id])

    // Making row 2 a duplicate as well updates the other two rows' messages too
    session.editCell(target.id, 'email', 'A@x.io')
    const third = session.getState().rows
    expect(third.filter((r, i) => r !== after[i]).map((r) => r.sourceIndex)).toEqual([2, 3]) // line 4's "Duplicate of row 2" doesn't change
    expect(third[0]?.issues.find((i) => i.code === 'duplicate')?.message).toBe('Also used in row 3, 4')
    expectConsistent(session)
  })

  it('stay consistent when async batch validation settles after edits', async () => {
    const rand = random(7)
    const session = await load(25, rand, withBatch)
    for (let step = 0; step < 30; step++) {
      const rows = session.getState().rows
      session.editCell((rows[Math.floor(rand() * rows.length)] as ReviewRow).id, 'code', CODES[step % CODES.length])
      expect(session.getState().busy).toBe('validating')
      await new Promise((r) => setTimeout(r, 0))
      expectConsistent(session)
    }
    expect(session.getState().busy).toBe(false)
  })
})
