---
title: Large files
description: Run imports in a Web Worker so the page never freezes.
---

By default an import runs on the main thread. That's fine for most files: CSV is read in chunks and validation yields to the browser regularly. For large files, especially Excel workbooks, which have to be unzipped and parsed in one go, move the work into a Web Worker. The page stays responsive and nothing else changes: same `<Importer>`, same hooks, same events.

```bash
npm i @openimport/worker
```

---

## Setup

Put the importer in its own module, so the page and the worker build the same one:

```ts title="importer.ts"
import { createImporter } from '@openimport/core'
import { csv } from '@openimport/csv'
import { xlsx } from '@openimport/xlsx'
import { schema } from './schema'

export const importer = createImporter({ schema, plugins: [csv(), xlsx()] })
```

The worker exposes it:

```ts title="import.worker.ts"
import { exposeImporter } from '@openimport/worker'
import { importer } from './importer'

exposeImporter(importer)
```

The page creates its session in the worker:

```tsx title="app.tsx"
import { Importer } from '@openimport/ui'
import { useImporterSession } from '@openimport/react'
import { workerSession } from '@openimport/worker'
import { importer } from './importer'

const inWorker = workerSession({
  worker: () => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }),
})

function ImportContacts() {
  const session = useImporterSession(importer, inWorker)
  return <Importer importer={importer} session={session} onSubmit={({ records }) => api.save(records)} />
}
```

`new Worker(new URL(…, import.meta.url))` is understood by Vite, webpack 5, Rspack, Parcel and esbuild, so the worker is bundled for you. Create the factory once (outside the component or with `useMemo`): a new factory creates a new session.

---

## Only for large files

Most files are small, and a worker costs a few milliseconds to start. With `above`, a file stays on the main thread unless it's bigger than the threshold:

```ts
workerSession({ worker: () => new Worker(…), above: 5 * 1024 * 1024 }) // 5 MB
```

The worker is started the first time it's needed and reused after that.

---

## What runs where

| Main thread | Worker |
|---|---|
| The UI and the rows on screen | Parsing, mapping suggestions, transforms, validation |
| `onSubmit` and `onComplete` passed to `<Importer>` | `onSubmit`, `onEvent`, `validateBatch` and AI matchers in `createImporter()` |
| | All review rows |

The page keeps only the rows it shows. The grid fetches pages of rows from the worker as you scroll, and filters, search, "next error" and find & replace run in the worker.

Records reach the page only through `onSubmit`, in batches, exactly as without a worker. If you'd rather save from the worker (for example, to `fetch` your API directly), leave `onSubmit` off `<Importer>` and set it in `createImporter()`. Then `onComplete` gets the result but no records.

Recipes are stored in IndexedDB by default, which workers can use too, so a mapping saved on the main thread is found in the worker and the other way round.

---

## Effect

Longest time the page couldn't respond while importing, measured in Chrome with `pnpm e2e:perf` (Apple M-series; "4× slower CPU" uses Chrome's CPU throttling to approximate a mid-range laptop):

| File | Main thread | 4× slower CPU | Worker | 4× slower CPU |
|---|---|---|---|---|
| CSV, 250,000 rows (15 MB) | 73 ms | 379 ms | 0 ms | 55 ms |
| Excel, 60,000 rows (1.5 MB) | 150 ms | 656 ms | 0 ms | 58 ms |

Anything over 50 ms is noticeable: clicks and scrolling wait. The remaining ~55 ms in a worker is the page rendering the review grid. The total import time is about the same either way: a worker keeps the page free, it doesn't make parsing faster.

---

## Your own worker setup

`createWorkerSession(importer, worker)` connects to any worker that called `exposeImporter()`. A `MessagePort`, or anything with `postMessage` and `addEventListener`, works too:

```ts
import { createWorkerSession } from '@openimport/worker'

const session = createWorkerSession(importer, new Worker(url, { type: 'module' }), {
  onEvent: (event) => analytics.track(event.type),
})
```

To pass settings to the worker, use its `name`: `new Worker(url, { type: 'module', name: JSON.stringify(options) })`, then read `self.name` in the worker.

`session.dispose()` terminates the worker. `useImporterSession` does that when the component unmounts.

---

## Headless

A worker session implements the same [Session API](./session.md), except that queries return promises: `await session.countRows()`, `await session.getRows(query, 0, 100)`. `state.rows` is always empty on the main thread; use the row queries, or the [`useReview`](./react.md) hook, which handles both.

On a server you don't need any of this: use [`run()`](./server.md), which streams and never builds a UI state.
