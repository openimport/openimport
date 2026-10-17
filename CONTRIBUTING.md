# Contributing to OpenImport

Thanks for helping! Bug reports, docs fixes, new format plugins and UX improvements are all welcome.

## Setup

```bash
corepack enable          # uses the pnpm version pinned in package.json
pnpm install
pnpm dev                 # playground on http://localhost:5173
```

Requires Node ≥ 20.19 (see `.nvmrc`).

## Repository layout

```
packages/
  core     headless engine (zero dependencies)
  react    hooks & context
  ui       ready-made importer + styles.css
  csv xlsx json xml   format plugins
  ai       bring-your-own-model matcher
apps/web              landing (/), docs (/docs/) and playground (/playground/)
examples/             runnable examples (node-headless, …)
docs/                 the docs site content (Markdown, rendered at /docs/)
```

Packages resolve each other through the `@openimport/source` export condition, so the playground and tests run straight from TypeScript sources without building.

## Checks

```bash
pnpm test            # vitest (node + happy-dom projects)
pnpm typecheck       # tsc per package
pnpm lint            # biome — `pnpm format` fixes most issues
pnpm build           # tsdown
pnpm check:packages  # publint on the packed packages
pnpm bench           # per-stage timings on a generated 50k-row CSV
pnpm smoke           # build, then run one import against the built packages (CI also runs it on Bun and Deno)
pnpm e2e             # Playwright against the production playground: main thread, worker and auto mode
pnpm e2e:perf        # how long the page is blocked, main thread vs worker (THROTTLE=4 for a slower CPU)
```

CI runs all of these on every pull request.

## Guidelines

- **Keep the core dependency-free and framework-agnostic.** Anything browser- or React-specific belongs in `react`/`ui`; heavy parsers belong in plugins.
- **Mappings stay declarative.** New transforms are `TransformDefinition`s with JSON params, not functions in recipes.
- **Test behaviour, not implementation.** Most core features are best tested through a session (`createImporter` + `sourceFromString`).
- **One rule, two entry points.** Anything that decides whether a row is valid or allowed belongs in `packages/core/src/execution.ts`, so the session and `run()` agree. Add a test for both paths.
- **Formats pass the conformance checks** in `@openimport/core/testing`.
- **UI changes:** check light and dark mode, keyboard navigation, and the German locale (long words!). Screenshots in the PR help a lot.
- **User-facing strings** go into `packages/ui/src/i18n.ts` (both `en` and `de`).

## Changesets

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Pick the affected packages and a semver bump, and describe the change from a user's perspective. Releases are cut automatically from `main` by the release workflow.

## Commit style

Conventional Commits are appreciated (`feat(ui): …`, `fix(csv): …`) but not enforced.
