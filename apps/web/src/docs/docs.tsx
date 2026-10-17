import { ArrowLeft, ArrowRight, Menu, Search, Table2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { NAV, ORDER, PAGES, slugFromPath } from './content'

const GITHUB = 'https://github.com/openimport/openimport'

/** Client-side navigation between doc pages; everything else is a normal link. */
function useDocsRouter() {
  const [slug, setSlug] = useState(() => slugFromPath(location.pathname))
  const go = useCallback((href: string) => {
    const url = new URL(href, location.href)
    history.pushState(null, '', url.pathname + url.hash)
    setSlug(slugFromPath(url.pathname))
    requestAnimationFrame(() => {
      const target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null
      if (target) target.scrollIntoView()
      else window.scrollTo(0, 0)
    })
  }, [])
  useEffect(() => {
    const onPop = () => setSlug(slugFromPath(location.pathname))
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest('a')
      if (!a || a.target || a.origin !== location.origin || !a.pathname.startsWith('/docs')) return
      if (a.pathname === location.pathname && a.hash) return // same-page anchor: let the browser scroll
      e.preventDefault()
      go(a.href)
    }
    addEventListener('popstate', onPop)
    document.addEventListener('click', onClick)
    return () => {
      removeEventListener('popstate', onPop)
      document.removeEventListener('click', onClick)
    }
  }, [go])
  return { slug, go }
}

const href = (slug: string) => (slug === 'index' ? '/docs/' : `/docs/${slug}`)

