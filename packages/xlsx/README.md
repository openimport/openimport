# @openimport/xlsx

Excel workbook (`.xlsx`, `.xlsm`) format plugin for [OpenImport](../../README.md), built on
[`read-excel-file`](https://www.npmjs.com/package/read-excel-file).

- Every non-empty sheet becomes a dataset the user can pick
- Dates arrive as `Date`, numbers and booleans keep their type
- Trailing empty rows and cells are trimmed; title rows above the header are handled by the core's header detection
- Legacy `.xls` files are rejected with a clear "save as .xlsx" message

```ts
import { createImporter } from '@openimport/core'
import { xlsx } from '@openimport/xlsx'

const importer = createImporter({ schema, plugins: [xlsx()] })
```

## Options

| Option               | Default | Description                         |
| -------------------- | ------- | ----------------------------------- |
| `trim`               | `true`  | Trim whitespace around string cells |
| `includeEmptySheets` | `false` | List sheets without data            |
| `chunkSize`          | `1000`  | Rows per yielded chunk              |

The workbook is parsed in memory once and shared between `inspect()` and `read()`.
