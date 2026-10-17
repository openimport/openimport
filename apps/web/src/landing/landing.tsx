import { ArrowRight, ArrowUpRight, Check, Copy, Table2 } from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { HeroBackground } from './background'
import { Code } from './code'

const PLAYGROUND = '/playground/'
const GITHUB = 'https://github.com/openimport/openimport'
const DOCS = '/docs/'

/** Adds `lp-inview` once the element scrolls into view (drives reveal + bar animations). */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.classList.add('lp-inview')
          io.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={cn('lp-reveal', className)}>
      {children}
    </div>
  )
}

export function Landing() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      {/* the two spines that frame every section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-[min(1120px,calc(100%-32px))] -translate-x-1/2 border-x border-zinc-900"
      />
      <Nav />
      <Hero />
      <Facts />
      <HowItWorks />
      <Api />
      <MappingIsData />
      <Plugins />
      <Layers />
      <FinalCta />
      <Footer />
    </div>
  )
}

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('relative z-10 mx-auto w-[min(1120px,calc(100%-32px))]', className)}>{children}</div>
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-900 bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between px-5">
        <a href="/" className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center bg-foreground text-background">
            <Table2 className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">OpenImport</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <a href="#how" className="transition-colors hover:text-zinc-50">
            How it works
          </a>
          <a href="#api" className="transition-colors hover:text-zinc-50">
            API
          </a>
          <a href="#mapping" className="transition-colors hover:text-zinc-50">
            Mapping
          </a>
          <a href="#plugins" className="transition-colors hover:text-zinc-50">
            Plugins
          </a>
          <a href={DOCS} className="transition-colors hover:text-zinc-50">
            Docs
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <a href={GITHUB}>GitHub</a>
          </Button>
          <Button size="sm" asChild>
            <a href={PLAYGROUND}>
              Open playground <ArrowRight />
            </a>
          </Button>
        </div>
      </div>
    </header>
  )
}

function InstallCommand() {
  const [copied, setCopied] = useState(false)
  const cmd = 'npm i @openimport/core'
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(cmd)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      className="group inline-flex h-9 max-w-full items-center gap-3 border border-zinc-800 bg-zinc-950 px-3.5 font-mono text-[12.5px] whitespace-nowrap text-zinc-300 transition-colors hover:border-zinc-700"
    >
      <span className="text-zinc-600">$</span>
      {cmd}
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5 text-zinc-600 group-hover:text-zinc-400" />}
    </button>
  )
}

function Hero() {
  return (
    <section className="relative border-b border-zinc-900">
      <HeroBackground className="max-lg:opacity-40" />
      <Container className="grid grid-cols-1 gap-12 pt-16 pb-24 md:pt-28 md:pb-44 lg:grid-cols-[1.1fr_1fr] lg:items-center [&>*]:min-w-0">
        <div className="flex flex-col gap-7">
          <span className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] tracking-[0.12em] text-zinc-400 uppercase">
            <span className="size-1.5 bg-emerald-400" /> Open source · MIT · v0.1 · zero-dependency core
          </span>
          <h1 className="text-[clamp(2.4rem,5vw,3.6rem)] leading-[1.03] font-semibold tracking-[-0.035em] text-balance">
            Messy spreadsheets in. Typed records out.
          </h1>
          <p className="max-w-[34rem] text-[17px] leading-relaxed text-zinc-400">
            OpenImport is a headless TypeScript engine for user-facing data imports. It reads CSV, Excel, JSON and XML, finds the header,
            matches columns to your schema, fixes formats, validates every row and hands your code typed records. In the browser, a worker
            or on your server.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <a href={PLAYGROUND}>
                Open the playground <ArrowRight />
              </a>
            </Button>
            <InstallCommand />
          </div>
          <span className="font-mono text-[11px] text-zinc-600">
            No sign-up. The playground runs in your browser; files never leave the tab.
          </span>
        </div>
        <HeroCard />
      </Container>
    </section>
  )
}

/** Input → output, the whole idea in one card. One input row at a time is highlighted. */
function HeroCard() {
  const rows: { cells: string; tone?: 'skip' | 'header' | 'bad' }[] = [
    { cells: 'CRM Export – Kontakte;;;;', tone: 'skip' },
    { cells: 'Vorname;Nachname;E-Mail-Adresse;Kunde seit;Umsatz', tone: 'header' },
    { cells: 'Anna;Müller;anna@beispiel.de;15.03.2024;1.234,50' },
    { cells: 'Lukas;Weber;lukas@beispiel;02.11.2021;980', tone: 'bad' },
  ]
  return (
    <div className="relative min-w-0 overflow-hidden border border-zinc-800 bg-zinc-950/90 font-mono text-[12px] shadow-[0_0_0_1px_rgb(0_0_0),0_30px_80px_-30px_rgb(0_0_0/0.8)] backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-[11px]">
        <span className="text-zinc-300">
          <span className="text-zinc-600">in </span>crm-export.csv
        </span>
        <span className="text-zinc-500">delimiter ; · windows-1252</span>
      </div>
      <div className="relative py-2">
        <div className="lp-scan pointer-events-none absolute inset-x-0 top-2 h-7 border-y border-zinc-800/80 bg-zinc-900/60" />
        {rows.map((r) => (
          <div key={r.cells} className="relative flex h-7 items-center gap-3 px-4">
            <span
              className={cn(
                'w-14 shrink-0 text-[10px] tracking-wider uppercase',
                r.tone === 'header' ? 'text-emerald-400' : 'text-zinc-700',
              )}
            >
              {r.tone === 'skip' ? 'skipped' : r.tone === 'header' ? 'header' : 'row'}
            </span>
            <span
              className={cn(
                'truncate',
                r.tone === 'skip' && 'text-zinc-700 line-through decoration-zinc-800',
                r.tone === 'header' && 'text-zinc-100',
                !r.tone && 'text-zinc-400',
                r.tone === 'bad' && 'text-zinc-400',
              )}
            >
              {r.tone === 'bad' ? (
                <>
                  Lukas;Weber;<span className="bg-red-500/15 text-red-300">lukas@beispiel</span>;02.11.2021;980
                </>
              ) : (
                r.cells
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-y border-zinc-800 px-4 py-2.5 text-[11px]">
        <span className="text-zinc-300">
          <span className="text-zinc-600">out </span>Contact[]
        </span>
        <span className="text-zinc-500">
          <span className="text-emerald-400">1 valid</span> · <span className="text-red-400">1 issue</span>
        </span>
      </div>
      <pre className="px-4 py-3 leading-[1.75] text-zinc-400">
        {'{ '}
        <span className="text-zinc-500">firstName</span>: <span className="text-emerald-300/90">"Anna"</span>,{' '}
        <span className="text-zinc-500">lastName</span>: <span className="text-emerald-300/90">"Müller"</span>,{'\n  '}
        <span className="text-zinc-500">email</span>: <span className="text-emerald-300/90">"anna@beispiel.de"</span>,{'\n  '}
        <span className="text-zinc-500">signupDate</span>: <span className="text-emerald-300/90">"2024-03-15"</span>,{' '}
        <span className="text-zinc-500">revenue</span>: <span className="text-amber-200">1234.5</span>
        {' }'}
        <span className="lp-caret text-zinc-500">▍</span>
      </pre>
      <div className="flex gap-3 border-t border-zinc-800 px-4 py-2.5 text-[11px]">
        <span className="text-red-400">row 4</span>
        <span className="text-zinc-500">email</span>
        <span className="text-zinc-300">Not a valid email address</span>
      </div>
    </div>
  )
}

function Facts() {
  const facts = [
    ['Core', 'Zero dependencies. No React, no DOM required.'],
    ['Formats', 'CSV, TSV, XLSX, JSON, JSON Lines, XML. Or your own.'],
    ['Schema', 'Field builders, runtime field lists, zod, arktype or valibot.'],
    ['Runs in', 'Browsers, workers, and Node, Bun and Deno, tested in CI.'],
  ]
  return (
    <section className="border-b border-zinc-900">
      <Container className="grid grid-cols-2 md:grid-cols-4">
        {facts.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              'flex flex-col gap-2 px-5 py-6',
              i > 0 && 'md:border-l',
              i % 2 === 1 && 'border-l',
              i >= 2 && 'border-t md:border-t-0',
              'border-zinc-900',
            )}
          >
            <span className="font-mono text-[11px] tracking-[0.12em] text-zinc-500 uppercase">{k}</span>
            <span className="text-[14px] leading-snug text-zinc-300">{v}</span>
          </div>
        ))}
      </Container>
    </section>
  )
}

function SectionHead({ id, n, label, title, children }: { id: string; n: string; label: string; title: string; children?: ReactNode }) {
  return (
    <div id={id} className="grid scroll-mt-20 gap-6 pt-24 pb-12 md:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-1 font-mono text-[11px] tracking-[0.12em] uppercase">
        <span className="text-zinc-300">{n}</span>
        <span className="text-zinc-500">{label}</span>
      </div>
      <div className="flex max-w-[44rem] flex-col gap-4">
        <h2 className="text-[clamp(1.8rem,3.2vw,2.4rem)] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">{title}</h2>
        {children && <div className="text-[16px] leading-relaxed text-zinc-400">{children}</div>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────── 01 how it works

const KIND = {
  parse: { label: 'parse', bar: 'bg-zinc-500', text: 'text-zinc-300' },
  map: { label: 'map', bar: 'bg-sky-400/80', text: 'text-sky-300' },
  validate: { label: 'validate', bar: 'bg-amber-300/80', text: 'text-amber-200' },
  output: { label: 'deliver', bar: 'bg-emerald-400/80', text: 'text-emerald-300' },
} as const

const TRACE: { span: string; kind: keyof typeof KIND; start: number; ms: number | null; result: string; depth?: boolean }[] = [
  { span: 'file.inspect', kind: 'parse', start: 0, ms: 4, result: "csv plugin · delimiter ';' · utf-8" },
  { span: 'rows.read', kind: 'parse', start: 4, ms: 99, result: '50,004 rows streamed · header found in row 4', depth: true },
  { span: 'columns.match', kind: 'map', start: 103, ms: 11, result: 'fuzzy matcher, no recipe yet · 8/8 fields', depth: true },
  { span: 'mapping.enrich', kind: 'map', start: 114, ms: 2, result: 'DD.MM.YYYY · decimal "," · enum values', depth: true },
  { span: 'rows.validate', kind: 'validate', start: 116, ms: 234, result: 'coerce → rules → unique · 2,472 flagged', depth: true },
  { span: 'review', kind: 'validate', start: 350, ms: null, result: 'user edits re-validate only their row', depth: true },
  { span: 'submit', kind: 'output', start: 350, ms: 37, result: '47,528 records → onSubmit × 48 batches', depth: true },
]
const TOTAL = 400

function TraceTable() {
  const ref = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className="border border-zinc-800 bg-zinc-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-5 py-3 font-mono text-[11px]">
        <span className="text-zinc-300">
          import/5f3a91 <span className="text-zinc-500">crm-export.csv · 50,000 rows · 8 fields</span>
        </span>
        <span className="text-zinc-500">
          7 stages · <span className="text-zinc-300">386 ms</span> of engine time
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] font-mono text-[12px]">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[10.5px] tracking-[0.1em] text-zinc-500 uppercase">
              <th className="w-[170px] px-5 py-2.5 font-normal">Stage</th>
              <th className="px-3 py-2.5 font-normal">
                <span className="flex justify-between">
                  <span>0 ms</span>
                  <span>200</span>
                  <span>400</span>
                </span>
              </th>
              <th className="w-[340px] px-3 py-2.5 font-normal">Result</th>
              <th className="w-[70px] px-5 py-2.5 text-right font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {TRACE.map((t, i) => (
              <tr key={t.span} className="border-b border-zinc-900 last:border-b-0 hover:bg-zinc-900/40">
                <td className="px-5 py-2.5 text-zinc-300">
                  <span className="text-zinc-700">{t.depth ? (i === TRACE.length - 1 ? '└ ' : '│ ') : ''}</span>
                  {t.span}
                </td>
                <td className="px-3 py-2.5">
                  <div className="relative h-1.5">
                    {t.ms === null ? (
                      <span
                        className="absolute inset-y-0 border-t border-dashed border-zinc-700"
                        style={{ left: `${(t.start / TOTAL) * 100}%`, right: 0, top: 3 }}
                      />
                    ) : (
                      <span
                        className={cn('lp-bar absolute inset-y-0', KIND[t.kind].bar)}
                        style={
                          {
                            left: `${(t.start / TOTAL) * 100}%`,
                            width: `max(3px, ${(t.ms / TOTAL) * 100}%)`,
                            '--delay': `${i * 90}ms`,
                          } as CSSProperties
                        }
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-zinc-400">{t.result}</td>
                <td className={cn('px-5 py-2.5 text-right', t.ms && t.ms > 50 ? KIND[t.kind].text : 'text-zinc-500')}>
                  {t.ms === null ? 'you' : `${t.ms}ms`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-800 px-5 py-3 font-mono text-[11px] text-zinc-500">
        {Object.values(KIND).map((k) => (
          <span key={k.label} className="flex items-center gap-2">
            <span className={cn('h-1.5 w-3', k.bar)} />
            {k.label}
          </span>
        ))}
        <span className="ml-auto text-zinc-600">
          reproduce with <code className="text-zinc-400">pnpm bench</code> · Node 22 · Apple M4 Pro
        </span>
      </div>
    </div>
  )
}

const STAGES: { n: string; title: string; body: ReactNode; tags: string[] }[] = [
  {
    n: '01.1',
    title: 'Parse',
    body: (
      <>
        A format plugin turns bytes into either a <em className="text-zinc-200 not-italic">grid</em> (CSV, XLSX) or{' '}
        <em className="text-zinc-200 not-italic">records</em> (JSON, XML). From here on, nothing knows which file type it came from. The CSV
        parser is part of the project: it streams, sniffs the delimiter and falls back to Windows-1252 when a file isn’t UTF-8.
      </>
    ),
    tags: ['grid', 'records', 'streaming'],
  },
  {
    n: '01.2',
    title: 'Find the table',
    body: 'Exports often start with a title, a timestamp and a blank line. A scoring heuristic locates the real header row; users can click a different one. Blank lines are dropped, line numbers are kept for error messages.',
    tags: ['header row'],
  },
  {
    n: '01.3',
    title: 'Map',
    body: 'Saved recipes are tried first, then every matcher: the built-in fuzzy matcher (synonyms in English and German, aliases, sample-value types), an optional AI matcher, or yours. Confident suggestions are applied; date order, decimal separator and enum values are inferred from the data.',
    tags: ['recipes', 'matchers', 'value maps'],
  },
  {
    n: '01.4',
    title: 'Validate',
    body: 'Each mapped value runs through its transforms, is coerced to the field type and checked: required, unique across all rows, ranges, patterns, your row rules, a Standard Schema such as zod, and async batch checks against your API. Edits re-validate only what changed.',
    tags: ['coerce', 'zod', 'async'],
  },
  {
    n: '01.5',
    title: 'Deliver',
    body: 'Valid rows reach onSubmit in batches as nested, typed objects. Return rejections from your server and those rows reopen in review with your messages attached.',
    tags: ['batches', 'rejections'],
  },
]

function HowItWorks() {
  return (
    <section className="border-b border-zinc-900">
      <Container>
        <SectionHead id="how" n="01" label="How it works" title="What happens between a dropped file and onSubmit.">
          An import is a <code className="font-mono text-[14px] text-zinc-200">session</code>: a small state machine with one immutable
          state snapshot. Every stage is plain TypeScript you can drive from a UI, a test or a cron job. Below is a real run on a 50,000-row
          German CRM export; <code className="font-mono text-[14px] text-zinc-200">pnpm bench</code> reproduces it.
        </SectionHead>
        <Reveal>
          <TraceTable />
        </Reveal>
        <div className="mt-16 mb-24 border-t border-zinc-900">
          {STAGES.map((s) => (
            <Reveal key={s.n} className="grid gap-4 border-b border-zinc-900 py-7 md:grid-cols-[80px_200px_1fr_auto]">
              <span className="font-mono text-[11px] text-zinc-600">{s.n}</span>
              <h3 className="text-[17px] font-medium tracking-tight">{s.title}</h3>
              <p className="max-w-[36rem] text-[15px] leading-relaxed text-zinc-400">{s.body}</p>
              <div className="flex flex-wrap gap-1.5 md:justify-end">
                {s.tags.map((t) => (
                  <span key={t} className="h-fit border border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-400">
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}

// ─────────────────────────────────────────────────────────── 02 api

const DECLARE = `import { createImporter, defineSchema, field } from '@openimport/core'
import { csv } from '@openimport/csv'

const contacts = defineSchema({
  id: 'contacts',
  fields: {
    email: field.email({ required: true, unique: true }),
    name: field.string({ required: true, aliases: ['Vorname'] }),
    status: field.enum(['lead', 'customer']),
    'address.city': field.string(),
  },
})

export const importer = createImporter({ schema: contacts, plugins: [csv()] })`

const DRIVE = `const session = importer.createSession()
session.subscribe((state) => render(state))   // step, mapping, rows, stats…

await session.loadFile(file)                  // → 'header' | 'mapping'
session.assign('email', 'c2')                 // or let the matchers do it
await session.confirmMapping()                // validates every row

session.editCell(rowId, 'email', 'anna@beispiel.de')
await session.submit(async ({ records }) => {
  await api.contacts.createMany(records)      // { email; name; address: { city } }[]
})`

const STREAM = `// No UI at all: a nightly SFTP import, a CLI, a queue worker.
for await (const chunk of importer.run(file, { recipe, batchSize: 5000 })) {
  await db.contacts.insertMany(chunk.records)
  for (const issue of chunk.issues) {
    log.warn(\`line \${issue.sourceIndex}: \${issue.field} \${issue.message}\`)
  }
}`

function Api() {
  const rows = [
    {
      n: '02.1',
      title: 'Declare the target',
      body: 'A schema is a list of fields with types, rules and aliases. Builders infer the record type; you can also load fields at runtime or pass a zod object as-is.',
      code: DECLARE,
      file: 'importer.ts',
    },
    {
      n: '02.2',
      title: 'Drive a session',
      body: 'Subscribe, call actions, render state. This is all the bundled UI does, so anything it can do, your own interface can do.',
      code: DRIVE,
      file: 'your-ui.ts',
    },
    {
      n: '02.3',
      title: 'Or skip the UI',
      body: 'run() applies the same rules as the UI, batch by batch. Pass a recipe a user saved in the browser and the server maps the file the same way: columns, transforms, header row and sheet.',
      code: STREAM,
      file: 'jobs/import.ts',
    },
  ]
  return (
    <section className="border-b border-zinc-900">
      <Container>
        <SectionHead id="api" n="02" label="The API" title="Three ways to drive the same engine." />
        <div className="mb-24 flex flex-col gap-16">
          {rows.map((r) => (
            <Reveal key={r.n} className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)]">
              <div className="flex flex-col gap-3 lg:pt-3">
                <span className="font-mono text-[11px] text-zinc-600">{r.n}</span>
                <h3 className="text-[19px] font-medium tracking-tight">{r.title}</h3>
                <p className="text-[15px] leading-relaxed text-zinc-400">{r.body}</p>
              </div>
              <Code code={r.code} title={r.file} meta="TypeScript" />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}

// ─────────────────────────────────────────────────────────── 03 mapping is data

const RECIPE = `{
  "version": 1,
  "sourceLabels": [
    "Vorname", "Name", "Straße", "Hausnr.", "Status", "Kunde seit"
  ],
  "mapping": {
    "firstName": { "sources": ["Vorname"] },
    "lastName": {
      "sources": ["Name"],
      "transforms": [{ "op": "split", "index": -1 }]
    },
    "street": {
      "sources": ["Straße", "Hausnr."],
      "transforms": [{ "op": "template", "template": "{1} {2}" }]
    },
    "status": {
      "sources": ["Status"],
      "valueMap": { "Kunde": "customer", "Ex-Kunde": "churned" }
    },
    "signupDate": {
      "sources": ["Kunde seit"],
      "options": { "dateOrder": "DMY" }
    }
  }
}`

function MappingIsData() {
  const points = [
    ['Stored by header label', 'Reordered or renamed-but-similar columns still match next month.'],
    ['Transforms are named ops', 'join, template, split, replace, extract… with JSON params. Nothing is eval’d.'],
    ['Portable', 'The recipe a user saved in the browser runs unchanged in importer.run() on your server.'],
    ['Machine-writable', 'An AI matcher proposes the same structure; the core checks every op before using it.'],
  ]
  return (
    <section className="border-b border-zinc-900">
      <Container>
        <SectionHead id="mapping" n="03" label="Mapping is data" title="Every decision a user makes is a JSON document.">
          Combining street and house number, splitting a full name, mapping “Kunde” to{' '}
          <code className="font-mono text-[14px] text-zinc-200">customer</code>, reading dates day-first: the mapping screen records all of
          it as a recipe, and recipes are re-applied automatically when a file with similar headers shows up again.
        </SectionHead>
        <Reveal className="mb-24 grid items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Code code={RECIPE} title="recipe.json" meta="what gets saved" />
          <dl className="flex flex-col border-t border-zinc-900">
            {points.map(([t, d]) => (
              <div key={t} className="flex flex-col gap-1.5 border-b border-zinc-900 py-5">
                <dt className="text-[15px] font-medium">{t}</dt>
                <dd className="text-[14px] leading-relaxed text-zinc-400">{d}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </Container>
    </section>
  )
}

// ─────────────────────────────────────────────────────────── 04 plugins

const PLUGIN = `const fixedWidth = definePlugin({
  name: 'fixed-width',
  formats: [{
    id: 'fwf',
    label: 'Fixed width',
    extensions: ['dat'],
    inspect: async (file) => ({
      datasets: [{ id: 'all', label: file.name, layout: 'grid' }],
    }),
    async *read(file) {
      const lines = (await file.blob.text()).split('\\n')
      yield lines.map((l) => [l.slice(0, 10), l.slice(10, 40)])
    },
  }],
  transforms: [{
    op: 'iban', label: 'Normalize IBAN', arity: 'one',
    apply: (v) => String(v).replaceAll(' ', '').toUpperCase(),
  }],
  matchers: [{ id: 'erp', priority: 5, match: suggestFromErp }],
  onEvent: (e) => analytics.track(\`import:\${e.type}\`),
})`

const PACKAGES: [string, string, string][] = [
  ['@openimport/core', 'Engine: session, matching, transforms, validation, run()', '—'],
  ['@openimport/csv', 'CSV / TSV, streaming, delimiter + encoding detection', '—'],
  ['@openimport/xlsx', 'Excel, one dataset per sheet', 'read-excel-file'],
  ['@openimport/json', 'JSON (finds nested record arrays) and JSON Lines', '—'],
  ['@openimport/xml', 'XML, repeated elements become records', 'fast-xml-parser'],
  ['@openimport/ai', 'Column matching with your own model endpoint', '—'],
  ['@openimport/worker', 'Opt-in: run imports in a Web Worker for large files', '—'],
  ['@openimport/react', 'Provider and hooks', 'react (peer)'],
  ['@openimport/ui', 'The ready-made importer', 'radix-ui, cmdk, tanstack virtual'],
]

function Plugins() {
  return (
    <section className="border-b border-zinc-900">
      <Container>
        <SectionHead id="plugins" n="04" label="Plugins" title="One small contract for formats, matchers and transforms.">
          Every file format, including the built-in ones, is a plugin with two methods:{' '}
          <code className="font-mono text-[14px] text-zinc-200">inspect</code> finds the tables in a file,{' '}
          <code className="font-mono text-[14px] text-zinc-200">read</code> streams their rows. Install only the formats you accept.
        </SectionHead>
        <Reveal className="mb-24 grid items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Code code={PLUGIN} title="fixed-width.ts" meta="a complete plugin" />
          <div className="border border-zinc-800">
            <div className="grid grid-cols-[1fr_auto] border-b border-zinc-800 px-4 py-2.5 font-mono text-[10.5px] tracking-[0.1em] text-zinc-500 uppercase">
              <span>Package</span>
              <span>Runtime deps</span>
            </div>
            {PACKAGES.map(([name, what, deps]) => (
              <div key={name} className="grid grid-cols-[1fr_auto] gap-4 border-b border-zinc-900 px-4 py-3 last:border-b-0">
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[12.5px] text-zinc-200">{name}</span>
                  <span className="text-[13px] text-zinc-500">{what}</span>
                </span>
                <span className={cn('font-mono text-[11.5px]', deps === '—' ? 'text-emerald-400' : 'text-zinc-500')}>
                  {deps === '—' ? 'none' : deps}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

// ─────────────────────────────────────────────────────────── 05 layers

function Layers() {
  const layers = [
    {
      pkg: '@openimport/ui',
      title: 'Ready-made importer',
      code: '<Importer importer={importer} onSubmit={save} />',
      you: 'onSubmit',
      note: 'Upload, header, mapping with live previews, transform editor, review grid. Themeable, en + de.',
    },
    {
      pkg: '@openimport/react',
      title: 'Hooks',
      code: 'useUpload() · useMapping() · useReview()',
      you: 'your components',
      note: 'Selector-based subscriptions; components re-render only when their slice changes.',
    },
    {
      pkg: '@openimport/core',
      title: 'Engine',
      code: 'session.loadFile() · importer.run()',
      you: 'any UI, or none',
      note: 'Framework-agnostic state machine. Works with Vue, Svelte, signals, or a script.',
    },
  ]
  return (
    <section className="border-b border-zinc-900">
      <Container>
        <SectionHead id="layers" n="05" label="Layers" title="Use as much of it as you want.">
          Each layer is built only on the public API of the one below. Start with the full importer and peel layers off when your product
          needs something it doesn’t do.
        </SectionHead>
        <Reveal className="mb-24 flex flex-col">
          {layers.map((l, i) => (
            <div
              key={l.pkg}
              className="grid items-center gap-4 border border-zinc-800 bg-zinc-950/60 px-5 py-5 md:grid-cols-[220px_1fr_200px]"
              style={{ marginLeft: `${i * 28}px`, marginTop: i ? -1 : 0 }}
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[12px] text-zinc-200">{l.pkg}</span>
                <span className="text-[13px] text-zinc-500">{l.title}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <code className="font-mono text-[12.5px] text-sky-300">{l.code}</code>
                <span className="text-[13px] text-zinc-500">{l.note}</span>
              </div>
              <span className="font-mono text-[11px] text-zinc-500 md:text-right">
                you write: <span className="text-zinc-300">{l.you}</span>
              </span>
            </div>
          ))}
          <div
            className="border border-dashed border-zinc-800 px-5 py-3 font-mono text-[11.5px] text-zinc-500"
            style={{ marginLeft: 84, marginTop: -1 }}
          >
            plugins: csv · xlsx · json · xml · ai · yours
          </div>
        </Reveal>
      </Container>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-900">
      <HeroBackground className="opacity-70" />
      <Container className="flex flex-col items-start gap-7 py-28">
        <span className="font-mono text-[11px] tracking-[0.12em] text-zinc-500 uppercase">Try it</span>
        <h2 className="max-w-[40rem] text-[clamp(2rem,4vw,3rem)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
          Bring the file you’d normally dread.
        </h2>
        <p className="max-w-[36rem] text-[16px] leading-relaxed text-zinc-400">
          The playground ships a German CRM export with title rows, semicolons, decimal commas and typos, a nested API response, an XML
          export and 50,000 rows. Or drop your own; it never leaves your browser.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" asChild>
            <a href={PLAYGROUND}>
              Open the playground <ArrowRight />
            </a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href={GITHUB}>
              Read the source <ArrowUpRight />
            </a>
          </Button>
        </div>
      </Container>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <Container className="flex flex-wrap items-center justify-between gap-4 py-8 font-mono text-[11px] text-zinc-500">
        <span>OpenImport · MIT · no telemetry, no hosted service</span>
        <span className="flex gap-5">
          <a href={DOCS} className="hover:text-zinc-300">
            docs
          </a>
          <a href={GITHUB} className="hover:text-zinc-300">
            github
          </a>
          <a href="https://www.npmjs.com/org/openimport" className="hover:text-zinc-300">
            npm
          </a>
          <a href={PLAYGROUND} className="hover:text-zinc-300">
            playground
          </a>
        </span>
      </Container>
    </footer>
  )
}
