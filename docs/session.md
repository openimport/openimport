---
title: Session API
description: Drive an import from any UI, a test or a script.
---

A session is one import. It holds a single state object and exposes actions. The UI and the React hooks use nothing else.

```ts
const session = importer.createSession()
const stop = session.subscribe((state, previous) => render(state))
```

---

## Steps

```
upload → dataset? → header? → mapping → review → submitting → complete
```

`dataset` appears only for files with several tables, such as workbooks with several sheets. `header` appears when the header isn't the first row; set `headerSelection` to change that.

---

## Actions

| Action | |
|---|---|
| `loadFile(file)` | read a `File`, `Blob` or `sourceFromString(text, name)` |
| `selectDataset(id)` | pick a sheet or JSON collection |
| `setHeaderRow(i)`, `confirmHeader()` | choose the header row |
| `assign(field, column)` | map one column to one field |
| `setMapping(field, mapping)` | full control: sources, transforms, valueMap |
| `autoMap()`, `clearMapping()` | |
| `addCustomField(input)`, `removeCustomField(key)` | a field the schema doesn't have; see [Custom fields](./custom-fields.md) |
| `suggestCustomField(column)` | name, type and options to start that form with |
| `previewField(field, mapping?)` | first values as they'd be imported |
| `distinctValues(field)` | values and counts, for value maps |
| `confirmMapping()` | validate every row and go to review |
| `countRows(query?)`, `getRows(query, start, end)` | review rows by `{ filter: 'all' \| 'errors' \| 'valid', field, search }` |
| `rowIds(query?)`, `findIssue(query, from, fields)` | ids for bulk actions; the next cell with an issue |
| `editCell(rowId, field, value)` | fix a value; the row is re-validated |
| `replaceValues(field, find, replace)` | find and replace |
| `deleteRows(ids)`, `deleteInvalidRows()` | |
| `submit(handler?)` | send valid rows in batches; resumable after a failed batch |
| `reviewRejected()` | reopen rows your server rejected |
| `back()`, `reset()`, `abort()` | |
| `dispose()` | release resources; a [worker session](./worker.md) terminates its worker |

---

## State

```ts
const { step, busy, error, mapping, sourceFields, rows, stats } = session.getState()
```

| Field | |
|---|---|
| `step` | current step |
| `busy` | `false` or what's running: `'loading'`, `'validating'`, … |
| `error` | `{ code, message }` for the user, or `null` |
| `sourceFields` | columns with labels, sample values and inferred types |
| `mapping` | field key → mapping |
| `customFields` | fields the user added; `session.schema` includes them |
| `rows` | review rows: `values`, `issues`, `sourceIndex` (line in the file) |
| `stats` | `total`, `valid`, `withErrors`, `errorCount`, per-field counts |
| `rowsVersion` | increases whenever rows change; use it to refetch row queries |
| `canGoBack` | whether `back()` does something right now |

Every change produces a new state object. Rows that didn't change keep their identity, so memoised components stay cheap.

Prefer the row queries over reading `rows` directly: they work the same for a [worker session](./worker.md), where `rows` stays in the worker and is always empty on the page.

While async checks for an edit run (async Standard Schemas, `validateBatch`), `busy` is `'validating'` and `canSubmit()` is false.

---

## Events

```ts
createImporter({ schema, onEvent: (e) => analytics.track(e.type) })
```

`file:loaded`, `dataset:selected`, `rows:loaded`, `mapping:suggested`, `mapping:confirmed`, `validation:completed`, `submit:progress`, `submit:completed`, `error`.
