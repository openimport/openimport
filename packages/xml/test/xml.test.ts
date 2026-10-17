import { createImporter, defineSchema, field, type SourceFile, sourceFromString, toSourceFile } from '@openimport/core'
import { describe, expect, it } from 'vitest'
import { xml, xmlFormat } from '../src'

const signal = new AbortController().signal

async function read(file: SourceFile, id?: string, options = {}) {
  const format = xmlFormat(options)
  const { datasets } = await format.inspect(file, { signal })
  const dataset = id ? datasets.find((d) => d.id === id)! : datasets[0]!
  const rows: Record<string, unknown>[] = []
  for await (const chunk of format.read(file, { dataset, signal })) rows.push(...(chunk as Record<string, unknown>[]))
  return { rows, datasets }
}

const doc = `<?xml version="1.0" encoding="UTF-8"?>
<export xmlns:c="urn:crm" generated="2024-01-01">
  <c:customers>
    <c:customer id="1" status="active">
      <c:name>Ann</c:name>
      <c:email>ann@example.com</c:email>
      <c:address type="home"><c:city>Köln</c:city><c:zip>50667</c:zip></c:address>
      <c:note><![CDATA[Likes <b>bold</b> & coffee]]></c:note>
      <c:price currency="EUR">12.50</c:price>
      <c:orders><c:order sku="A"/><c:order sku="B"/></c:orders>
    </c:customer>
    <c:customer id="2">
      <c:name>Bob</c:name>
      <c:email/>
      <c:orders><c:order sku="C"/></c:orders>
    </c:customer>
  </c:customers>
</export>`

describe('xml format', () => {
  it('discovers repeated elements (and lone children of plural containers)', async () => {
    const { datasets } = await xmlFormat().inspect(sourceFromString(doc, 'crm.xml'), { signal })
    expect(datasets.map((d) => [d.id, d.label, d.rowCount])).toEqual([
      ['/export/customers/customer', 'customer', 2],
      ['/export/customers/customer/orders/order', 'order', 3],
    ])
    expect(datasets[0]!.layout).toBe('records')
  })

  it('converts elements to records: attributes, nested elements, CDATA, text with attributes', async () => {
    const { rows } = await read(sourceFromString(doc, 'crm.xml'))
    expect(rows[0]).toEqual({
      id: '1',
      status: 'active',
      name: 'Ann',
      email: 'ann@example.com',
      address: { type: 'home', city: 'Köln', zip: '50667' },
      note: 'Likes <b>bold</b> & coffee',
      price: { currency: 'EUR', '#text': '12.50' },
      orders: { order: [{ sku: 'A' }, { sku: 'B' }] },
    })
    expect(rows[1]).toMatchObject({ id: '2', name: 'Bob', email: '' })
  })

  it('fans out nested collections across parents', async () => {
    const { rows } = await read(sourceFromString(doc, 'crm.xml'), '/export/customers/customer/orders/order')
    expect(rows).toEqual([{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }])
  })

  it('keeps namespace prefixes on request', async () => {
    const { datasets } = await read(sourceFromString(doc, 'crm.xml'), undefined, { keepNamespaces: true })
    expect(datasets[0]!.id).toBe('/export/c:customers/c:customer')
  })

  it('keeps values as strings (no number coercion)', async () => {
    const { rows } = await read(sourceFromString('<r><i><n>007</n></i><i><n>1e3</n></i></r>', 'n.xml'))
    expect(rows).toEqual([{ n: '007' }, { n: '1e3' }])
  })

  it('prefixes attributes that collide with child elements', async () => {
    const { rows } = await read(sourceFromString('<l><e name="attr"><name>child</name></e><e/></l>', 'c.xml'))
    expect(rows).toEqual([{ '@name': 'attr', name: 'child' }, {}])
  })

  it('treats repeated text-only elements as a value list, not records', async () => {
    const { rows, datasets } = await read(sourceFromString('<person><tag>a</tag><tag>b</tag></person>', 't.xml'))
    expect(datasets.map((d) => d.id)).toEqual(['/person'])
    expect(rows).toEqual([{ tag: ['a', 'b'] }])
  })

  it('treats a document without collections as a single record', async () => {
    const { rows, datasets } = await read(sourceFromString('<settings><a>1</a><b x="y">2</b></settings>', 's.xml'))
    expect(datasets[0]!.id).toBe('/settings')
    expect(rows).toEqual([{ a: '1', b: { x: 'y', '#text': '2' } }])
  })

  it('decodes the encoding from the XML declaration', async () => {
    const head = new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><l><e><n>')
    const tail = new TextEncoder().encode('</n></e><e><n>x</n></e></l>')
    const bytes = new Uint8Array([...head, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, ...tail]) // Müller in latin1
    const { rows } = await read(toSourceFile(new Blob([bytes]), 'latin.xml'))
    expect(rows[0]).toEqual({ n: 'Müller' })
  })

  it('reports invalid XML with a line number', async () => {
    await expect(xmlFormat().inspect(sourceFromString('<a>\n<b></a>', 'bad.xml'), { signal })).rejects.toMatchObject({
      code: 'parse_failed',
      message: expect.stringMatching(/line \d+/),
    })
  })
})

describe('xml with an import session', () => {
  it('imports customers with nested paths', async () => {
    const importer = createImporter({
      schema: defineSchema({
        fields: {
          name: field.string({ required: true }),
          email: field.email(),
          'address.city': field.string(),
          status: field.enum(['active', 'inactive']),
        },
      }),
      plugins: [xml()],
      recipes: false,
    })
    const session = importer.createSession()
    await session.loadFile(sourceFromString(doc, 'crm.xml'))
    expect(session.getState().step).toBe('dataset')
    await session.selectDataset('/export/customers/customer')
    session.setMapping('address.city', { sources: ['address.city'] })
    await session.confirmMapping({ saveRecipe: false })
    expect(await session.getRecords()).toEqual([
      { name: 'Ann', email: 'ann@example.com', address: { city: 'Köln' }, status: 'active' },
      { name: 'Bob' },
    ])
  })
})
