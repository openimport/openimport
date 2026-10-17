import type { SessionLike, SubmitResult } from '@openimport/core'
import { useImporterSession, useImportState } from '@openimport/react'
import { Importer, ImporterDialog } from '@openimport/ui'
import { AdaptiveSession, RemoteSession, workerSession } from '@openimport/worker'
import {
  BookOpen,
  Braces,
  Check,
  Code,
  Copy,
  Database,
  FileCode2,
  FileSpreadsheet,
  Moon,
  PanelTop,
  RotateCcw,
  ShieldCheck,
  Sun,
  Table2,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { makeImporter } from './importer'
import { contactsXml, crmExportCsv, customersJson, largeCsv } from './samples'
import { contacts } from './schema'

const SAMPLES = [
  {
    id: 'crm',
    icon: FileSpreadsheet,
    name: 'crm-export-kontakte.csv',
    meta: '2,500 rows · CSV · ;',
    tag: 'messy',
    make: () => crmExportCsv(),
  },
  { id: 'json', icon: Braces, name: 'customers-api.json', meta: '120 records · JSON', tag: 'nested', make: customersJson },
  { id: 'xml', icon: FileCode2, name: 'contacts.xml', meta: '60 records · XML', tag: 'xml', make: contactsXml },
  { id: 'large', icon: Database, name: 'large-50k.csv', meta: '50,000 rows · CSV', tag: 'perf', make: () => largeCsv() },
  { id: 'huge', icon: Database, name: 'huge-250k.csv', meta: '250,000 rows · 17 MB', tag: 'worker', make: () => largeCsv(250_000) },
] as const

/** Brand colors for the accent picker. `null` = the monochrome default. */
const ACCENTS = [
  { name: 'Mono', value: null, swatch: 'var(--foreground)' },
  { name: 'Blue', value: '#2563eb', swatch: '#2563eb' },
  { name: 'Violet', value: '#7c3aed', swatch: '#7c3aed' },
  { name: 'Emerald', value: '#059669', swatch: '#059669' },
  { name: 'Orange', value: '#ea580c', swatch: '#ea580c' },
  { name: 'Rose', value: '#e11d48', swatch: '#e11d48' },
] as const

type Scheme = 'light' | 'dark' | 'system'

function useColorScheme(scheme: Scheme): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const resolved = scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])
  return resolved
}

