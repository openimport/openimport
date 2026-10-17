# Jev column matcher

An AI matcher for OpenImport built on [TypeSafe's Jev](https://www.npmjs.com/package/@typesafe-ai/sdk). It's an example of how AI fits into column matching, not a published package.

```bash
pnpm --filter @openimport/example-jev-matcher demo                    # fuzzy matching + the request Jev would get
TYPESAFE_API_KEY=… pnpm --filter @openimport/example-jev-matcher demo # and Jev's answers
```

## Where AI fits

When a file is loaded, OpenImport maps its columns in three steps:

1. **Recipe.** A mapping the user saved before is applied if it fits the headers.
2. **Matchers.** Each matcher suggests `{ field, column, confidence }`. The built-in fuzzy matcher compares header names, synonyms (`Vorname` → first name) and sample values. AI plugins are more matchers.
3. **Assignment.** The best suggestions win, one column per field. Suggestions above 0.7 are applied; the user reviews and changes the rest in the mapping step.

An AI matcher doesn't replace anything. It adds suggestions for the fields the fuzzy matcher couldn't match.

## What this file shows

The demo's CRM export has headers a person understands but a string comparison doesn't:

| Field | Column | Fuzzy | Why |
|---|---|---|---|
| First name, Last name, Phone, Company | `Vorname`, `Nachname`, `Mobil`, `Firma` | ✓ | in the synonym dictionary |
| Email | `Kontakt` | — | the header doesn't say "email", the values do |
| Customer number | `KDNR` | — | an abbreviation |
| Status | `Spalte 7` | — | only the values (`Bestandskunde`, `Interessent`) say what it is |
| Signup date | `seit` | — | "since" |

The matcher runs the fuzzy matcher first and asks Jev only about the four it missed. All four go out in **one request**:

- `state`: the file's columns, with header, detected type and a few sample values.
- `questions`: one `choice` per field. The options are the column keys plus `__none__`, so Jev can only answer with a column that exists.

Jev answers every question with a probability per option. The best option becomes a suggestion with that probability as its confidence. `__none__` and answers below `minProbability` are dropped. If the request fails, the import continues with the fuzzy matches.

## Jev or `@openimport/ai`?

| | `@openimport/ai` | A matcher like this one |
|---|---|---|
| For | chat and text models (OpenAI, Anthropic, local models) | models with structured answers, like Jev |
| You provide | `generate(prompt) → text` | `match(context) → suggestions` |
| The plugin | writes the prompt, parses the JSON answer, drops invalid columns | builds closed questions; answers can't name a column that doesn't exist |
| Can also suggest | transforms: split "Full name", join street and number | columns only (a second question could add value maps) |

Both run on your server in production: the API key must not reach the browser. In the browser, `generate` or the matcher calls your endpoint, which calls the model.

## Files

- `src/index.ts`: the matcher. `fieldsToAsk`, `buildJevRequest` and `toSuggestions` are separate so you can inspect each step.
- `src/demo.ts`: the walkthrough above.
- `test/`: runs against a fake Jev, so the tests need no API key.
