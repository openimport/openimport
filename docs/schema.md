---
title: Schema
description: Describe the records you want to end up with.
---

A schema is a list of fields. Each field has a key, a type and optional rules.

```ts
const products = defineSchema({
  id: 'products',
  fields: {
    sku: field.string({ required: true, unique: true, pattern: '^[A-Z]{3}-\\d{4}$' }),
    price: field.number({ min: 0 }),
    active: field.boolean({ aliases: ['enabled', 'aktiv'] }),
    launch: field.date(),
    category: field.enum(['hardware', 'software']),
    tags: field.string({ multiple: true }),
    'dimensions.width': field.number(),
  },
})
```

The `id` scopes saved recipes. Keys with dots produce nested output: `{ dimensions: { width } }`.

Keys must be unique, must not overlap (`address` and `address.city`), and must not contain `__proto__`, `prototype` or `constructor`. This is checked when the schema is defined, which matters when fields come from users or tenants.

---

## Types

| Type | Accepts | Outputs |
|---|---|---|
| `string` | anything | trimmed string |
| `number` | `1,234.5`, `1.234,5`, `€ 12`, `12%`, `(42)` | number |
| `integer` | whole numbers | number |
| `boolean` | `yes/no`, `ja/nein`, `true/false`, `1/0`, `x` | boolean |
| `date` | ISO, `15.03.2024`, `03/15/2024`, Excel serials | `"2024-03-15"` |
| `datetime` | as `date`, with time | ISO string |
| `email` | email addresses | lowercased email |
| `url` | URLs, `www.` prefixes | normalised URL |
| `enum` | option values, labels, aliases | option value |

---

## Field options

| Option | Meaning |
|---|---|
| `label`, `description`, `examples` | Shown in the UI and the template. |
| `required` | Empty values are errors. |
| `unique` | Duplicate values across rows are errors. |
| `aliases` | Extra column names to match, e.g. `['Vorname']`. |
| `default` | Used when the value is empty. |
| `multiple` | Split `a, b; c` into a list. Empty input becomes `[]`. |
| `nullable` | Empty input becomes `null` instead of being left out. |
| `min`, `max` | Range for numbers and dates, length for strings. |
| `pattern` | Regular expression for strings. |
| `options` | For `enum`: `{ value, label?, aliases? }`. |
| `parse(raw)` | Your own coercion. |
| `validate(value, ctx)` | Your own check. Return a message to flag the cell. |

---

## Fields from your API

Pass a plain list when fields are only known at runtime:

```ts
defineSchema({ fields: tenant.fields.map((f) => ({ key: f.slug, label: f.name, type: f.type })) })
```

---

## zod, arktype, valibot

Pass a schema that implements [Standard JSON Schema](https://standardschema.dev). Fields are derived from it and every record is validated by it. zod 4 and arktype 2 do this out of the box; valibot needs `toStandardJsonSchema()` from `@valibot/to-json-schema`. All three are tested.

```ts
const importer = createImporter({
  schema: z.object({
    email: z.email(),
    age: z.number().int().min(18).optional(),
  }),
  plugins: [csv()],
})
```

```ts
import { toStandardJsonSchema } from '@valibot/to-json-schema'

createImporter({ schema: toStandardJsonSchema(v.object({ email: v.pipe(v.string(), v.email()) })), plugins: [csv()] })
```

Records are the schema's parsed output, so defaults and transforms apply. Nullable fields receive `null` and list fields `[]` when empty, so `.nullable()` and required arrays validate as you'd expect.
