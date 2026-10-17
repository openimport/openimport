---
title: Quick start
description: An importer on screen in five minutes.
---

## Install

```bash
npm i @openimport/core @openimport/csv @openimport/xlsx @openimport/react @openimport/ui
```

---

## Define a schema

```ts title="importer.ts"
import { createImporter, defineSchema, field } from '@openimport/core'
import { csv } from '@openimport/csv'
import { xlsx } from '@openimport/xlsx'

const contacts = defineSchema({
  id: 'contacts',
  fields: {
    firstName: field.string({ required: true }),
    email: field.email({ required: true, unique: true }),
    status: field.enum(['lead', 'customer']),
  },
})

export const importer = createImporter({ schema: contacts, plugins: [csv(), xlsx()] })
```

---

## Render the importer

```tsx title="ImportContacts.tsx"
import { Importer } from '@openimport/ui'
import '@openimport/ui/styles.css'
import { importer } from './importer'

export function ImportContacts() {
  return (
    <Importer
      importer={importer}
      onSubmit={({ records }) => api.contacts.createMany(records)}
      onComplete={({ result }) => toast(`${result.submitted} contacts imported`)}
    />
  )
}
```

`onSubmit` saves the records, in batches, while the user waits; if it fails, the user sees the error and can retry. `onComplete` is only a notification. `records` is typed from the schema: `{ firstName: string; email: string; status?: 'lead' | 'customer' }[]`.

---

## Next

- Want your own UI? See [React hooks](./react.md).
- No UI at all? See [Server-side](./server.md).
