---
title: Architecture
description: How the engine is put together.
---

```
            ┌──────────────────────── @openimport/ui ────────────────────────┐
            │ Upload → Dataset → Header → Mapping → Review → Submit → Done   │
            └───────────────────────────────┬────────────────────────────────┘
                                            │ hooks (@openimport/react)
┌───────────────────────────────────────────▼─────────────────────────────────────────────┐
│ @openimport/core: ImportSession (observable state machine)                              │
│                                                                                         │
│  SourceFile ──format plugin──▶ datasets ──read()──▶ rows (grid | records)               │
│      │                                                    │                             │
│      │                          header detection ◀────────┤ grid                        │
│      │                          path flattening  ◀────────┘ records                     │
│      ▼                                                                                  │
│  SourceField[] + SourceRow[]   ← the uniform intermediate representation                │
│      │                                                                                  │
│      ├── recipes ──┐                                                                    │
│      ├── matchers ─┴─▶ Mapping (target ← sources + transforms + valueMap + options)     │
│      ▼                                                                                  │
│  RowProcessor: transforms → coercion → constraints → field/row validators               │
│                → Standard Schema → uniqueness → batch validators                        │
│      ▼                                                                                  │
│  ReviewRow[] (values, input, issues, edits) ──▶ submit(batches) ──▶ your onSubmit        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## The intermediate representation

The mapping UI doesn't know or care whether the source is CSV, Excel, JSON or XML. Every format plugin produces one of two **dataset layouts**:

- **`grid`**: rows are arrays of cells (CSV, XLSX). The core finds the header row (`detectHeaderRow`) and turns columns into source fields with keys `c0`, `c1`, …
- **`records`**: rows are objects (JSON, XML). The core flattens nested objects to dot paths (`address.city`), and each path becomes a source field.

After that, everything works on the same two structures:

```ts
interface SourceField { key: string; label: string; index: number; samples: RawValue[]; inferredType: InferredType; emptyRatio: number }
interface SourceRow   { id: string; sourceIndex: number; values: Record<string, RawValue> }
```

`sourceIndex` is the 1-based line or record number, so error messages and the downloadable error report refer to rows the user can find in their file.

## Mapping model

A mapping is keyed by **target field**, which allows many-to-one (combine) and one-to-many (split) mappings:

```ts
type Mapping = Record<string, FieldMapping>

interface FieldMapping {
  sources: string[]               // source field keys
  transforms?: TransformStep[]    // declarative, JSON-serialisable pipeline
  valueMap?: Record<string, string>
  fallback?: unknown
  options?: { dateOrder?: 'DMY' | 'MDY' | 'YMD'; decimal?: '.' | ',' }
  origin?: 'user' | 'recipe' | 'suggestion'
  confidence?: number
}
```

Transforms are referenced by `op` and resolved through a registry. Recipes therefore contain no code, can be stored in a database, and can be re-run on a server.

## Session state machine

```
upload ─▶ dataset? ─▶ header? ─▶ mapping ─▶ review ─▶ submitting ─▶ complete
   ▲          │           │          │          │                      │
   └──────────┴───────────┴── back() ┴──────────┘◀── reviewRejected() ──┘
```

- `dataset` is skipped when a file has exactly one dataset.
- `header` is shown when the detected header isn't the first row (`headerSelection: 'auto'`), always, or never.
- All state lives in one immutable snapshot (`SessionState`) behind a tiny observable store, which works with `useSyncExternalStore`, Svelte stores, signals, etc.
- Every async step gets an `AbortSignal`. Loading a new file cancels the previous one.

## Validation pipeline

For each row and each target field:

1. **Value**: a user edit if present, otherwise `applyFieldMapping` (sources → transforms → fallback).
2. **Coercion** by type (`string`, `number`, `integer`, `boolean`, `date`, `datetime`, `email`, `url`, `enum`), honouring column options and value maps. Lists (`multiple`) are split and coerced per item.
3. **Constraints**: `required`, `min`/`max`, length, `pattern`.
4. **Custom field validators**, then **row validators** (cross-field).
5. **Standard Schema** on the nested record (zod/valibot/arktype). Issues are mapped back to fields by path.
6. **Uniqueness** (case-insensitive for strings): the first occurrence is kept with a warning, later occurrences are errors.
7. **Batch validators** (async, chunked, abortable) for server-side checks.

Edits re-run steps 1–6 for the edited rows only, uniqueness only for the edited fields, and the async validators in the background. Unchanged rows keep object identity so the virtualized grid only re-renders what changed.

## One set of rules for both entry points

The interactive session and the headless `run()` share one execution module: file and row limits, suggestion application, the row processor (transforms, coercion, rules, Standard Schema), uniqueness, `validateBatch` and record output. A row that is valid in one is valid in the other. Tests in `packages/core/test/review.test.ts` hold both paths to that.

---

## Memory

Interactive review and editing need random access, so the session keeps parsed rows in memory. Validation yields to the main thread between chunks.

`run()` validates and yields `batchSize` rows at a time. Whether the file itself is streamed depends on the format's `capabilities.streaming`: CSV and JSON Lines are, JSON, XML and Excel are parsed whole. `unique` fields keep one entry per distinct value.

---

## Submission

`submit()` sends valid rows in batches. Each batch has a stable `batchId` for idempotent writes. If a batch fails, rows accepted so far stay imported and leave the review, and the next `submit()` sends only the rest.