export function App() {
  const [scheme, setScheme] = useState<Scheme>('light')
  const [accent, setAccent] = useState<string | null>(null)
  const [locale, setLocale] = useState<'en' | 'de'>('en')
  const [invalidRows, setInvalidRows] = useState<'block' | 'skip'>('block')
  const [useAi, setUseAi] = useState(false)
  const [rememberRecipes, setRememberRecipes] = useState(true)
  const [runIn, setRunIn] = useState<'main' | 'worker' | 'auto'>('auto')
  const [dialog, setDialog] = useState(false)
  const [sample, setSample] = useState<string | null>(null)
  const [consoleTab, setConsoleTab] = useState<'output' | 'schema'>('output')
  const [output, setOutput] = useState<{ records: unknown[]; result: SubmitResult; ms: number } | null>(null)
  const resolved = useColorScheme(scheme)

  // The accent drives shadcn's --primary, which the importer inherits (see index.css).
  useEffect(() => {
    const root = document.documentElement.style
    if (accent) {
      root.setProperty('--primary', accent)
      root.setProperty('--primary-foreground', '#ffffff')
    } else {
      root.removeProperty('--primary')
      root.removeProperty('--primary-foreground')
    }
  }, [accent])

  const options = useMemo(() => ({ invalidRows, useAi, rememberRecipes }), [invalidRows, useAi, rememberRecipes])
  const importer = useMemo(() => makeImporter(options), [options])
  // Main thread, a Web Worker, or the worker only for files over 5 MB.
  const factory = useMemo(
    () =>
      runIn === 'main'
        ? undefined
        : workerSession({
            worker: () => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module', name: JSON.stringify(options) }),
            ...(runIn === 'auto' ? { above: 5 * 1024 * 1024 } : {}),
          }),
    [runIn, options],
  )
  const session = useImporterSession(importer, factory)
  const thread = useThread(session)
  const theme = useMemo(() => ({ colorScheme: resolved }), [resolved])
  const startedAt = useMemo(() => ({ current: 0 }), [])

  const onComplete = async (payload: { records: unknown[]; result: SubmitResult }) => {
    setOutput({ ...payload, ms: Math.round(performance.now() - startedAt.current) })
    setConsoleTab('output')
  }
  const loadSample = (s: (typeof SAMPLES)[number]) => {
    setSample(s.id)
    startedAt.current = performance.now()
    void session.loadFile(s.make())
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
        <a href="/" className="flex items-center gap-3" title="OpenImport home">
          <span className="grid size-7 place-items-center bg-primary text-primary-foreground">
            <Table2 className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">OpenImport</span>
          <span className="font-mono text-[13px] text-muted-foreground">/ playground</span>
          <Badge variant="outline" className="font-mono font-normal">
            v0.1.0
          </Badge>
        </a>
        <div className="flex items-center gap-1">
          <Button variant="ghost" asChild>
            <a href="/docs/">
              <BookOpen /> Docs
            </a>
          </Button>
          <Button variant="ghost" asChild>
            <a href="https://github.com/openimport/openimport" target="_blank" rel="noreferrer">
              <GithubMark /> GitHub
            </a>
          </Button>
          <Separator orientation="vertical" className="mx-2 h-5!" />
          <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={() => setScheme(resolved === 'dark' ? 'light' : 'dark')}>
            {resolved === 'dark' ? <Moon /> : <Sun />}
          </Button>
          <Button className="ml-2" onClick={() => setDialog(true)}>
            <PanelTop /> Open as dialog
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-r bg-sidebar">
          <Section title="Sample files" hint="click to load">
            <div className="border bg-background">
              {SAMPLES.map((s) => {
                const active = sample === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => loadSample(s)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-accent',
                      active && 'bg-accent shadow-[inset_2px_0_0_var(--primary)]',
                    )}
                  >
                    <s.icon className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-medium">{s.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">{s.meta}</span>
                    </span>
                    <span className="bg-muted px-1.5 py-0.5 font-mono text-[10px]">{s.tag}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="Appearance">
            <Field label="Theme">
              <Tabs value={scheme} onValueChange={(v) => setScheme(v as Scheme)}>
                <TabsList className="w-full">
                  <TabsTrigger value="light">Light</TabsTrigger>
                  <TabsTrigger value="dark">Dark</TabsTrigger>
                  <TabsTrigger value="system">System</TabsTrigger>
                </TabsList>
              </Tabs>
            </Field>
            <Field label="Accent">
              <div className="flex gap-2" role="radiogroup" aria-label="Accent">
                {ACCENTS.map((a) => {
                  const selected = accent === a.value
                  return (
                    <button
                      key={a.name}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={a.name}
                      title={a.name}
                      onClick={() => setAccent(a.value)}
                      className={cn(
                        'grid size-7 place-items-center border p-[3px] transition-colors',
                        selected ? 'border-2 border-foreground' : 'hover:border-foreground/40',
                      )}
                    >
                      <span className="grid size-full place-items-center" style={{ background: a.swatch }}>
                        {selected && <Check className="size-3 text-background mix-blend-difference" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Field>
            <Field label="Language">
              <Select value={locale} onValueChange={(v) => setLocale(v as 'en' | 'de')}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Behaviour">
            <Field label="Rows with errors">
              <Tabs value={invalidRows} onValueChange={(v) => setInvalidRows(v as 'block' | 'skip')}>
                <TabsList className="w-full">
                  <TabsTrigger value="block">Block import</TabsTrigger>
                  <TabsTrigger value="skip">Skip</TabsTrigger>
                </TabsList>
              </Tabs>
            </Field>
            <Toggle id="ai" label="Demo AI matcher" checked={useAi} onChange={setUseAi} />
            <Toggle id="recipes" label="Remember mappings (recipes)" checked={rememberRecipes} onChange={setRememberRecipes} />
            <Field label="Run imports in">
              <Tabs value={runIn} onValueChange={(v) => setRunIn(v as 'main' | 'worker' | 'auto')}>
                <TabsList className="w-full">
                  <TabsTrigger value="main">Main thread</TabsTrigger>
                  <TabsTrigger value="worker">Worker</TabsTrigger>
                  <TabsTrigger value="auto">Auto</TabsTrigger>
                </TabsList>
              </Tabs>
              <span className="font-mono text-[11px] text-muted-foreground">
                {runIn === 'auto' ? 'worker for files over 5 MB · ' : ''}now:{' '}
                <span data-testid="thread" className="text-foreground">
                  {thread}
                </span>
              </span>
            </Field>
          </Section>

          <div className="mt-auto flex items-center gap-2 border-t px-5 py-4 font-mono text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Runs locally · nothing is uploaded
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 px-8 py-7">
            <div className="flex items-end justify-between gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">examples / contacts.schema.ts</span>
                <h1 className="text-2xl font-semibold tracking-tight">Contacts importer</h1>
                <p className="text-sm text-muted-foreground">
                  {contacts.fields.length} fields — enums, dates, numbers, a unique email and a nested address.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    session.reset()
                    setSample(null)
                    setOutput(null)
                  }}
                >
                  <RotateCcw /> Reset session
                </Button>
                <Button variant="outline" onClick={() => setConsoleTab(consoleTab === 'schema' ? 'output' : 'schema')}>
                  <Code /> {consoleTab === 'schema' ? 'Hide schema' : 'View schema'}
                </Button>
              </div>
            </div>

            <div className="h-[760px]">
              <Importer
                importer={importer}
                session={session}
                title="Import contacts"
                theme={theme}
                locale={locale}
                onComplete={onComplete}
                className="h-full"
              />
            </div>

            <Console tab={consoleTab} output={output} />
          </div>
        </main>
      </div>

      <ImporterDialog
        importer={importer}
        open={dialog}
        onOpenChange={setDialog}
        title="Import contacts"
        theme={theme}
        locale={locale}
        onComplete={onComplete}
      />
    </div>
  )
}

/** GitHub's mark (Primer Octicons `mark-github`, MIT). Lucide no longer ships brand icons. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}

/** Which thread the current import runs on, for the playground's indicator. */
function useThread(session: SessionLike<any>): 'main thread' | 'worker' {
  // Re-render on state changes: an adaptive session decides per file.
  useImportState((s) => s.file, Object.is, session)
  if (session instanceof RemoteSession) return 'worker'
  if (session instanceof AdaptiveSession) return session.runsIn === 'worker' ? 'worker' : 'main thread'
  return 'main thread'
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 border-b px-5 py-5">
      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span className="font-medium tracking-[0.08em] uppercase">{title}</span>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  )
}

function Console({ tab, output }: { tab: 'output' | 'schema'; output: { records: unknown[]; result: SubmitResult; ms: number } | null }) {
  const [copied, setCopied] = useState(false)
  const lines = useMemo(() => {
    if (tab === 'schema') {
      return JSON.stringify(
        contacts.fields.map(({ key, type, required, unique, options }) => ({
          key,
          type,
          ...(required ? { required } : {}),
          ...(unique ? { unique } : {}),
          ...(options ? { options: options.map((o) => o.value) } : {}),
        })),
        null,
        2,
      ).split('\n')
    }
    if (!output) return []
    const head = JSON.stringify(output.records.slice(0, 2), null, 2).split('\n')
    const rest = output.records.length - 2
    return rest > 0 ? [...head.slice(0, -1), `  … ${rest.toLocaleString()} more`, ']'] : head
  }, [tab, output])

  const copy = async () => {
    const text = tab === 'schema' ? lines.join('\n') : JSON.stringify(output?.records ?? [], null, 2)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <section className="border border-border bg-console text-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 font-mono text-[11px]">
        <div className="flex items-center gap-2.5">
          <span className={cn('size-1.5', tab === 'schema' || output ? 'bg-success' : 'bg-zinc-600')} />
          <span className="font-medium text-zinc-50">{tab === 'schema' ? 'contacts.schema' : 'onComplete()'}</span>
          <span className="text-zinc-400">
            {tab === 'schema'
              ? `${contacts.fields.length} fields`
              : output
                ? `${output.records.length.toLocaleString()} records · ${output.result.skipped.toLocaleString()} skipped · ${output.ms.toLocaleString()} ms`
                : 'waiting for an import…'}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          disabled={!lines.length}
          className="text-zinc-400 transition-colors hover:text-zinc-50 disabled:opacity-40"
          aria-label="Copy"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto px-4 py-3.5 font-mono text-xs leading-5">
        {lines.length ? (
          lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
            <div key={i} className="flex gap-4">
              <span className="w-5 shrink-0 text-right text-zinc-600 select-none">{i + 1}</span>
              <span className={line.trimStart().startsWith('…') ? 'text-zinc-500' : undefined}>{line}</span>
            </div>
          ))
        ) : (
          <span className="text-zinc-500">Load a sample or drop a file above, then import to see the records your app receives.</span>
        )}
      </pre>
    </section>
  )
}
