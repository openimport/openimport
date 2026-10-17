# Security Policy

OpenImport parses untrusted files in your users' browsers (and possibly on your servers), so we take parser robustness seriously.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/openimport/openimport/security/advisories/new) instead. We aim to acknowledge reports within 3 business days.

## Scope notes

- The core never evaluates user-provided code: recipes and transforms are declarative JSON. Custom transforms are code *you* register.
- `regex` options in `replace` / `extract` transforms and field `pattern`s are compiled with `new RegExp`. If you accept recipes from untrusted sources, validate them to avoid ReDoS patterns.
- The AI plugin sends column names (and, unless `includeSamples: false`, sample values) to the model endpoint you configure.
- Use `maxFileSize` / `maxRows` to bound resource usage.
