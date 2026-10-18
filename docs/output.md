---
title: Output
description: Persisting records, partial success and retries.
---

Two callbacks, two jobs:

- **`onSubmit` persists.** It receives batches of valid records while the user waits. If it throws, the user sees the error and can retry.
- **`onComplete` notifies.** It runs after the import has succeeded, with every accepted record. Don't save here: the user already sees "Import complete".

```tsx
<Importer
  importer={importer}
  onSubmit={({ records, batchId }) => api.contacts.createMany(records, { idempotencyKey: batchId })}
  onComplete={({ result }) => toast(`${result.submitted} contacts imported`)}
/>
```

`onSubmit` can also be set once on `createImporter()`.

---

## Batches

```ts
onSubmit: async ({ records, rows, index, total, batchId, signal }) => { … }
```

| Field | |
|---|---|
| `records` | typed, nested records; values of [custom fields](./custom-fields.md) in `record.$custom` |
| `rows` | the review rows behind them; `rows[i].id` identifies `records[i]` |
| `index`, `total` | position of this batch in the current attempt |
| `batchId` | stable id for this set of rows; use it as an idempotency key |
| `customFields` | the custom fields the user added (empty without them) |
| `signal` | aborted when the user cancels |

Batch size is `batchSize` (default 1,000).

---

## When a batch fails

Rows from batches that succeeded stay imported. They leave the review, the user sees "1,000 of 3,000 rows were imported before the error", and submitting again sends only the remaining rows. A batch that is retried with the same rows has the same `batchId`, so a server that remembers ids won't store it twice.

---

## Rejecting single rows

Return the rows your server refused. They don't count as imported, and the user can review them with your messages.

```ts
onSubmit: async ({ records, rows }) => {
  const res = await api.contacts.createMany(records)
  return {
    rejected: res.errors.map((e) => ({ rowId: rows[e.index].id, field: e.field, code: 'server', message: e.message })),
  }
}
```

The UI offers "Review rejected rows". Headless, call `session.reviewRejected()`.

---

## Rows with errors

`invalidRows` decides what happens to them:

- `block` (default): the user must fix or remove them before importing.
- `skip`: valid rows are imported and the rest are reported as skipped.

---

## Without submitting

```ts
const records = await session.getRecords()                  // all valid records
for await (const { records } of session.records(1000)) {    // or in chunks
  await save(records)
}
```
