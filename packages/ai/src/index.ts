import {
  builtinTransforms,
  checkTransformStep,
  type FieldDefinition,
  type ImportPlugin,
  type MatchContext,
  type Matcher,
  type MatchSuggestion,
  type SourceField,
  stringify,
  type TransformDefinition,
  type TransformStep,
} from '@openimport/core'

export interface GenerateRequest {
  /** Stable instructions — cache-friendly, identical across calls. */
  system: string
  /** The schema + columns for this file. */
  prompt: string
  signal: AbortSignal
}

/**
 * Calls your model and returns its raw text answer. Run the actual LLM call on
 * your server — API keys must never ship to the browser.
 */
export type Generate = (request: GenerateRequest) => Promise<string>

export interface AiMatcherOptions {
  generate: Generate
  /** Matchers run in priority order; the fuzzy matcher has priority 0. Default `10`. */
  priority?: number
  /** Drop suggestions below this confidence. Default `0.5`. */
  minConfidence?: number
  /** Sample values per column sent to the model. Default `5`. */
  maxSamples?: number
  /** Send sample values to the model. Disable when data must not leave your app. Default `true`. */
  includeSamples?: boolean
  /** Let the model propose transforms (split, join, template, …). Default `true`. */
  transforms?: boolean
  /** Give up (and fall back to the other matchers) after this many ms. */
  timeoutMs?: number
}

export type PromptOptions = Pick<AiMatcherOptions, 'maxSamples' | 'includeSamples' | 'transforms'>

const MAX_SAMPLE_LENGTH = 60
const MAX_REASON_LENGTH = 200
/** Transforms the model may use: everything registered (built-ins and plugins), falling back to the built-ins. */
const available = (ctx: { transforms?: TransformDefinition[] }) => (ctx.transforms?.length ? ctx.transforms : builtinTransforms)

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = `You map the columns of an uploaded file (CSV, spreadsheet, JSON, XML) to the fields of a target schema.
Match by meaning, not just by spelling: consider column names in any language, abbreviations and the sample values.
Only propose a match when you are reasonably sure. Leave a field out instead of guessing.
Respond with a single JSON object and nothing else.`

function unmappedFields(ctx: MatchContext): FieldDefinition[] {
  return ctx.schema.fields.filter((f) => !ctx.mapping[f.key])
}

function describeField(f: FieldDefinition): Record<string, unknown> {
  return {
    key: f.key,
    label: f.label,
    type: f.multiple ? `${f.type}[]` : f.type,
    ...(f.required ? { required: true } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.aliases?.length ? { aliases: f.aliases } : {}),
    ...(f.options?.length ? { options: f.options.map((o) => o.value) } : {}),
  }
}

function describeColumn(c: SourceField, options: PromptOptions): Record<string, unknown> {
  const out: Record<string, unknown> = { key: c.key, label: c.label, type: c.inferredType }
  if (options.includeSamples !== false) {
    out.samples = c.samples.slice(0, options.maxSamples ?? 5).map((v) => {
      const s = stringify(v)
      return s.length > MAX_SAMPLE_LENGTH ? `${s.slice(0, MAX_SAMPLE_LENGTH)}…` : s
    })
  }
  return out
}

function describeTransforms(transforms: TransformDefinition[]): string {
  return transforms
    .map((t) => {
      const params = (t.params ?? []).map((p) => `${p.name}: ${p.type}`).join(', ')
      const inputs = t.arity === 'many' ? 'several columns → one value' : 'one value → one value'
      return `- ${t.op}${params ? ` { ${params} }` : ''} (${inputs})${t.description ? `: ${t.description}` : ''}`
    })
    .join('\n')
}

/** Build the system + user prompt for a match request. Deterministic for the same input. */
export function buildMatchPrompt(
  ctx: Pick<MatchContext, 'schema' | 'sourceFields' | 'mapping'> & { transforms?: TransformDefinition[] },
  options: PromptOptions = {},
): { system: string; prompt: string } {
  const fields = unmappedFields(ctx as MatchContext)
  const lines: string[] = []
  lines.push('Target fields (one JSON object per line):')
  for (const f of fields) lines.push(JSON.stringify(describeField(f)))
  lines.push('', 'Source columns (one JSON object per line):')
  for (const c of ctx.sourceFields) lines.push(JSON.stringify(describeColumn(c, options)))

  const used = Object.values(ctx.mapping).flatMap((m) => m.sources)
  if (used.length) {
    lines.push('', `Columns already used by other fields (avoid unless needed for a split): ${JSON.stringify([...new Set(used)])}`)
  }

  if (options.transforms !== false) {
    lines.push(
      '',
      'Optional transforms, applied in order before type conversion. Use them when a field needs part of a column',
      '(e.g. split "Full name" into first and last name) or several columns combined (e.g. join street and house number):',
      describeTransforms(available(ctx)),
      'A transform step is an object like {"op":"split","separator":" ","index":0}. "index" may be negative (from the end).',
    )
  }

  lines.push(
    '',
    'Answer with JSON in exactly this shape:',
    options.transforms !== false
      ? '{"matches":[{"target":"<field key>","sources":["<column key>"],"confidence":0.0,"transforms":[],"reason":"<short>"}]}'
      : '{"matches":[{"target":"<field key>","sources":["<column key>"],"confidence":0.0,"reason":"<short>"}]}',
    'Rules:',
    '- "target" must be one of the field keys above; "sources" must be column keys above.',
    '- Use at most one match per target field. A column may feed several fields only through transforms.',
    '- "confidence" is between 0 and 1. Omit fields you cannot match.',
  )
  return { system: SYSTEM, prompt: lines.join('\n') }
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      // Prose around the JSON: take the outermost object / array.
      for (const [open, close] of [
        ['{', '}'],
        ['[', ']'],
      ] as const) {
        const start = trimmed.indexOf(open)
        const end = trimmed.lastIndexOf(close)
        if (start >= 0 && end > start) {
          try {
            return JSON.parse(trimmed.slice(start, end + 1))
          } catch {
            // try the next shape
          }
        }
      }
    }
  }
  return undefined
}

