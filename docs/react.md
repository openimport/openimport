---
title: React hooks
description: Build your own import UI on top of the engine.
---

```bash
npm i @openimport/react
```

```tsx
import { ImporterProvider } from '@openimport/react'

<ImporterProvider importer={importer}>
  <MyImporter />
</ImporterProvider>
```

---

## Hooks

| Hook | Returns |
|---|---|
| `useSession()` | the session, with every action |
| `useImportState(selector)` | a slice of state; re-renders only when it changes |
| `useStep()` | the current step |
| `useUpload()` | dropzone and file dialog helpers |
| `useMapping()` | fields with their mapping and status |
| `useReview({ filter, field, search })` | `total`, `getRow(i)`, `stats`, `canSubmit` for the filtered rows |
| `useSessionQuery(run, deps, initial)` | the result of a session query, e.g. `previewField` |
| `useImporterSession(importer, factory?)` | a session owned by the component; pass `workerSession()` to run it in a [worker](./worker.md) |

---

## Example

```tsx
function MyImporter() {
  const step = useImportState((s) => s.step)
  if (step === 'upload') return <Upload />
  if (step === 'mapping') return <Mapping />
  if (step === 'review') return <Review />
  return <Done />
}

function Upload() {
  const { getRootProps, getInputProps, open } = useUpload()
  return (
    <div {...getRootProps()}>
      <input {...getInputProps()} />
      <button onClick={open}>Choose a file</button>
    </div>
  )
}

function Mapping() {
  const session = useSession()
  const { fields, sourceFields, canConfirm } = useMapping()
  return (
    <>
      {fields.map(({ field, mapping }) => (
        <select key={field.key} value={mapping?.sources[0] ?? ''} onChange={(e) => session.assign(field.key, e.target.value || null)}>
          <option value="">{field.label}</option>
          {sourceFields.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      ))}
      <button disabled={!canConfirm} onClick={() => session.confirmMapping()}>Continue</button>
    </>
  )
}
```

---

## Review rows

`useReview` doesn't hand you an array of rows. It gives you a count and a getter, so a virtual list only asks for the rows on screen. That works the same whether the rows are in memory or in a [worker](./worker.md):

```tsx
function Review() {
  const { total, getRow, stats } = useReview({ filter: 'errors' })
  // getRow(i) returns the row, or undefined while it's being fetched
  return <VirtualList count={total} renderRow={(i) => <Row row={getRow(i)} />} />
}
```

Session queries such as `previewField` return values on the main thread and promises from a worker. `useSessionQuery` handles both:

```tsx
const preview = useSessionQuery(() => session.previewField('email'), [session, mapping], [])
```

See [Session API](./session.md) for every action.