export function Docs() {
  const { slug, go } = useDocsRouter()
  const page = PAGES[slug] ?? PAGES.index
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const index = ORDER.indexOf(page?.slug ?? 'index')
  const prev = index > 0 ? PAGES[ORDER[index - 1] as string] : undefined
  const next = index < ORDER.length - 1 ? PAGES[ORDER[index + 1] as string] : undefined

  useEffect(() => {
    document.title = page && page.slug !== 'index' ? `${page.title} · OpenImport docs` : 'OpenImport docs'
    setMenu(false)
  }, [page])

  // Deep links: the content renders after the browser's own jump to #section, so scroll once it exists.
  useEffect(() => {
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch((s) => !s)
      }
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        setSearch(true)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (!page) return null

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-background/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <button type="button" className="text-zinc-400 lg:hidden" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
              {menu ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <a href="/" className="flex items-center gap-2.5">
              <span className="grid size-6 place-items-center bg-foreground text-background">
                <Table2 className="size-3.5" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">OpenImport</span>
            </a>
            <span className="font-mono text-[13px] text-zinc-500">/ docs</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearch(true)}
              className="mr-2 hidden h-8 items-center gap-3 border border-zinc-800 px-3 font-mono text-[12px] text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 sm:flex"
            >
              <Search className="size-3.5" /> Search <kbd className="text-zinc-600">⌘K</kbd>
            </button>
            <a href="/playground/" className="px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-50">
              Playground
            </a>
            <a href={GITHUB} className="hidden px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:text-zinc-50 sm:block">
              GitHub
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside
          className={cn(
            'fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto border-r border-zinc-900 bg-background px-3 py-6 lg:sticky lg:block lg:h-[calc(100dvh-56px)] lg:w-[260px] lg:shrink-0',
            menu ? 'block' : 'hidden',
          )}
        >
          <nav className="flex flex-col gap-6 font-mono text-[13px]">
            {NAV.map((group) => (
              <div key={group.title} className="flex flex-col">
                <span className="px-3 pb-2 text-[11px] tracking-[0.1em] text-zinc-600 uppercase">{group.title}</span>
                {group.pages
                  .filter((s) => PAGES[s])
                  .map((s) => (
                    <a
                      key={s}
                      href={href(s)}
                      aria-current={s === page.slug ? 'page' : undefined}
                      className={cn(
                        'border-l-2 px-3 py-1.5 transition-colors',
                        s === page.slug
                          ? 'border-zinc-50 bg-zinc-900/60 text-zinc-50'
                          : 'border-transparent text-zinc-400 hover:text-zinc-100',
                      )}
                    >
                      {PAGES[s]?.title}
                    </a>
                  ))}
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-6 pt-10 pb-24 md:px-12">
          <article className="mx-auto max-w-[720px]">
            <h1 className="font-mono text-[28px] font-medium tracking-tight">{page.title}</h1>
            {page.description && <p className="mt-2 font-mono text-[14px] text-zinc-500">{page.description}</p>}
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered from our own Markdown files at build time */}
            <div className="docs-prose mt-10" dangerouslySetInnerHTML={{ __html: page.html }} />
            <nav className="mt-20 grid grid-cols-2 gap-4 border-t border-zinc-900 pt-8 font-mono text-[13px]">
              {prev ? (
                <a
                  href={href(prev.slug)}
                  className="group flex flex-col gap-1 border border-zinc-900 p-4 transition-colors hover:border-zinc-700"
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                    <ArrowLeft className="size-3" /> Previous
                  </span>
                  <span className="text-zinc-200">{prev.title}</span>
                </a>
              ) : (
                <span />
              )}
              {next && (
                <a
                  href={href(next.slug)}
                  className="group flex flex-col items-end gap-1 border border-zinc-900 p-4 text-right transition-colors hover:border-zinc-700"
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                    Next <ArrowRight className="size-3" />
                  </span>
                  <span className="text-zinc-200">{next.title}</span>
                </a>
              )}
            </nav>
          </article>
        </main>

        <Toc key={page.slug} headings={page.headings} />
      </div>

      {search && <SearchDialog onClose={() => setSearch(false)} onPick={(to) => go(to)} />}
    </div>
  )
}

/** "On this page", with the section in view highlighted. */
function Toc({ headings }: { headings: (typeof PAGES)[string]['headings'] }) {
  const [active, setActive] = useState(headings[0]?.id)
  useEffect(() => {
    const els = headings.map((h) => document.getElementById(h.id)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-64px 0px -70% 0px' },
    )
    for (const el of els) io.observe(el)
    return () => io.disconnect()
  }, [headings])
  if (!headings.length) return <div className="hidden w-[220px] shrink-0 xl:block" />
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-56px)] w-[220px] shrink-0 overflow-y-auto py-10 pr-5 xl:block">
      <span className="font-mono text-[12px] text-zinc-300">On this page</span>
      <ul className="mt-3 flex flex-col font-mono text-[12px]">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                'block py-1 transition-colors',
                h.depth === 3 && 'pl-3',
                active === h.id ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Plain substring search over titles, headings and text. Simple on purpose. */
function SearchDialog({ onClose, onPick }: { onClose: () => void; onPick: (href: string) => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const out: { href: string; title: string; context: string }[] = []
    for (const slug of ORDER) {
      const p = PAGES[slug]
      if (!p) continue
      if (!query || p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query)) {
        out.push({ href: href(slug), title: p.title, context: p.description })
      }
      if (!query) continue
      for (const h of p.headings) {
        if (h.text.toLowerCase().includes(query)) out.push({ href: `${href(slug)}#${h.id}`, title: h.text, context: p.title })
      }
      if (!out.some((r) => r.href.startsWith(href(slug))) && p.text.toLowerCase().includes(query)) {
        const i = p.text.toLowerCase().indexOf(query)
        out.push({
          href: href(slug),
          title: p.title,
          context: `…${p.text
            .slice(Math.max(0, i - 30), i + 50)
            .replace(/\s+/g, ' ')
            .trim()}…`,
        })
      }
    }
    return out.slice(0, 12)
  }, [q])

  const pick = (r: (typeof results)[number] | undefined) => {
    if (!r) return
    onClose()
    onPick(r.href)
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Esc is handled in the input
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the docs"
        className="w-full max-w-[560px] border border-zinc-800 bg-zinc-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4">
          <Search className="size-4 text-zinc-500" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, results.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              }
              if (e.key === 'Enter') pick(results[sel])
            }}
            placeholder="Search the docs"
            className="h-12 flex-1 bg-transparent font-mono text-[14px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <kbd className="font-mono text-[11px] text-zinc-600">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 && <li className="px-4 py-6 text-center font-mono text-[13px] text-zinc-500">No results for “{q}”</li>}
          {results.map((r, i) => (
            <li key={r.href + r.title}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(r)}
                className={cn('flex w-full flex-col gap-0.5 px-4 py-2.5 text-left', i === sel && 'bg-zinc-900')}
              >
                <span className="font-mono text-[13px] text-zinc-100">{r.title}</span>
                <span className="truncate text-[12px] text-zinc-500">{r.context}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
