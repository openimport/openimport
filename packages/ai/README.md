# @openimport/ai

AI column matching for [OpenImport](../../README.md), with **bring-your-own-model**. This package has no runtime dependencies and no hosted service. It turns the schema and columns into a prompt, hands that prompt to a `generate` function you write, and validates whatever comes back.

The model can do things the fuzzy matcher can't:

- match by meaning across languages (`Kontakt` → `email`, `Anrede` → `salutation`)
- read sample values (a column of `@` addresses is an email column, whatever its header says)
- propose **transforms**, such as splitting `Full name` into `firstName` / `lastName` or joining `Street` + `No.`

Suggestions go through the same pipeline as every other matcher. Users see them as suggestions in the mapping UI and can change them before importing.

```sh
pnpm add @openimport/ai
```

## Usage

```ts
import { createImporter } from '@openimport/core'
import { csv } from '@openimport/csv'
import { aiMatching } from '@openimport/ai'

const importer = createImporter({
  schema,
  plugins: [
    csv(),
    aiMatching({
      // Call YOUR backend. Never put an API key in the browser.
      generate: async ({ system, prompt, signal }) => {
        const res = await fetch('/api/openimport/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ system, prompt }),
          signal,
        })
        if (!res.ok) throw new Error(`AI matching failed: ${res.status}`)
        return res.text()
      },
      timeoutMs: 15_000,
    }),
  ],
})
```

`generate` is provider-agnostic: it takes `{ system, prompt, signal }` and returns the model's raw text. Point it at any model (Claude, a local model, your gateway).

### Server: Claude with the Anthropic SDK

A Next.js route handler (App Router). The same code works in Hono, Express or a worker: build the request the same way and return the text.

```ts
// app/api/openimport/match/route.ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic() // reads ANTHROPIC_API_KEY on the server

export async function POST(req: Request) {
  // Authenticate the caller here: an unauthenticated endpoint is an open LLM proxy.
  const { system, prompt } = (await req.json()) as { system: string; prompt: string }
  if (typeof system !== 'string' || typeof prompt !== 'string' || prompt.length > 50_000) {
    return new Response('Bad request', { status: 400 })
  }

  const response = await client.beta.messages.create(
    {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      // Column matching is a classification-style task: low effort is fast and cheap.
      output_config: { effort: 'low' },
      // If a safety classifier declines, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: prompt }],
    },
    { signal: req.signal },
  )

  // A declined request has no usable content. An empty answer makes OpenImport fall back to fuzzy matching.
  if (response.stop_reason === 'refusal') return new Response('{"matches":[]}')

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
  return new Response(text, { headers: { 'content-type': 'application/json' } })
}
```

## Privacy

By default the prompt contains **up to 5 sample values per column**, because they improve matching a lot. If your users' data must not reach a model, turn them off. The model then sees only headers, inferred types and your schema:

```ts
aiMatching({ generate, includeSamples: false })
```

Samples are truncated to 60 characters. The prompt never contains complete rows.

## Options

| Option           | Default | Description                                                                                       |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `generate`       | —       | `({ system, prompt, signal }) => Promise<string>`. Required.                                       |
| `priority`       | `10`    | Matcher priority. The built-in fuzzy matcher has `0`. On equal confidence the higher priority wins. |
| `minConfidence`  | `0.5`   | Suggestions below this are dropped.                                                               |
| `maxSamples`     | `5`     | Sample values per column sent to the model.                                                       |
| `includeSamples` | `true`  | Send sample values at all.                                                                        |
| `transforms`     | `true`  | Let the model propose transform pipelines (`split`, `join`, `template`, …).                        |
| `timeoutMs`      | —       | Give up after this long and use the other matchers' suggestions.                                  |

Suggestions at or above the importer's `autoMapThreshold` (default `0.7`) are applied automatically. The others stay in `state.suggestions`.

## Robustness

The model's answer is never trusted as is:

- JSON is pulled out of ```` ```json ```` fences or surrounding prose. Bare arrays are accepted too.
- Unknown target fields, unknown columns and already-mapped fields are dropped. Columns can be referenced by key or by label.
- Confidence is clamped to `0…1`, and duplicate targets keep the most confident entry.
- Transform steps must use a built-in op (`join`, `template`, `coalesce`, `split`, `trim`, `lowercase`, `uppercase`, `titlecase`, `replace`, `extract`, `prefix`) with primitive params. Invalid steps are removed, and each removal halves the suggestion's confidence.
- Errors, timeouts and garbage answers return no suggestions and log a `console.warn`. The import keeps working with fuzzy matching.

## Lower-level API

```ts
import { aiMatcher, buildMatchPrompt, parseMatchResponse } from '@openimport/ai'

aiMatcher(options) // a Matcher, for when you compose plugins yourself
buildMatchPrompt(ctx, { includeSamples, maxSamples, transforms }) // → { system, prompt }
parseMatchResponse(text, ctx, { transforms, minConfidence }) // → MatchSuggestion[]
```

`buildMatchPrompt` is deterministic, and its `system` part never changes. That makes it easy to cache and to snapshot-test.
