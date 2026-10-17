---
"@openimport/core": minor
"@openimport/ui": minor
"@openimport/ai": minor
"@openimport/csv": patch
"@openimport/json": patch
"@openimport/xml": patch
"@openimport/xlsx": patch
---

Data integrity and shared execution semantics.

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
