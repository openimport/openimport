import { type CustomField, parseCustomField } from './custom-fields'
import { importError } from './errors'
import { checkTransformStep, type TransformRegistry } from './transforms'
import type { FieldMapping, Mapping, Recipe, RecipeStore, SourceField, TransformStep } from './types'
import { createId, isSafePath } from './utils'

const norm = (s: string) => s.trim().toLowerCase()

/** Snapshot the current mapping as a portable recipe (sources are stored by label). */
export function createRecipe(
  mapping: Mapping,
  sourceFields: SourceField[],
  meta: {
    id?: string
    name?: string
    schemaId?: string
    headerRow?: number
    dataset?: string
    format?: string
    createdAt?: string
    customFields?: CustomField[]
  } = {},
): Recipe {
  const labelOf = new Map(sourceFields.map((f) => [f.key, f.label]))
  const now = new Date().toISOString()
  const out: Mapping = {}
  for (const [target, m] of Object.entries(mapping)) {
    const { origin: _o, confidence: _c, ...rest } = m
    out[target] = { ...rest, sources: m.sources.map((k) => labelOf.get(k) ?? k) }
  }
  return {
    version: 1,
    id: meta.id ?? createId('recipe'),
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.schemaId ? { schemaId: meta.schemaId } : {}),
    createdAt: meta.createdAt ?? now,
    updatedAt: now,
    sourceLabels: sourceFields.map((f) => f.label),
    ...(meta.headerRow !== undefined ? { headerRow: meta.headerRow } : {}),
    ...(meta.dataset ? { dataset: meta.dataset } : {}),
    ...(meta.format ? { format: meta.format } : {}),
    ...(meta.customFields?.length ? { customFields: meta.customFields } : {}),
    mapping: out,
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/**
 * Validate a recipe from an untrusted source (storage, an API, a user upload)
 * and return a clean copy. Throws `invalid_recipe` with the first problem.
 * With a transform registry, every step is checked against its definition.
 */
export function parseRecipe(input: unknown, registry?: TransformRegistry): Recipe {
  const fail = (why: string): never => {
    throw importError('invalid_recipe', `Invalid recipe: ${why}`)
  }
  if (!isObject(input)) return fail('not an object')
  if (input.version !== 1) fail(`unsupported version ${String(input.version)}`)
  if (!isObject(input.mapping)) fail('"mapping" must be an object')
  if (input.sourceLabels !== undefined && !isStringArray(input.sourceLabels)) fail('"sourceLabels" must be a list of strings')
  if (input.headerRow !== undefined && !(Number.isInteger(input.headerRow) && (input.headerRow as number) >= 0))
    fail('"headerRow" must be a row index')
  for (const key of ['id', 'name', 'schemaId', 'dataset', 'format', 'createdAt', 'updatedAt']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') fail(`"${key}" must be a string`)
  }
  const mapping: Mapping = {}
  for (const [target, raw] of Object.entries(input.mapping as Record<string, unknown>)) {
    if (!isSafePath(target)) fail(`unsafe target "${target}"`)
    if (!isObject(raw)) fail(`"${target}" must be an object`)
    const m = raw as Record<string, unknown>
    if (!isStringArray(m.sources)) fail(`"${target}.sources" must be a list of column names`)
    const fm: FieldMapping = { sources: [...(m.sources as string[])] }
    if (m.transforms !== undefined) {
      if (!Array.isArray(m.transforms)) fail(`"${target}.transforms" must be a list`)
      fm.transforms = (m.transforms as unknown[]).map((step, i) => {
        if (!isObject(step) || typeof step.op !== 'string') return fail(`"${target}.transforms[${i}]" needs an "op"`)
        if (registry) {
          const def = registry.get(step.op)
          if (!def) fail(`"${target}" uses unknown transform "${step.op}"`)
          const problem = checkTransformStep(def as NonNullable<typeof def>, step as TransformStep)
          if (problem) fail(`"${target}": ${problem}`)
        }
        return { ...step } as TransformStep
      })
    }
    if (m.valueMap !== undefined) {
      if (!isObject(m.valueMap) || !Object.values(m.valueMap).every((v) => typeof v === 'string'))
        fail(`"${target}.valueMap" must map strings to strings`)
      fm.valueMap = Object.assign(Object.create(null), m.valueMap) as Record<string, string>
    }
    if (m.options !== undefined) {
      if (!isObject(m.options)) fail(`"${target}.options" must be an object`)
      const o = m.options as Record<string, unknown>
      if (o.dateOrder !== undefined && !['DMY', 'MDY', 'YMD'].includes(o.dateOrder as string))
        fail(`"${target}.options.dateOrder" must be DMY, MDY or YMD`)
      if (o.decimal !== undefined && o.decimal !== '.' && o.decimal !== ',') fail(`"${target}.options.decimal" must be "." or ","`)
      fm.options = { ...(o.dateOrder ? { dateOrder: o.dateOrder as 'DMY' } : {}), ...(o.decimal ? { decimal: o.decimal as '.' } : {}) }
    }
    if (m.fallback !== undefined) fm.fallback = m.fallback
    mapping[target] = fm
  }
  let customFields: CustomField[] | undefined
  if (input.customFields !== undefined) {
    if (!Array.isArray(input.customFields)) fail('"customFields" must be a list')
    customFields = (input.customFields as unknown[]).map(
      (raw, i) => parseCustomField(raw) ?? fail(`"customFields[${i}]" is not a valid custom field`),
    )
  }
  const now = new Date().toISOString()
  return {
    version: 1,
    id: (input.id as string | undefined) ?? createId('recipe'),
    createdAt: (input.createdAt as string | undefined) ?? now,
    updatedAt: (input.updatedAt as string | undefined) ?? now,
    sourceLabels: (input.sourceLabels as string[] | undefined) ?? [],
    mapping,
    ...(input.name ? { name: input.name as string } : {}),
    ...(input.schemaId ? { schemaId: input.schemaId as string } : {}),
    ...(input.headerRow !== undefined ? { headerRow: input.headerRow as number } : {}),
    ...(input.dataset ? { dataset: input.dataset as string } : {}),
    ...(input.format ? { format: input.format as string } : {}),
    ...(customFields?.length ? { customFields } : {}),
  }
}

/** How well a recipe fits the current source fields, 0…1. */
export function recipeFit(recipe: Recipe, sourceFields: SourceField[]): number {
  const labels = new Set(sourceFields.map((f) => norm(f.label)))
  const used = [...new Set(Object.values(recipe.mapping).flatMap((m) => m.sources.map(norm)))]
  if (!used.length) return 0
  const coverage = used.filter((l) => labels.has(l)).length / used.length
  const all = recipe.sourceLabels.map(norm)
  const union = new Set([...all, ...labels]).size
  const jaccard = union ? all.filter((l) => labels.has(l)).length / union : 0
  return coverage * 0.8 + jaccard * 0.2
}

/** The best fitting recipe (fit ≥ `threshold`), newest first on ties. */
export function findRecipe(recipes: Recipe[], sourceFields: SourceField[], threshold = 0.6): Recipe | undefined {
  let best: Recipe | undefined
  let bestFit = threshold
  for (const r of [...recipes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const fit = recipeFit(r, sourceFields)
    if (fit > bestFit + 1e-9 || (fit >= bestFit && !best)) {
      best = r
      bestFit = fit
    }
  }
  return best
}

/** Resolve a recipe against the current source fields. Mappings whose columns are missing are dropped. */
export function applyRecipe(recipe: Recipe, sourceFields: SourceField[], validTargets?: Set<string>): Mapping {
  const keyOf = new Map(sourceFields.map((f) => [norm(f.label), f.key]))
  const out: Mapping = {}
  for (const [target, m] of Object.entries(recipe.mapping)) {
    if (validTargets && !validTargets.has(target)) continue
    const keys = m.sources.map((l) => keyOf.get(norm(l)))
    if (keys.some((k) => k === undefined)) continue
    out[target] = { ...m, sources: keys as string[], origin: 'recipe' }
  }
  return out
}

export function memoryRecipeStore(initial: Recipe[] = []): RecipeStore {
  const recipes = new Map(initial.map((r) => [r.id, r]))
  return {
    list: (schemaId) => [...recipes.values()].filter((r) => !schemaId || !r.schemaId || r.schemaId === schemaId),
    save: (recipe) => void recipes.set(recipe.id, recipe),
    remove: (id) => void recipes.delete(id),
  }
}

/** Persist recipes in `localStorage` (falls back to memory when unavailable). */
export function localStorageRecipeStore(key = 'openimport:recipes', max = 50): RecipeStore {
  const memory = memoryRecipeStore()
  const storage = (() => {
    try {
      const s = globalThis.localStorage
      s.getItem(key)
      return s
    } catch {
      return undefined
    }
  })()
  if (!storage) return memory
  const read = (): Recipe[] => {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((r) => {
        try {
          return [parseRecipe(r)]
        } catch {
          return []
        }
      })
    } catch {
      return []
    }
  }
  const write = (list: Recipe[]) => {
    try {
      storage.setItem(key, JSON.stringify(list.slice(0, max)))
    } catch {
      // quota exceeded or blocked — recipes are a convenience, never fail the import
    }
  }
  return {
    list: (schemaId) => read().filter((r) => !schemaId || !r.schemaId || r.schemaId === schemaId),
    save: (recipe) => write([recipe, ...read().filter((r) => r.id !== recipe.id)]),
    remove: (id) => write(read().filter((r) => r.id !== id)),
  }
}

/**
 * Persist recipes in IndexedDB. Unlike localStorage it's available in Web
 * Workers too, so an import running in a worker finds the same recipes as one
 * on the page. Failures never break an import: they just mean no recipe.
 */
export function indexedDbRecipeStore(database = 'openimport', max = 50): RecipeStore {
  const STORE = 'recipes'
  let opened: Promise<IDBDatabase> | null = null
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(database, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }))
  const tx = async <R>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const store = (await db()).transaction(STORE, mode).objectStore(STORE)
    return new Promise<R>((resolve, reject) => {
      const req = run(store)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  const all = async (): Promise<Recipe[]> => {
    try {
      const rows = await tx('readonly', (s) => s.getAll() as IDBRequest<unknown[]>)
      return rows
        .flatMap((r) => {
          try {
            return [parseRecipe(r)]
          } catch {
            return []
          }
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch {
      return []
    }
  }
  return {
    list: async (schemaId) => (await all()).filter((r) => !schemaId || !r.schemaId || r.schemaId === schemaId),
    save: async (recipe) => {
      try {
        await tx('readwrite', (s) => s.put(recipe))
        const stale = (await all()).slice(max)
        for (const r of stale) await tx('readwrite', (s) => s.delete(r.id))
      } catch {
        // storage blocked or full: recipes are a convenience
      }
    },
    remove: async (id) => {
      try {
        await tx('readwrite', (s) => s.delete(id))
      } catch {
        // ignore
      }
    },
  }
}

/** The default store: IndexedDB where available (pages and workers), else localStorage, else memory. */
export function defaultRecipeStore(key?: string): RecipeStore {
  if (typeof indexedDB !== 'undefined') return indexedDbRecipeStore(key ?? 'openimport')
  return localStorageRecipeStore(key)
}
