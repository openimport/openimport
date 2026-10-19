---
"@openimport/core": minor
---

`fromJsonSchema(json, { validate, exclude, fields })` uses a plain JSON Schema (an OpenAPI request body, a `.schema.json` file) as the importer's schema. Pass a compiled validator such as `ajv.compile(schema)` to check each record against the whole schema; its errors land on the matching fields. Lists of objects can't come from a flat file: `fromJsonSchema` names them and asks to `exclude` them, and zod / valibot / arktype schemas now leave them out with a warning instead of producing a broken text field. Exclusive bounds are translated exactly for integers and no longer treated as inclusive. Passing a plain JSON Schema straight to `createImporter` now explains how to wrap it.
