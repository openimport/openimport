# @openimport/worker

## 0.2.0

### Minor Changes

- 786b737: Custom fields. With `customFields: true` (or options for types, maximum, groups and a `check` hook), users can add columns the schema doesn't have as typed, validated fields during mapping. Values arrive in `record.$custom`, apart from the typed record and outside Standard Schema validation; `onSubmit` batches and `run()` chunks also list the field definitions. Custom fields are saved with recipes and restored for matching files, including in `run()`. New session methods: `addCustomField`, `removeCustomField`, `suggestCustomField`; worker sessions support them too. The mapping step's type labels are now translated.
- 91acc8d: Imports in a Web Worker. New `@openimport/worker` package: `exposeImporter()` in the worker and `workerSession()` for `useImporterSession(importer, factory)`, optionally only for files above a size. Sessions now share a `SessionLike` interface with row queries (`countRows`, `getRows`, `rowIds`, `findIssue`) and `rowsVersion` / `canGoBack` in state. `useReview` returns `total` and `getRow(i)` instead of a rows array, and `useSessionQuery` resolves sync or async queries. Recipes are stored in IndexedDB by default, so pages and workers share them.

### Patch Changes

- e71ff08: `session.assign()` now infers the same options as a suggested mapping (date order, decimal separator, enum value map), so picking a column by hand converts `15.03.1985` or `89,50` the same way an automatic match would. A new `{ exclusive: false }` option keeps the column on the other fields it fills, for one column that feeds several targets (e.g. a customer number on both a contact and a contract).
- ca314d5: performance improvements
- Updated dependencies [e71ff08]
- Updated dependencies [786b737]
- Updated dependencies [3712b4b]
- Updated dependencies [91acc8d]
- Updated dependencies [91acc8d]
- Updated dependencies [5a446a9]
- Updated dependencies [ca314d5]
- Updated dependencies [91acc8d]
  - @openimport/core@0.2.0
