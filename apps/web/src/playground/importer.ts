import { aiMatching } from '@openimport/ai'
import { createImporter, indexedDbRecipeStore } from '@openimport/core'
import { csv } from '@openimport/csv'
import { jsonFormats } from '@openimport/json'
import { xlsx } from '@openimport/xlsx'
import { xml } from '@openimport/xml'
import { contacts } from './schema'

/**
 * The playground's importer. Imported by the page and by the import worker,
 * so both run the same schema and plugins (functions can't be sent to a worker).
 */
export interface PlaygroundOptions {
  invalidRows: 'block' | 'skip'
  useAi: boolean
  rememberRecipes: boolean
}

/** A pretend LLM for the demo: maps a couple of tricky columns the fuzzy matcher can't. */
const demoAi = aiMatching({
  generate: async ({ prompt }) => {
    await new Promise((r) => setTimeout(r, 300))
    const columns = [...prompt.matchAll(/"key":"(\w+)","label":"([^"]+)"/g)].map((m) => ({ key: m[1], label: m[2] }))
    const find = (re: RegExp) => columns.find((c) => re.test(c.label ?? ''))?.key
    const matches = [
      { target: 'phone', column: find(/mobile|telefon/i) },
      { target: 'tags', column: find(/labels|schlagworte/i) },
    ]
      .filter((x) => x.column)
      .map((x) => ({ target: x.target, sources: [x.column], confidence: 0.9, reason: 'demo' }))
    return JSON.stringify({ matches })
  },
})

export function makeImporter(options: PlaygroundOptions) {
  return createImporter({
    schema: contacts,
    plugins: [csv(), xlsx(), jsonFormats(), xml(), ...(options.useAi ? [demoAi] : [])],
    invalidRows: options.invalidRows,
    // IndexedDB works on the page and in the worker, so both see the same saved mappings.
    recipes: options.rememberRecipes ? indexedDbRecipeStore('openimport-playground') : false,
    maxFileSize: 100 * 1024 * 1024,
    // Columns the schema doesn't cover can be added as typed fields; values arrive in record.$custom.
    customFields: true,
  })
}
