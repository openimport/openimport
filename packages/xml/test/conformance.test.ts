import { sourceFromString } from '@openimport/core'
import { checkPlugin } from '@openimport/core/testing'
import { expect, it } from 'vitest'
import { xml } from '../src'

it('passes the format conformance checks', async () => {
  const sample = sourceFromString(
    '<export><contact id="1"><name>Ada</name></contact><contact id="2"><name>Alan</name></contact></export>',
    'c.xml',
  )
  expect(await checkPlugin(xml(), { xml: sample })).toEqual([])
})
