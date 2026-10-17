import { matchOption } from './coerce'
import type { FieldDefinition, FieldType, InferredType, Mapping, MatchContext, Matcher, MatchSuggestion, SourceField } from './types'
import { stringify } from './utils'

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

/** `"E-Mail Adresse"` → `["e", "mail", "adresse"]` */
export function tokenize(input: string): string[] {
  return input
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const compact = (s: string) => tokenize(s).join('')

/**
 * Common header synonyms (English + German). Each group maps to one concept so
 * that `Vorname`, `given name` and `fname` all match a `firstName` field.
 */
const SYNONYMS: string[][] = [
  ['email', 'emailaddress', 'mail', 'mailaddress', 'emailadresse', 'mailadresse', 'e mail'],
  ['firstname', 'givenname', 'forename', 'fname', 'vorname', 'first'],
  ['lastname', 'surname', 'familyname', 'lname', 'nachname', 'last', 'familienname'],
  ['fullname', 'name', 'contactname', 'kontaktname', 'vollername'],
  ['phone', 'phonenumber', 'telephone', 'tel', 'telefon', 'telefonnummer', 'mobile', 'mobil', 'cell', 'handy', 'mobilenumber'],
  ['company', 'companyname', 'organization', 'organisation', 'org', 'firma', 'unternehmen', 'account', 'accountname', 'business'],
  ['zip', 'zipcode', 'postalcode', 'postcode', 'plz', 'postleitzahl', 'postal'],
  ['street', 'streetaddress', 'addressline1', 'address1', 'line1', 'strasse', 'street1', 'adresse'],
  ['housenumber', 'streetnumber', 'hausnummer', 'hausnr', 'nr'],
  ['city', 'town', 'ort', 'stadt', 'locality', 'wohnort'],
  ['country', 'land', 'countrycode', 'nation'],
  ['state', 'region', 'province', 'bundesland', 'county'],
  ['birthday', 'birthdate', 'dateofbirth', 'dob', 'geburtsdatum', 'geburtstag'],
  ['website', 'url', 'homepage', 'web', 'webseite', 'site'],
  ['id', 'identifier', 'externalid', 'reference', 'ref', 'kundennummer', 'customerid', 'customernumber'],
  [
    'signupdate',
    'signup',
    'signedup',
    'registered',
    'registrationdate',
    'registeredat',
    'customersince',
    'membersince',
    'kundeseit',
    'registriertam',
    'anmeldedatum',
  ],
  ['createdat', 'created', 'creationdate', 'datecreated', 'erstellt', 'erstelltam'],
  ['updatedat', 'updated', 'modified', 'lastmodified', 'geaendert', 'aktualisiert'],
  ['title', 'jobtitle', 'position', 'role', 'berufsbezeichnung'],
  ['salutation', 'anrede', 'prefix'],
  ['notes', 'note', 'comment', 'comments', 'description', 'notiz', 'bemerkung', 'kommentar', 'beschreibung'],
  ['price', 'amount', 'betrag', 'preis', 'cost', 'total', 'summe'],
  ['revenue', 'umsatz', 'turnover', 'sales', 'erloes', 'ertrag'],
  ['quantity', 'qty', 'menge', 'anzahl', 'count'],
  ['iban', 'bankaccount', 'accountnumber', 'kontonummer'],
  ['tags', 'labels', 'tag', 'label', 'categories', 'kategorie', 'kategorien', 'schlagworte', 'schlagwort', 'stichworte', 'keywords'],
  ['status', 'state', 'stage', 'phase', 'lifecycle', 'lifecyclestage'],
  ['gender', 'sex', 'geschlecht'],
  ['language', 'locale', 'lang', 'sprache'],
  ['currency', 'waehrung'],
]
export type ConceptMap = ReadonlyMap<string, number>

/** Build a lookup from compact header → concept id. Earlier groups win on conflicts. */
export function createConceptMap(extra: string[][] = []): ConceptMap {
  const map = new Map<string, number>()
  ;[...extra, ...SYNONYMS].forEach((group, i) => {
    for (const s of group) if (!map.has(compact(s))) map.set(compact(s), i)
  })
  return map
}

const CONCEPT = createConceptMap()

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Sørensen–Dice coefficient on character bigrams, 0…1. */
export function dice(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  let overlap = 0
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0)
  return (2 * overlap) / (a.length - 1 + (b.length - 1))
}

