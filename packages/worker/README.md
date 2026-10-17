# @openimport/worker

Run [OpenImport](../../README.md) sessions in a Web Worker. Parsing, mapping suggestions, transforms, validation and the review rows live in the worker; the page fetches only the rows it shows. The `<Importer>` component and the React hooks work unchanged.

Opt in for large files, especially Excel workbooks, which can't be parsed in chunks.

```ts
// import.worker.ts
import { exposeImporter } from '@openimport/worker'
import { importer } from './importer'

exposeImporter(importer)
```

```tsx
// app.tsx
import { useImporterSession } from '@openimport/react'
import { Importer } from '@openimport/ui'
import { workerSession } from '@openimport/worker'
import { importer } from './importer'

const inWorker = workerSession({
  worker: () => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }),
  above: 5 * 1024 * 1024, // optional: smaller files stay on the main thread
})

function ImportContacts() {
  const session = useImporterSession(importer, inWorker)
  return <Importer importer={importer} session={session} onSubmit={({ records }) => api.save(records)} />
}
```

## API

| Export | |
|---|---|
| `exposeImporter(importer, endpoint?)` | in the worker: serve sessions for this importer |
| `workerSession({ worker, above?, onEvent? })` | a session factory for `useImporterSession` |
| `createWorkerSession(importer, worker, options?)` | connect to a worker (or any `MessagePort`) directly |
| `RemoteSession`, `AdaptiveSession` | the session classes, e.g. for `instanceof` checks |

See the [Large files](../../docs/worker.md) guide for what runs where and measurements.
