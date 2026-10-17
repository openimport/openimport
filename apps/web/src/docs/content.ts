import { Marked, type Tokens } from 'marked'
import { highlightHtml } from '@/lib/highlight'

/**
 * The docs are the Markdown files in the repository's `docs/` folder, so the
 * site and GitHub always show the same text.
 */
const files = import.meta.glob('../../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const NAV: { title: string; pages: string[] }[] = [
  { title: 'Getting started', pages: ['index', 'quick-start'] },
  { title: 'Guides', pages: ['schema', 'mapping', 'transforms', 'validation', 'output'] },
  { title: 'Building UIs', pages: ['ui', 'react', 'theming', 'worker'] },
  { title: 'Headless', pages: ['session', 'server'] },
  { title: 'Extending', pages: ['plugins', 'formats', 'ai'] },
  { title: 'Reference', pages: ['config', 'architecture', 'roadmap'] },
]

export interface Heading {
  depth: 2 | 3
  text: string
  id: string
}

export interface Page {
  slug: string
  title: string
  description: string
  html: string
  headings: Heading[]
  /** Plain text for search. */
  text: string
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

/** `./schema.md#types` → `/docs/schema#types`; `./index.md` → `/docs/`. */
export function docHref(href: string): string {
  const m = /^\.?\/?([\w-]+)\.md(#.*)?$/.exec(href)
  if (!m) return href
  const [, slug, hash = ''] = m
  return slug === 'index' ? `/docs/${hash}` : `/docs/${slug}${hash}`
}

function parse(slug: string, source: string): Page {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(source)
  const meta: Record<string, string> = {}
  for (const line of fm?.[1]?.split('\n') ?? []) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const body = fm ? source.slice(fm[0].length) : source
  const headings: Heading[] = []
  const used = new Map<string, number>()

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        let id = slugify(html)
        const n = used.get(id) ?? 0
        used.set(id, n + 1)
        if (n) id = `${id}-${n}`
        if (depth === 2 || depth === 3) headings.push({ depth, text: html.replace(/<[^>]+>/g, ''), id })
        return `<h${depth} id="${id}"><a href="#${id}" class="anchor">${html}</a></h${depth}>`
      },
      code({ text, lang }: Tokens.Code) {
        const [language = '', ...rest] = (lang ?? '').split(/\s+/)
        const title = /title="([^"]+)"/.exec(rest.join(' '))?.[1]
        const head = title ? `<div class="code-title"><span>${title}</span></div>` : ''
        return `<figure class="code" data-lang="${language}">${head}<pre><code>${highlightHtml(text, language)}</code></pre></figure>`
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens)
        const target = docHref(href)
        const external = /^https?:/.test(target)
        return `<a href="${target}"${external ? ' target="_blank" rel="noreferrer"' : ''}>${inner}</a>`
      },
      table(token: Tokens.Table) {
        const cell = (c: Tokens.TableCell) => this.parser.parseInline(c.tokens)
        const head = `<tr>${token.header.map((h) => `<th>${cell(h)}</th>`).join('')}</tr>`
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')
        return `<div class="table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`
      },
    },
  })
  const html = marked.parse(body, { async: false }) as string
  return {
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? '',
    html,
    headings,
    text: body.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`|>[\]()_-]/g, ' '),
  }
}

export const PAGES: Record<string, Page> = Object.fromEntries(
  Object.entries(files).map(([path, source]) => {
    const slug = path.split('/').pop()?.replace(/\.md$/, '') ?? path
    return [slug, parse(slug, source)]
  }),
)

/** Pages in sidebar order, for previous / next links. */
export const ORDER = NAV.flatMap((g) => g.pages).filter((s) => PAGES[s])

export function slugFromPath(pathname: string): string {
  const slug = pathname.replace(/^\/docs\/?/, '').replace(/\/$/, '')
  return slug || 'index'
}
