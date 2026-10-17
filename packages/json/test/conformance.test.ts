import { sourceFromString } from '@openimport/core'
import { checkPlugin } from '@openimport/core/testing'
import { expect, it } from 'vitest'
import { jsonFormats } from '../src'

it('passes the format conformance checks', async () => {
  const json = sourceFromString(JSON.stringify({ data: { customers: [{ name: 'Ada', tags: ['a'] }, { name: 'Alan' }] } }), 'c.json')
  const jsonl = sourceFromString('{"name":"Ada"}\n{"name":"Alan"}\n', 'c.jsonl')
  const plugin = jsonFormats()
  const ids = (plugin.formats ?? []).map((f) => f.id)
  const samples = Object.fromEntries(ids.map((id) => [id, id.includes('l') && id !== 'json' ? jsonl : json]))
  expect(await checkPlugin(plugin, samples)).toEqual([])
})
