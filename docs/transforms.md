---
title: Transforms
description: Combine, split and clean values before they're validated.
---

A mapping can run transforms on its source values. Transforms are JSON steps, so recipes stay safe to store and share.

```ts
session.setMapping('street', {
  sources: ['c3', 'c4'],
  transforms: [{ op: 'template', template: '{1} {2}' }],
})
```

---

## Built-in transforms

| op | Input | Params |
|---|---|---|
| `join` | several columns | `separator` (default `" "`) |
| `template` | several columns | `template`, e.g. `"{2}, {1}"` |
| `coalesce` | several columns | first non-empty value |
| `split` | one value | `separator`, `index` (negative counts from the end), `rest` |
| `trim` | one value | |
| `lowercase`, `uppercase`, `titlecase` | one value | |
| `replace` | one value | `find`, `replace`, `regex` |
| `extract` | one value | `pattern` (first capture group) |
| `prefix` | one value | `prefix`, `suffix` |

With several sources, single-value transforms apply to each source. The first several-column transform combines them. Leftover values are joined with a space.

---

## Splitting one column into two

```ts
session.setMapping('firstName', { sources: ['c0'], transforms: [{ op: 'split', index: 0 }] })
session.setMapping('lastName', { sources: ['c0'], transforms: [{ op: 'split', index: -1 }] })
```

---

## Defaults and value maps

```ts
session.setMapping('status', {
  sources: ['c5'],
  valueMap: { Kunde: 'customer', Interessent: 'lead' },
  fallback: 'lead',
})
```

`fallback` is used when the transformed value is empty.

---

## Your own transforms

```ts
const iban = definePlugin({
  name: 'iban',
  transforms: [{
    op: 'iban',
    label: 'Normalize IBAN',
    arity: 'one',
    apply: (v) => String(v).replaceAll(' ', '').toUpperCase(),
  }],
})
```

Declare `params` and the UI's transform editor renders inputs for them. Steps are checked against `params`: a wrong type or an unknown parameter is reported on the row instead of running.

Transform ops must be unique across plugins. To replace a built-in transform, set `override: true`.