/** Similarity between two header-ish strings, 0…1. */
export function similarity(a: string, b: string, concepts: ConceptMap = CONCEPT): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const ca = ta.join('')
  const cb = tb.join('')
  if (!ca || !cb) return 0
  if (ca === cb) return 1
  const conceptA = concepts.get(ca)
  const conceptWhole = concepts.get(cb)
  if (conceptA !== undefined && conceptA === conceptWhole) return 0.95
  // Two different well-known concepts ("First name" vs "Last name") never match.
  const distinctConcepts = conceptA !== undefined && conceptWhole !== undefined
  const setB = new Set(tb)
  const shared = ta.filter((t) => setB.has(t)).length
  const tokenScore = shared / Math.max(ta.length, tb.length)
  let score = Math.max(dice(ca, cb), tokenScore)
  // "customer email" vs "email": containment of a meaningful token sequence
  const [short, long] = ca.length < cb.length ? [ca, cb] : [cb, ca]
  if (short.length >= 4 && long.includes(short)) score = Math.max(score, 0.7 + 0.25 * (short.length / long.length))
  // Concept match on any token ("Kunde E-Mail" → email)
  if (score < 0.8) {
    const conceptsA = new Set(ta.map((t) => concepts.get(t)).filter((x) => x !== undefined))
    if (conceptA !== undefined) conceptsA.add(conceptA)
    const conceptB = concepts.get(cb) ?? (tb.length === 1 ? concepts.get(tb[0] as string) : undefined)
    if (conceptB !== undefined && conceptsA.has(conceptB)) score = Math.max(score, 0.8)
  }
  return distinctConcepts ? Math.min(score, 0.4) : score
}

// ─────────────────────────────────────────────────────────────────────────────
// Type compatibility
// ─────────────────────────────────────────────────────────────────────────────

const COMPATIBLE: Record<FieldType, InferredType[]> = {
  string: ['string', 'mixed', 'email', 'url', 'integer', 'number', 'date', 'boolean'],
  email: ['email'],
  url: ['url'],
  number: ['number', 'integer'],
  integer: ['integer'],
  boolean: ['boolean', 'integer'],
  date: ['date', 'integer'],
  datetime: ['date'],
  enum: ['string', 'boolean', 'integer'],
}

/** −0.3 … +0.1 adjustment based on whether the column's content fits the field type. */
export function typeAffinity(field: FieldDefinition, source: SourceField): number {
  if (source.inferredType === 'empty' || source.inferredType === 'mixed') return 0
  if (field.type === 'enum') {
    if (!source.samples.length) return 0
    const hits = source.samples.filter((s) => matchOption(s, field) !== undefined).length
    return hits === source.samples.length ? 0.1 : hits > 0 ? 0.05 : -0.05
  }
  if (field.type === 'string') return source.inferredType === 'string' ? 0.02 : 0
  return COMPATIBLE[field.type].includes(source.inferredType) ? 0.1 : -0.3
}

/**
 * Nested record paths carry meaning in different places: `contact.email` (leaf),
 * `name.family` (reversed: "family name"), `billing_address.city`.
 */
function sourceVariants(label: string): string[] {
  const parts = label.split(/[.[\]/]+/).filter((p) => p && !/^\d+$/.test(p))
  if (parts.length < 2) return [label]
  const leaf = parts.at(-1) as string
  const parent = parts.at(-2) as string
  return [label, leaf, `${leaf} ${parent}`, `${parent} ${leaf}`]
}

