# Example: a third-party plugin

A complete OpenImport plugin built only on public APIs: a streaming fixed-width format and an `iban` transform. Copy it as a starting point for your own.

- `src/index.ts` is the plugin.
- `test/fixed-width.test.ts` runs the conformance checks from `@openimport/core/testing` and imports a file end to end.

```bash
pnpm vitest run examples/fixed-width-plugin
```
