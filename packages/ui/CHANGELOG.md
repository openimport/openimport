# @openimport/ui

## 0.2.0

### Minor Changes

- e71ff08: `ImporterUiProvider` is exported, so the steps (`UploadStep`, `MappingStep`, `ReviewStep`, …) can be composed into your own layout with translated messages and tooltips. The upload step hides "Expected fields" when the schema has none (e.g. when the target is chosen after the upload).
- 786b737: Custom fields. With `customFields: true` (or options for types, maximum, groups and a `check` hook), users can add columns the schema doesn't have as typed, validated fields during mapping. Values arrive in `record.$custom`, apart from the typed record and outside Standard Schema validation; `onSubmit` batches and `run()` chunks also list the field definitions. Custom fields are saved with recipes and restored for matching files, including in `run()`. New session methods: `addCustomField`, `removeCustomField`, `suggestCustomField`; worker sessions support them too. The mapping step's type labels are now translated.
- 91acc8d: Initial release: headless import engine, React bindings, ready-made UI, CSV/XLSX/JSON/JSONL/XML format plugins and bring-your-own-model AI matching.
- 91acc8d: Data integrity and shared execution semantics.
  
  - `run()` and the interactive session share one execution module: `maxFileSize`/`maxRows`, `validateBatch`, uniqueness and record output behave the same in both.
  - Uniqueness: the first occurrence of a value is kept (warning), later ones are errors.
  - Edits recompute uniqueness for every unique field; the session stays busy (and can't be submitted) while async checks run.
  - `submit()` is resumable: accepted batches aren't resent after a failure, and every batch has a stable `batchId`. `onSubmit` persists, `onComplete` only notifies.
  - Field keys are validated (no `__proto__`/`prototype`/`constructor` segments, no overlapping paths); unsafe source keys are ignored.
  - `null` and `[]` are preserved for nullable and list fields; late JSON properties are discovered.
  - Auto-map keeps matcher transforms; recipes replay header row and dataset and are validated with `parseRecipe()`.
  - Plugin collisions throw `invalid_plugin`; transform params are validated; formats declare `capabilities`; `@openimport/core/testing` provides conformance checks.
  - arktype schemas (callable) are recognised; the AI matcher can use registered custom transforms.
  - JSON and XML readers stop when the signal aborts.
- 91acc8d: Imports in a Web Worker. New `@openimport/worker` package: `exposeImporter()` in the worker and `workerSession()` for `useImporterSession(importer, factory)`, optionally only for files above a size. Sessions now share a `SessionLike` interface with row queries (`countRows`, `getRows`, `rowIds`, `findIssue`) and `rowsVersion` / `canGoBack` in state. `useReview` returns `total` and `getRow(i)` instead of a rows array, and `useSessionQuery` resolves sync or async queries. Recipes are stored in IndexedDB by default, so pages and workers share them.

### Patch Changes

- ca314d5: performance improvements
- 91acc8d: Every select in the importer (transformations, date and number formats, fallbacks, value maps, review filters, find & replace and enum/boolean cells) now uses the same styled, themed Radix menu instead of the browser's native `<select>`.
- Updated dependencies [e71ff08]
- Updated dependencies [786b737]
- Updated dependencies [3712b4b]
- Updated dependencies [91acc8d]
- Updated dependencies [91acc8d]
- Updated dependencies [5a446a9]
- Updated dependencies [ca314d5]
- Updated dependencies [91acc8d]
  - @openimport/core@0.2.0
  - @openimport/react@0.2.0
