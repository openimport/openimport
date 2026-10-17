# @openimport/xml

XML format plugin for [OpenImport](../../README.md), built on [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser).

```ts
import { createImporter } from '@openimport/core'
import { xml } from '@openimport/xml'

const importer = createImporter({ schema, plugins: [xml()] })
```

## Record discovery

Repeated elements become datasets, addressed by their element path:

```xml
<customers>
  <customer id="1" status="active">
    <name>Ann</name>
    <address type="home"><city>Köln</city></address>
    <orders><order sku="A"/><order sku="B"/></orders>
  </customer>
  <customer id="2">…</customer>
</customers>
```

| Dataset                                 | Records         |
| --------------------------------------- | --------------- |
| `/customers/customer`                   | every customer  |
| `/customers/customer/orders/order`      | every order     |

A lone child of a plural container (`<customers>` with one `<customer>`) is recognised too.
Without any collection the root element is imported as one record.

## Element → record

- Attributes become properties without prefix (`id`, `status`); on a name clash with a child element they're kept as `@name`
- Child elements become (nested) properties — the core flattens them to `address.city`
- Text of an element that also has attributes is stored under `#text`
- CDATA is unwrapped, namespace prefixes are stripped (`keepNamespaces: true` to keep them)
- All values stay strings; your schema decides how they're coerced
- The `encoding` from the XML declaration (e.g. ISO-8859-1) and UTF-16 BOMs are honoured

## Options

| Option           | Default | Description                                     |
| ---------------- | ------- | ----------------------------------------------- |
| `keepNamespaces` | `false` | Keep `ns:` prefixes in element and attribute names |
| `textKey`        | `#text` | Key for text content next to attributes/children |
| `chunkSize`      | `1000`  | Records per yielded chunk                        |
