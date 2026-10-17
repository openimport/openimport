/**
 * An AI column matcher on TypeSafe's Jev.
 *
 * How OpenImport maps columns, and where this plugin fits:
 *
 *   1. A saved recipe is applied, if one fits the file's headers.
 *   2. Every matcher suggests { target field, source column, confidence }.
 *      The built-in fuzzy matcher compares header names, synonyms and sample values.
 *      This plugin adds a second matcher.
 *   3. OpenImport takes the best suggestions, one column per field, and
 *      auto-applies those above `autoMapThreshold` (0.7). The user reviews the rest.
 *
 * This matcher only asks Jev about fields the fuzzy matcher isn't sure of. Each
 * becomes a *choice* question whose options are the file's actual column keys
 * plus "none", so Jev can't invent a column, and every answer arrives with a
 * probability per option. That probability becomes the suggestion's confidence.
 */
import {
  definePlugin,
  type FieldDefinition,
  fuzzyMatcher,
  type ImportPlugin,
  type MatchContext,
  type MatchSuggestion,
  type SourceField,
} from '@openimport/core'
import { type ChoiceCriteria, type ChoiceQuestion, type ChoiceResponse, choice, type JsonValue, TypeSafeClient } from '@typesafe-ai/sdk'

/** The option for "no column in this file belongs to the field". */
export const NONE = '__none__'

/** The part of the TypeSafe client this matcher uses (a fake in tests). */
export type JevClient = Pick<TypeSafeClient, 'systemOne'>

export interface JevMatcherOptions {
  /** Defaults to a `TypeSafeClient` reading `TYPESAFE_API_KEY`. Call Jev from a server: the key must not reach the browser. */
  client?: JevClient
  model?: string
  /** Skip fields the fuzzy matcher already matches at least this well. Default 0.9. */
  skipAbove?: number
  /** Drop answers below this probability. Default 0.5. */
  minProbability?: number
  /** Sample values per column sent to Jev. 0 sends headers only. Default 5. */
  maxSamples?: number
  /** Ranks Jev's answers above fuzzy matches of similar confidence. Default 10. */
  priority?: number
}

export interface JevRequest {
  state: Record<string, JsonValue>
  questions: Record<string, ChoiceQuestion<ChoiceCriteria>>
  /** Question name → target field key. */
  fields: Map<string, string>
}

/** Fields worth asking about: not mapped yet, and not an obvious fuzzy match. */
export async function fieldsToAsk(ctx: MatchContext, skipAbove = 0.9): Promise<FieldDefinition[]> {
  const fuzzy = await fuzzyMatcher().match(ctx)
  const best = new Map<string, number>()
  for (const s of fuzzy) best.set(s.target, Math.max(best.get(s.target) ?? 0, s.confidence))
  return ctx.schema.fields.filter((f) => !ctx.mapping[f.key] && (best.get(f.key) ?? 0) < skipAbove)
}

/** Build the one request Jev answers. Exported so you can print it (see `demo.ts`). */
export function buildJevRequest(ctx: MatchContext, fields: FieldDefinition[], options: JevMatcherOptions = {}): JevRequest {
  const maxSamples = options.maxSamples ?? 5
  // What Jev reads once and answers every question against.
  const state = {
    task: 'A user uploaded a spreadsheet. Each question decides which column of the file holds the values for one field of the target schema.',
    columns: ctx.sourceFields.map((c: SourceField) => ({
      key: c.key,
      header: c.label,
      type: c.inferredType,
      ...(maxSamples > 0 ? { samples: c.samples.slice(0, maxSamples).map(String) } : {}),
    })),
  }
  // The options are the column keys, so every answer is a real column (or none).
  const criteria: ChoiceCriteria = {}
  for (const c of ctx.sourceFields) criteria[c.key] = null
  criteria[NONE] = 'No column in this file holds this field.'

  const questions: JevRequest['questions'] = {}
  const names = new Map<string, string>()
  fields.forEach((field, i) => {
    const name = `field_${i}`
    names.set(name, field.key)
    questions[name] = choice(
      {
        target_field: {
          key: field.key,
          label: field.label,
          type: field.type,
          ...(field.description ? { description: field.description } : {}),
          ...(field.options?.length ? { allowed_values: field.options.map((o) => o.value) } : {}),
        },
        question:
          'Which column holds the values for `target_field`? Judge by what the values mean, not by how similar the header looks. Choose `__none__` if no column fits.',
      },
      criteria,
    )
  })
  return { state: state as Record<string, JsonValue>, questions, fields: names }
}

/** Turn Jev's answers into suggestions OpenImport can rank against the fuzzy matcher's. */
export function toSuggestions(
  request: JevRequest,
  answers: Record<string, ChoiceResponse<ChoiceCriteria> | undefined>,
  minProbability = 0.5,
): MatchSuggestion[] {
  const out: MatchSuggestion[] = []
  for (const [name, target] of request.fields) {
    const answer = answers[name]
    if (!answer || answer.choice === NONE) continue
    const probability = answer.probabilities[answer.choice] ?? 0
    if (probability < minProbability) continue
    out.push({
      target,
      sources: [answer.choice],
      confidence: Math.round(probability * 100) / 100,
      reason: `Jev: ${Math.round(probability * 100)}%`,
    })
  }
  return out
}

export function jevMatcher(options: JevMatcherOptions = {}): ImportPlugin {
  let client = options.client
  return definePlugin({
    name: 'jev',
    matchers: [
      {
        id: 'jev',
        priority: options.priority ?? 10,
        match: async (ctx) => {
          const fields = await fieldsToAsk(ctx, options.skipAbove)
          if (!fields.length || !ctx.sourceFields.length) return []
          const request = buildJevRequest(ctx, fields, options)
          client ??= new TypeSafeClient()
          // If this throws (network, quota, timeout), OpenImport logs it and keeps the fuzzy suggestions.
          const response = await client.systemOne({
            state: request.state,
            questions: request.questions,
            ...(options.model ? { model: options.model } : {}),
          })
          return toSuggestions(request, response.answers as Record<string, ChoiceResponse<ChoiceCriteria>>, options.minProbability)
        },
      },
    ],
  })
}
