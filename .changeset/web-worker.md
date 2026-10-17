---
"@openimport/worker": minor
"@openimport/core": minor
"@openimport/react": minor
"@openimport/ui": minor
---

Imports in a Web Worker. New `@openimport/worker` package: `exposeImporter()` in the worker and `workerSession()` for `useImporterSession(importer, factory)`, optionally only for files above a size. Sessions now share a `SessionLike` interface with row queries (`countRows`, `getRows`, `rowIds`, `findIssue`) and `rowsVersion` / `canGoBack` in state. `useReview` returns `total` and `getRow(i)` instead of a rows array, and `useSessionQuery` resolves sync or async queries. Recipes are stored in IndexedDB by default, so pages and workers share them.
