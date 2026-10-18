---
"@openimport/core": minor
"@openimport/react": minor
"@openimport/ui": minor
"@openimport/worker": minor
---

Custom fields. With `customFields: true` (or options for types, maximum, groups and a `check` hook), users can add columns the schema doesn't have as typed, validated fields during mapping. Values arrive in `record.$custom`, apart from the typed record and outside Standard Schema validation; `onSubmit` batches and `run()` chunks also list the field definitions. Custom fields are saved with recipes and restored for matching files, including in `run()`. New session methods: `addCustomField`, `removeCustomField`, `suggestCustomField`; worker sessions support them too. The mapping step's type labels are now translated.