/** Score one source column against one target field, 0…1. */
export function scoreMatch(field: FieldDefinition, source: SourceField, concepts: ConceptMap = CONCEPT): { score: number; reason: string } {
  const candidates = [field.key.split('.').at(-1) as string, field.key, field.label, ...(field.aliases ?? [])]
  const variants = sourceVariants(source.label)
  let best = 0
  let via = field.label
  for (const c of candidates) {
    for (const [i, v] of variants.entries()) {
      // Partial path variants are slightly less trustworthy than the full label.
      const s = similarity(v, c, concepts) * (i === 0 ? 1 : 0.97)
      if (s > best) {
        best = s
        via = c
      }
    }
  }
  const affinity = typeAffinity(field, source)
  const score = Math.max(0, Math.min(1, best + (best > 0.4 ? affinity : 0)))
  const reason = best === 1 ? `"${source.label}" = "${via}"` : `"${source.label}" ≈ "${via}"`
  return { score, reason }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default matcher
// ─────────────────────────────────────────────────────────────────────────────

export interface FuzzyMatcherOptions {
  /** Minimum score to suggest a match. Default 0.55. */
  threshold?: number
  /** Extra synonym groups (checked before the built-ins), e.g. `[['msisdn', 'phone']]`. */
  synonyms?: string[][]
}

/**
 * Zero-dependency header matcher: normalised string similarity, an EN/DE
 * synonym dictionary, field aliases, and a type-affinity check on sample values.
 * Assigns each column to at most one field (best scores first).
 */
export function fuzzyMatcher(options: FuzzyMatcherOptions = {}): Matcher {
  const threshold = options.threshold ?? 0.55
  const concepts = options.synonyms?.length ? createConceptMap(options.synonyms) : CONCEPT
  return {
    id: 'fuzzy',
    priority: 0,
    match: ({ schema, sourceFields, mapping }) => {
      const pairs: MatchSuggestion[] = []
      for (const field of schema.fields) {
        if (mapping[field.key]) continue
        for (const source of sourceFields) {
          const { score, reason } = scoreMatch(field, source, concepts)
          if (score >= threshold) pairs.push({ target: field.key, sources: [source.key], confidence: round(score), reason })
        }
      }
      return assignGreedy(pairs, usedPlainSources(mapping))
    },
  }
}

const round = (n: number) => Math.round(n * 100) / 100

/** Columns already taken by plain (transform-less) mappings. */
export function usedPlainSources(mapping: Mapping): Set<string> {
  return new Set(
    Object.values(mapping)
      .filter((m) => !m.transforms?.length)
      .flatMap((m) => m.sources),
  )
}

/**
 * Pick the best non-conflicting suggestions: one suggestion per target, and each
 * column used by at most one *plain* suggestion. Suggestions with transforms may
 * share columns (e.g. "Full name" split into first and last name).
 * `rank` overrides the confidence used for ordering.
 */
export function assignGreedy(
  suggestions: MatchSuggestion[],
  usedSources = new Set<string>(),
  rank: (s: MatchSuggestion) => number = (s) => s.confidence,
): MatchSuggestion[] {
  const sorted = [...suggestions].sort((a, b) => rank(b) - rank(a))
  const usedTargets = new Set<string>()
  const used = new Set(usedSources)
  const out: MatchSuggestion[] = []
  for (const s of sorted) {
    const shares = !!s.transforms?.length
    if (usedTargets.has(s.target) || (!shares && s.sources.some((k) => used.has(k)))) continue
    usedTargets.add(s.target)
    if (!shares) for (const k of s.sources) used.add(k)
    out.push(s)
  }
  return out
}

/** Suggest `valueMap` entries for an enum field from a column's distinct values. */
export function suggestValueMap(distinct: unknown[], field: FieldDefinition, threshold = 0.6): Record<string, string> {
  const map: Record<string, string> = {}
  for (const raw of distinct) {
    const value = stringify(raw).trim()
    if (!value || matchOption(value, field) !== undefined) continue
    let best: string | undefined
    let bestScore = threshold
    for (const o of field.options ?? []) {
      for (const c of [o.value, o.label, ...(o.aliases ?? [])]) {
        if (!c) continue
        const s = similarity(value, c)
        if (s > bestScore) {
          bestScore = s
          best = o.value
        }
      }
    }
    if (best) map[value] = best
  }
  return map
}

export type { MatchContext }
