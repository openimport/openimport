---
title: Intro
description: A headless engine for user-facing data imports.
---

OpenImport is an open-source TypeScript import engine with an optional React mapping interface. It turns the files your users upload (CSV, Excel, JSON, XML) into typed records that match your schema: it finds the header, matches columns, fixes formats, validates every row and hands the result to your code.

It is a library, not a service. Files are processed locally and your application stores the records. The mapping experience is modelled on tools like OneSchema; the scope is the import itself, not storage, users or workflows.

---

## How it fits together

```
@openimport/core      the engine: session, matching, transforms, validation
@openimport/csv …     format plugins: csv, xlsx, json, xml
@openimport/react     hooks for building your own UI
@openimport/ui        a ready-made importer component
@openimport/worker    optional: run imports in a Web Worker
```

You always need `core` and at least one format plugin. `react` and `ui` are optional.

---

## What happens during an import

1. **Parse.** A format plugin reads the file into rows.
2. **Find the header.** Title lines and blank rows above the table are skipped.
3. **Map.** Columns are matched to your fields, from a saved recipe or by the matchers.
4. **Validate.** Every value is transformed, coerced to its type and checked.
5. **Review.** The user fixes or removes rows with errors.
6. **Submit.** Valid records reach your `onSubmit` in batches.

Steps 1–4 are automatic. Steps 3 and 5 can be shown to the user, which is what the UI does.

---

## Next

- [Quick start](./quick-start.md) gets an importer on screen in five minutes.
- [Schema](./schema.md) explains how to describe the records you want.
