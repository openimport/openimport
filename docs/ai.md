---
title: AI matching
description: Let a model map the columns the fuzzy matcher can't.
---

```bash
npm i @openimport/ai
```

`@openimport/ai` builds a prompt from your schema and the file's columns, sends it to a function you write, and checks the answer. It has no dependencies and no hosted service.

---

## Where it fits

Mapping a file happens in three steps:

1. **Recipe.** A mapping saved earlier is applied if it fits the file's headers.
2. **Matchers.** Each matcher suggests `{ field, column, confidence }`. The built-in fuzzy matcher compares header names, synonyms and sample values. The AI matcher is one more matcher.
3. **Assignment.** The best suggestions win, one column per field. Suggestions above `autoMapThreshold` (0.7) are applied; the user reviews the rest.

The fuzzy matcher handles headers like `E-Mail`, `Vorname` or `PLZ`. A model helps where the header doesn't say what the column is: `Kontakt` full of email addresses, `KDNR`, `Spalte 7`, or a `Name` column that has to be split into first and last name.

The AI matcher sends the field descriptions, the column headers and up to five sample values per column. Columns, fields and transforms the model invents are dropped. If the call fails, the import continues with the fuzzy matches.

For a model that answers structured questions instead of text, write a matcher directly. [`examples/jev-matcher`](https://github.com/openimport/openimport/tree/main/examples/jev-matcher) does this with TypeSafe's Jev and prints the request it sends, which is a quick way to see what an AI matcher gets to work with.

---

## Setup

```ts
import { aiMatching } from '@openimport/ai'

createImporter({
  schema,
  plugins: [
    csv(),
    aiMatching({
      generate: ({ system, prompt, signal }) =>
        fetch('/api/match-columns', { method: 'POST', body: JSON.stringify({ system, prompt }), signal }).then((r) => r.text()),
    }),
  ],
})
```

Call the model from your server so API keys never reach the browser.

---

## What it can suggest

Plain matches, and transforms such as splitting "Full name" into first and last name, or joining street and house number. Unknown fields, columns and transform ops in the answer are dropped.

---

## Options

| Option | Default | |
|---|---|---|
| `includeSamples` | `true` | send a few values per column; set `false` to send headers only |
| `maxSamples` | `5` | values per column |
| `minConfidence` | `0.5` | drop weaker suggestions |
| `priority` | `10` | ranks above the fuzzy matcher |
| `timeoutMs` | – | give up and fall back to fuzzy matching |

If the call fails or times out, the import continues with the fuzzy matcher.
