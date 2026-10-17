# @openimport/csv

Zero-dependency CSV / TSV format plugin for [OpenImport](../../README.md).

- Streaming RFC 4180 parser on Web Streams — same code in browsers, workers, Node ≥ 20, Bun and Deno
- Quoted fields with delimiters, line breaks and `""` escapes; CRLF / LF / CR; ragged rows
- Encoding detection: BOM (UTF-8, UTF-16 LE/BE), strict UTF-8, fallback to **windows-1252** (Excel on Windows)
- Delimiter sniffing for `,` `;` `\t` `|`, quote-aware
- Cheap row-count estimate for large files

```ts
import { createImporter } from '@openimport/core'
import { csv } from '@openimport/csv'

const importer = createImporter({ schema, plugins: [csv()] })
```

## Options

| Option      | Default      | Description                                                 |
| ----------- | ------------ | ----------------------------------------------------------- |
| `delimiter` | sniffed      | Force `,` `;` `\t` `\|` or any single character             |
| `encoding`  | detected     | Any WHATWG encoding label, e.g. `iso-8859-15`               |
| `quote`     | `"`          | Quote character                                             |
| `chunkSize` | `1000`       | Rows per yielded chunk                                      |
| `extensions`| —            | Additional file extensions to accept                        |

## Low-level API

```ts
import { createCsvParser, parseCsv, sniffDelimiter, detectEncoding } from '@openimport/csv'

parseCsv('a;b\n1;2') // [['a', 'b'], ['1', '2']]

const parser = createCsvParser({ delimiter: ',' })
parser.push('id,name\n1,"Ann') // [['id', 'name']]
parser.push('e"\n')             // [['1', 'Anne']]
parser.flush()                  // []
```

`createCsvParser` accepts text split at any position — inside quotes, between
`\r` and `\n`, or between an escaped `""` pair. Blank lines produce `[]`, so row
indices keep matching file lines.
