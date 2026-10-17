---
title: UI component
description: The ready-made importer.
---

```bash
npm i @openimport/ui @openimport/react
```

```tsx
import { Importer } from '@openimport/ui'
import '@openimport/ui/styles.css'

<Importer importer={importer} title="Import contacts" onSubmit={({ records }) => save(records)} />
```

It walks the user through upload, header row, mapping, review and done.

---

## As a dialog

```tsx
import { ImporterDialog } from '@openimport/ui'

<ImporterDialog
  importer={importer}
  open={open}
  onOpenChange={setOpen}
  trigger={<button>Import</button>}
  onSubmit={({ records }) => save(records)}
/>
```

---

## Props

| Prop | |
|---|---|
| `importer` | from `createImporter()` |
| `session` | drive an existing session, e.g. to load files yourself or run in a [worker](./worker.md) |
| `title` | header title |
| `onSubmit` | persist records, in batches; overrides the importer's `onSubmit`. See [Output](./output.md) |
| `onComplete` | notification after a successful import, with every accepted record (none when the importer's own `onSubmit` saved them) |
| `onClose` | shows a close button |
| `locale` | `'en'`, `'de'` or your own messages |
| `messages` | override any string |
| `theme` | `{ accent, radius, colorScheme, fontFamily }` |
| `templateDownload` | show "Download template" (default `true`) |

---

## Keyboard

In the review grid: arrows or Tab to move, Enter or F2 to edit (or just type), Enter to save, Esc to cancel, Delete to clear.

---

## Loading files yourself

```tsx
const session = useImporterSession(importer)

<button onClick={() => session.loadFile(sampleFile)}>Try a sample</button>
<Importer importer={importer} session={session} />
```

See [Theming](./theming.md) for colours, radius and translations.
