import { sourceFromString } from '@openimport/core'
import { checkPlugin } from '@openimport/core/testing'
import { expect, it } from 'vitest'
import { csv } from '../src'

it('passes the format conformance checks', async () => {
  const sample = sourceFromString('Name;E-Mail\r\n"Müller, Anna";anna@x.io\r\nBob;bob@x.io\r\n', 'contacts.csv')
  expect(await checkPlugin(csv(), { csv: sample })).toEqual([])
})
