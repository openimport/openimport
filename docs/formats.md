---
title: Formats
description: The format plugins that ship with OpenImport.
---

Install only the formats you accept.

| Package | Files | Streaming | Dependencies |
|---|---|---|---|
| `@openimport/csv` | `.csv`, `.tsv`, `.txt` | yes | none |
| `@openimport/json` | `.jsonl`, `.ndjson` | yes | none |
| `@openimport/json` | `.json` | no, parsed whole | none |
| `@openimport/xml` | `.xml` | no, parsed whole | `fast-xml-parser` |
| `@openimport/xlsx` | `.xlsx`, `.xlsm` | no, parsed whole | `read-excel-file` |

All of them support cancellation and pass the [conformance checks](./plugins.md#testing-a-plugin).

---

## CSV

```ts
csv({ delimiter: ';', encoding: 'windows-1252' })  // both detected when omitted
```

Detects UTF-8 and UTF-16 and falls back to Windows-1252, which is common for Excel exports. Detects `,`, `;`, tab and `|`.

---

## Excel

```ts
xlsx()
```

One dataset per non-empty sheet; the user picks one. Dates arrive as dates. Old `.xls` files get a clear "save as .xlsx" message.

---

## JSON

```ts
jsonFormats()  // json() and jsonl() together
```

Finds every array of objects in the document, such as `$.data.customers[*]`. JSON Lines are streamed line by line.

---

## XML

```ts
xml()
```

Repeated elements become records, e.g. `/export/customers/customer`. Attributes become fields, namespaces are stripped and CDATA is unwrapped.