const isPrimitive = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

function parseTransforms(raw: unknown, transforms: TransformDefinition[]): { steps: TransformStep[]; dropped: number } {
  const byOp = new Map(transforms.map((t) => [t.op, t]))
  if (!Array.isArray(raw)) return { steps: [], dropped: raw === undefined || raw === null ? 0 : 1 }
  const steps: TransformStep[] = []
  let dropped = 0
  for (const item of raw) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as { op?: unknown }).op !== 'string' ||
      !byOp.has((item as { op: string }).op)
    ) {
      dropped++
      continue
    }
    const step: TransformStep = { op: (item as { op: string }).op }
    for (const [k, v] of Object.entries(item)) if (k !== 'op' && isPrimitive(v)) step[k] = v
    // Same parameter check the core applies to recipes.
    if (checkTransformStep(byOp.get(step.op) as TransformDefinition, step)) {
      dropped++
      continue
    }
    steps.push(step)
  }
  return { steps, dropped }
}

/**
 * Parse and validate a model answer. Unknown targets / columns and unknown
 * transform ops are dropped, confidences clamped, duplicates removed (best wins).
 */
export function parseMatchResponse(
  text: string,
  ctx: Pick<MatchContext, 'schema' | 'sourceFields' | 'mapping'> & { transforms?: TransformDefinition[] },
  options: Pick<AiMatcherOptions, 'transforms' | 'minConfidence'> = {},
): MatchSuggestion[] {
  const json = extractJson(text)
  const list: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { matches?: unknown })?.matches)
      ? (json as { matches: unknown[] }).matches
      : []
  const targets = new Set(unmappedFields(ctx as MatchContext).map((f) => f.key))
  const byKey = new Map(ctx.sourceFields.map((f) => [f.key, f.key]))
  const byLabel = new Map(ctx.sourceFields.map((f) => [f.label.trim().toLowerCase(), f.key]))
  const resolve = (s: unknown) => (typeof s === 'string' ? (byKey.get(s) ?? byLabel.get(s.trim().toLowerCase())) : undefined)

  const best = new Map<string, MatchSuggestion>()
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.target !== 'string' || !targets.has(e.target)) continue
    const rawSources = Array.isArray(e.sources) ? e.sources : e.source !== undefined ? [e.source] : []
    const sources = rawSources.map(resolve)
    if (!sources.length || sources.some((s) => s === undefined)) continue
    let confidence = typeof e.confidence === 'number' ? e.confidence : typeof e.confidence === 'string' ? Number(e.confidence) : 0.5
    if (!Number.isFinite(confidence)) confidence = 0.5
    confidence = Math.min(1, Math.max(0, confidence))

    const suggestion: MatchSuggestion = { target: e.target, sources: [...new Set(sources as string[])], confidence }
    if (options.transforms !== false) {
      const { steps, dropped } = parseTransforms(e.transforms, available(ctx))
      if (steps.length) suggestion.transforms = steps
      // A missing step changes what the mapping means — trust it less.
      if (dropped) suggestion.confidence = Math.round(confidence * 0.5 ** dropped * 100) / 100
    }
    if (typeof e.reason === 'string' && e.reason.trim()) suggestion.reason = `AI: ${e.reason.trim().slice(0, MAX_REASON_LENGTH)}`
    if (suggestion.confidence < (options.minConfidence ?? 0)) continue
    const previous = best.get(suggestion.target)
    if (!previous || suggestion.confidence > previous.confidence) best.set(suggestion.target, suggestion)
  }
  return [...best.values()]
}

// ─────────────────────────────────────────────────────────────────────────────
// Matcher & plugin
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs?: number): Promise<T> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(parent.reason)
  parent.addEventListener('abort', onAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new DOMException('Aborted', 'AbortError')), {
      once: true,
    })
  })
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => controller.abort(new DOMException(`AI matching timed out after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs)
  }
  // Race so a `generate` that ignores the signal can't hold up the import.
  return Promise.race([run(controller.signal), aborted]).finally(() => {
    clearTimeout(timer)
    parent.removeEventListener('abort', onAbort)
  })
}

/** A matcher that asks your LLM to map columns. Failures never break the import. */
export function aiMatcher(options: AiMatcherOptions): Matcher {
  const { generate, priority = 10, minConfidence = 0.5, timeoutMs } = options
  return {
    id: 'ai',
    priority,
    match: async (ctx) => {
      if (ctx.signal.aborted || !ctx.sourceFields.length || !unmappedFields(ctx).length) return []
      const { system, prompt } = buildMatchPrompt(ctx, options)
      try {
        const text = await withTimeout((signal) => generate({ system, prompt, signal }), ctx.signal, timeoutMs)
        return parseMatchResponse(text, ctx, { transforms: options.transforms, minConfidence })
      } catch (error) {
        if (!ctx.signal.aborted) console.warn('[openimport/ai] AI matching failed, falling back to other matchers:', error)
        return []
      }
    },
  }
}

/**
 * Plugin wrapper around {@link aiMatcher}.
 *
 * @example
 * createImporter({ schema, plugins: [csv(), aiMatching({ generate: (req) => callMyBackend(req) })] })
 */
export function aiMatching(options: AiMatcherOptions): ImportPlugin {
  return { name: 'ai', matchers: [aiMatcher(options)] }
}
