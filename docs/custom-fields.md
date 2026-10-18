---
title: Custom fields
description: Let users import columns your schema doesn't have.
---

Files often have more columns than your schema: a loyalty tier, an internal segment, a second phone number. With custom fields, the user can add such a column as a new field during the import. It's typed and validated like your own fields, and your code receives it separately from the typed record.

```ts
createImporter({ schema, customFields: true })
```

Off by default. In the mapping step, every column that nothing maps to becomes a button: **Add as field**. The user names the field and picks a type. OpenImport suggests one from the values: a number column becomes a number, dates a date, and a column with a handful of repeated values a choice with those values as options.

---

## What your code receives

Custom values arrive in `$custom`, so the record keeps exactly the shape your schema describes. A strict zod schema never sees them.

```ts
onSubmit: ({ records, customFields }) => {
  records[0]
  // { name: 'Ada', email: 'ada@x.io', $custom: { loyalty_tier: 'gold' } }
  customFields
  // [{ key: 'loyalty_tier', label: 'Loyalty tier', type: 'enum', options: [{ value: 'gold' }, …] }]
}
```

`customFields` describes each field: key, the name the user gave it, type, options and group. Use it to create the field in your own system before saving the records, for example a new attribute or column.

---

## Options

```ts
customFields: {
  types: ['string', 'number', 'date', 'boolean', 'enum'],
  max: 10,
  check: (field) => (existing.has(field.label) ? 'This attribute already exists' : undefined),
}
```

| Option | Default | |
|---|---|---|
| `types` | text, number, date, yes/no, email, URL, choice | the types users can pick |
| `max` | `20` | custom fields per import |
| `groups` | the `group`s of your fields | where a field can belong, e.g. one group per entity |
| `requireGroup` | when every field has a group | whether a group must be picked |
| `check` | – | return a message to reject a field |

Names that already exist in your schema (in the same group) are rejected, and keys are generated from the name: `Kunde seit` becomes `kunde_seit`.

To allow it only for some users, decide per importer: `customFields: user.canEditSchema`.

---

## Saved mappings

Custom fields are saved with the mapping. When the next file has the same headers, the fields come back and are mapped again. The same is true on the server: `importer.run(file, { recipe })` restores them, as long as the importer allows custom fields. Entries the importer doesn't allow, such as a type not in `types`, are dropped.

---

## Headless

```ts
const suggestion = session.suggestCustomField(columnKey) // name, type and options to start from
session.addCustomField({ ...suggestion, label: 'Loyalty tier' }) // throws `invalid_custom_field` with a message
session.removeCustomField('loyalty_tier')
```

`session.schema` includes the custom fields, so previews, validation, the review grid and `useMapping()` show them like any other field. In state they're in `customFields`.
