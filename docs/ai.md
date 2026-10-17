---
title: AI matching
description: Let a model map the columns the fuzzy matcher can't.
---

```bash
npm i @openimport/ai
```

`@openimport/ai` builds a prompt from your schema and the file's columns, sends it to a function you write, and checks the answer. It has no dependencies and no hosted service.

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
