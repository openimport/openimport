---
title: Validation
description: What gets checked, in which order, and how to add your own rules.
---

Every row is checked when the user confirms the mapping. An edit re-checks the edited row and the rows that share one of its unique values, so it stays fast in files with millions of rows.

---

## Order

1. **Transforms** run on the mapped source values.
2. **Coercion** converts to the field type. A value that can't be converted is an error, e.g. `Not a valid date`.
3. **Field rules**: `required`, `min`, `max`, `pattern`.
4. **Your field validators**, then **your row validators**.
5. **Standard Schema** (zod, valibot, arktype), if you passed one.
6. **Uniqueness** for `unique` fields: the first occurrence of a value is kept (with a warning pointing at the others), every later occurrence is an error.
7. **Batch validators**, async, for checks against your API.

The headless [`run()`](./server.md) applies the same steps, so a row valid in one is valid in the other. While an edit's async checks run, the session is busy and can't be submitted.

---

## Field validators

```ts
email: field.email({
  validate: (value) => (String(value).endsWith('@example.com') ? 'Use a real address' : undefined),
}),
```

Return a string, or an issue `{ code, message, severity }`. Severity `warning` shows the problem but doesn't block the import.

---

## Row validators

For rules that involve more than one field:

```ts
defineSchema({
  fields: { start: field.date(), end: field.date() },
  validateRow: (row) => (row.end < row.start ? { field: 'end', code: 'range', message: 'Ends before it starts' } : undefined),
})
```

---

## Batch validators

Run against many rows at once, for example to check your database:

```ts
defineSchema({
  fields: { email: field.email() },
  validateBatch: async (rows, { signal }) => {
    const taken = await api.existingEmails(rows.map((r) => r.values.email), { signal })
    return rows
      .filter((r) => taken.has(r.values.email))
      .map((r) => ({ rowId: r.id, field: 'email', code: 'exists', message: 'Already a contact' }))
  },
})
```

They run in batches of `batchSize` (default 1,000) and are cancelled when the user leaves the step.

---

## Issue codes

Built-in issues have stable codes you can translate: `required`, `invalid_number`, `invalid_integer`, `invalid_boolean`, `invalid_date`, `invalid_email`, `invalid_url`, `invalid_option`, `too_small`, `too_large`, `too_short`, `too_long`, `pattern`, `duplicate`, `schema`, `transform_failed`.
