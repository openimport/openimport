# @openimport/react

React bindings for [OpenImport](../../README.md). Build your own import UI on the headless core, or customise around the ready-made [`@openimport/ui`](../ui).

```bash
npm i @openimport/core @openimport/react @openimport/csv
```

```tsx
import { ImporterProvider, useImportState, useMapping, useReview, useSession, useUpload } from '@openimport/react'

function App() {
  return (
    <ImporterProvider importer={importer}>
      <Steps />
    </ImporterProvider>
  )
}

function Steps() {
  const step = useImportState((s) => s.step)
  if (step === 'upload') return <Upload />
  if (step === 'mapping') return <Mapping />
  if (step === 'review') return <Review />
  return null
}

function Upload() {
  const { getRootProps, getInputProps, open, isDragging } = useUpload()
  return (
    <div {...getRootProps()} className={isDragging ? 'drop active' : 'drop'}>
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
        <label key={field.key}>
          {field.label}
          <select value={mapping?.sources[0] ?? ''} onChange={(e) => session.assign(field.key, e.target.value || null)}>
            <option value="">—</option>
            {sourceFields.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      ))}
      <button disabled={!canConfirm} onClick={() => session.confirmMapping()}>Continue</button>
    </>
  )
}

function Review() {
  const session = useSession()
  const { stats, canSubmit } = useReview({ filter: 'errors' })
  return <button disabled={!canSubmit} onClick={() => session.submit(save)}>Import {stats.valid} rows</button>
}
```

| Hook | |
|---|---|
| `useSession()` | the session: all actions |
| `useImportState(selector?, equals?)` | subscribe to a slice of state (`useSyncExternalStore`) |
| `useStep()` | current step |
| `useUpload()` | dropzone + file dialog + paste |
| `useMapping()` | derived mapping state per field |
| `useReview(options)` | `total`, `getRow(i)` and stats for the filtered rows (fetched lazily, so it works with a worker) |
| `useSessionQuery(run, deps, initial)` | result of a sync or async session query |
| `useImporterSession(importer, factory?)` | create and own a session; `workerSession()` from `@openimport/worker` runs it in a Web Worker |

Works with React 18.3 and 19.
