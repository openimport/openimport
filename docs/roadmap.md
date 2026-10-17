---
title: Roadmap
description: What's in v0.1, what's next, and what's out of scope.
---

## v0.1: the must-haves ✅

The goal for the first release was an importer you can put in front of real customers.

- [x] Headless core with an observable session state machine and abortable async steps
- [x] Schema DSL with type inference, runtime schemas, and zod / arktype / valibot via Standard JSON Schema
- [x] Format plugins: CSV/TSV (streaming, encoding and delimiter detection), XLSX, JSON (record discovery), JSON Lines, XML
- [x] Header row detection and selection
- [x] Fuzzy matching with an EN/DE synonym dictionary, aliases, type affinity and nested paths
- [x] Mapping UI with live previews, confidence badges, a ranked column picker and an unused-column overview
- [x] Declarative transforms (combine, template, split, case, replace, extract, …) with a live-preview editor
- [x] Enum value mapping with suggestions
- [x] Column-level date order and decimal separator detection
- [x] Validation: types, required, unique, ranges, patterns, custom field/row validators, async batch validators
- [x] Virtualized, keyboard-driven review grid: inline editing, filters, next error, find & replace, bulk delete, error CSV export
- [x] Batched submission with progress and server-side rejections fed back into review
- [x] Persistent mapping recipes (IndexedDB by default, pluggable storage)
- [x] Headless streaming `importer.run()` for Node, workers and servers
- [x] Bring-your-own-model AI matching
- [x] Paste-from-spreadsheet, CSV template download
- [x] i18n (en, de), theming, dark mode, dialog variant

## Next

In this order: data integrity first, then shared semantics, then contracts, then reach.

1. **Data integrity**
   - [x] Edits keep uniqueness and async checks intact; no submitting while checks run
   - [x] Resumable submission with idempotency keys; `onSubmit` persists, `onComplete` notifies
   - [x] Safe field paths for runtime schemas
2. **Shared execution semantics**
   - [x] One execution module behind the session and `run()` (limits, validation, uniqueness, `validateBatch`)
   - [x] Source semantics preserved: `null`, `[]`, late JSON properties
3. **Replay and plugin contracts**
   - [x] Recipes replay header row and dataset, and are validated before use
   - [x] Collision rules, parameter validation, capability metadata, conformance checks, an external plugin example
   - [ ] Format options (e.g. forced delimiter) as part of a recipe
4. **Integration examples and accurate docs**
   - [x] Reproducible benchmark (`pnpm bench`), runtime smoke test on Node, Bun and Deno
   - [ ] Examples for Next.js, Remix and a queue worker
5. **Richer mapping and correction**
   - [x] **Imports in a Web Worker** (`@openimport/worker`), optionally only above a file size
   - [ ] **Undo / redo** in the review step
   - [ ] **Schema changes**: re-map saved recipes when fields are added, renamed or removed
   - [ ] Bulk fixes: "apply this fix to all 37 similar cells"
   - [ ] Extra columns kept as custom fields
   - [ ] Conditional fields (`requiredIf`) and upsert mode (create / update / skip per row)
   - [ ] More locales; more formats (`.xls`, `.ods`, Parquet) only after the above

## Explicitly out of scope

OpenImport is a library you embed, not a data platform. It won't ship hosted storage, user management, dashboards, workflow automation or a SaaS backend. Those belong in your application, and the plugin and event APIs are there so you can build them on top.
