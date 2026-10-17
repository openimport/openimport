import { toSourceFile } from '@openimport/core'
import { checkPlugin } from '@openimport/core/testing'
import { expect, it } from 'vitest'
import { xlsx } from '../src'
import { makeXlsx } from './make-xlsx'

it('passes the format conformance checks', async () => {
  const bytes = makeXlsx({
    Contacts: [
      ['Name', 'Since'],
      ['Ada', new Date(Date.UTC(2024, 2, 15))],
      ['Alan', 42],
    ],
  })
  const sample = toSourceFile(new Blob([bytes as BlobPart]), 'contacts.xlsx')
  expect(await checkPlugin(xlsx(), { xlsx: sample })).toEqual([])
})
