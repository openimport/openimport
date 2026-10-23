# @openimport/json

## 0.2.0

### Minor Changes

- 91acc8d: Initial release: headless import engine, React bindings, ready-made UI, CSV/XLSX/JSON/JSONL/XML format plugins and bring-your-own-model AI matching.

### Patch Changes

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
