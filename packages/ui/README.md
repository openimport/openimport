# @openimport/ui

A complete, polished import experience for [OpenImport](../../README.md): upload, header detection, column mapping with live previews, a transform and value-mapping editor, a virtualized review grid, and submission. It's accessible, keyboard-friendly, themeable and translatable.

```bash
npm i @openimport/core @openimport/react @openimport/ui @openimport/csv @openimport/xlsx
```

```tsx
import { Importer, ImporterDialog } from '@openimport/ui'
import '@openimport/ui/styles.css'

<Importer importer={importer} title="Import contacts" onSubmit={({ records }) => save(records)} />

<ImporterDialog
  importer={importer}
  open={open}
  onOpenChange={setOpen}
  trigger={<button>Import</button>}
  onSubmit={({ records }) => save(records)}
/>
```

## Props

| Prop | |
|---|---|
| `importer` | from `createImporter()` |
| `session` | drive an existing session (e.g. to load files programmatically) |
| `title` | header title |
| `onSubmit(batch)` | persist records, in batches (overrides the importer's `onSubmit`); throw to show an error, return `{ rejected }` to send rows back to review |
| `onComplete({ records, result })` | notification after a successful import, with every accepted record; don't persist here |
| `onClose` | shows a close button |
| `locale` | `'en'`, `'de'` or a full `Messages` object |
| `messages` | partial overrides of any string |
| `theme` | `{ accent, radius, colorScheme: 'light' \| 'dark' \| 'auto', fontFamily }` |
| `templateDownload` | show "Download template" (default `true`) |

## Keyboard

On the review grid: arrow keys / Tab to move, Enter or F2 to edit (or just start typing), Enter to commit, Esc to cancel, Delete to clear, PageUp/PageDown, Home/End.

## Composition

The steps are exported (`UploadStep`, `HeaderStep`, `MappingStep`, `FieldEditor`, `ReviewStep`, `CompleteStep`, `ColumnPicker`) for building a custom layout. Wrap them in `<ImporterProvider>` (session) and `<ImporterUiProvider>` (messages, theme, tooltips) inside an element with the `oi-theme` class:

```tsx
<ImporterProvider importer={importer}>
  <ImporterUiProvider locale="de" theme={{ accent: '#0ea5e9' }}>
    <div className="oi-theme" data-theme="auto">
      <MappingStep />
    </div>
  </ImporterUiProvider>
</ImporterProvider>
```

 See [Theming](../../docs/theming.md).
