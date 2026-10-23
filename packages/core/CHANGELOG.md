# @openimport/core

## 0.2.0

### Minor Changes

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
- 5a446a9: `fromJsonSchema(json, { validate, exclude, fields })` uses a plain JSON Schema (an OpenAPI request body, a `.schema.json` file) as the importer's schema. Pass a compiled validator such as `ajv.compile(schema)` to check each record against the whole schema; its errors land on the matching fields. Lists of objects can't come from a flat file: `fromJsonSchema` names them and asks to `exclude` them, and zod / valibot / arktype schemas now leave them out with a warning instead of producing a broken text field. Exclusive bounds are translated exactly for integers and no longer treated as inclusive. Passing a plain JSON Schema straight to `createImporter` now explains how to wrap it.
- 91acc8d: Imports in a Web Worker. New `@openimport/worker` package: `exposeImporter()` in the worker and `workerSession()` for `useImporterSession(importer, factory)`, optionally only for files above a size. Sessions now share a `SessionLike` interface with row queries (`countRows`, `getRows`, `rowIds`, `findIssue`) and `rowsVersion` / `canGoBack` in state. `useReview` returns `total` and `getRow(i)` instead of a rows array, and `useSessionQuery` resolves sync or async queries. Recipes are stored in IndexedDB by default, so pages and workers share them.

### Patch Changes

- e71ff08: `session.assign()` now infers the same options as a suggested mapping (date order, decimal separator, enum value map), so picking a column by hand converts `15.03.1985` or `89,50` the same way an automatic match would. A new `{ exclusive: false }` option keeps the column on the other fields it fills, for one column that feeds several targets (e.g. a customer number on both a contact and a contract).
- 3712b4b: Edits in the review step no longer scale with the file size. Uniqueness and stats are now kept in an index that an edit updates only for the rows it affects (the edited row and rows sharing one of its unique values). At 1,000,000 rows an edit takes about 1 ms instead of ~850 ms; building the index adds a few percent to the initial validation.
- ca314d5: performance improvements
