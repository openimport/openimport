import type { Importer as ImporterEngine, SessionLike, SubmitHandler, SubmitResult } from '@openimport/core'
import { ImporterProvider, useImporterSession, useImportState, useMapping, useReview, useSession } from '@openimport/react'
import { Dialog, Tooltip as RTooltip } from 'radix-ui'
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Alert, Button, IconButton, Progress, Spinner } from './components/primitives'
import { type ImporterTheme, themeStyle, UiContext, type UiContextValue, useUi } from './context'
import { type Messages, type MessagesOverride, resolveMessages } from './i18n'
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, X } from './icons'
import { CompleteStep } from './steps/complete'
import { DatasetStep } from './steps/dataset'
import { HeaderStep } from './steps/header'
import { MappingStep } from './steps/mapping'
import { ReviewStep } from './steps/review'
import { UploadStep } from './steps/upload'
import { cx, formatBytes } from './utils'

export interface ImporterProps<T> {
  /** The engine from `createImporter()`. */
  importer: ImporterEngine<T>
  /** Drive an existing session instead of creating one, e.g. a worker session from `@openimport/worker`. */
  session?: SessionLike<T>
  title?: ReactNode
  /**
   * Persist records here: called with batches of valid records while the user
   * waits. Throw to show an error (rows sent so far stay imported and a retry
   * sends the rest) or return `{ rejected }` to send rows back to review.
   * Overrides the importer's `onSubmit`.
   */
  onSubmit?: SubmitHandler<T>
  /**
   * A notification after the import succeeded. `records` holds every accepted
   * record when submission went through this component (`onSubmit` prop, or
   * no `onSubmit` at all); it's empty when the importer's own `onSubmit`
   * persisted them. Don't persist here — the user already sees "Import complete".
   */
  onComplete?: (payload: { records: T[]; result: SubmitResult }) => void | Promise<void>
  /** Shows a close button. */
  onClose?: () => void
  locale?: 'en' | 'de' | Messages
  messages?: MessagesOverride
  theme?: ImporterTheme
  /** Offer a CSV template download on the upload step. Default `true`. */
  templateDownload?: boolean
  className?: string
  style?: CSSProperties
}

export interface ImporterUiProviderProps {
  locale?: 'en' | 'de' | Messages
  messages?: MessagesOverride
  theme?: ImporterTheme
  maxFileSize?: number
  templateDownload?: boolean
  children: ReactNode
}

/**
 * Messages, theme and tooltip context for the UI building blocks. `<Importer>`
 * includes it; use it directly when composing steps into a custom layout.
 */
export function ImporterUiProvider({ locale, messages, theme, maxFileSize, templateDownload, children }: ImporterUiProviderProps) {
  const resolved = useMemo(() => resolveMessages(locale, messages), [locale, messages])
  const lang = typeof locale === 'string' ? locale : 'en'
  const scheme = theme?.colorScheme ?? 'auto'
  const style = useMemo(() => themeStyle(theme), [theme])
  const ui = useMemo<UiContextValue>(
    () => ({
      messages: resolved,
      lang,
      themeProps: { className: 'oi-theme', style, 'data-theme': scheme },
      ...(maxFileSize ? { maxFileSize } : {}),
      templateDownload: templateDownload ?? true,
    }),
    [resolved, lang, style, scheme, maxFileSize, templateDownload],
  )
  return (
    <UiContext.Provider value={ui}>
      <RTooltip.Provider delayDuration={200}>{children}</RTooltip.Provider>
    </UiContext.Provider>
  )
}

/** The complete, ready-made import experience. */
export function Importer<T>(props: ImporterProps<T>) {
  const owned = useImporterSession(props.importer)
  const session = props.session ?? owned
  const scheme = props.theme?.colorScheme ?? 'auto'
  const style = useMemo(() => themeStyle(props.theme), [props.theme])
  const lang = typeof props.locale === 'string' ? props.locale : 'en'

  return (
    <ImporterUiProvider
      {...(props.locale ? { locale: props.locale } : {})}
      {...(props.messages ? { messages: props.messages } : {})}
      {...(props.theme ? { theme: props.theme } : {})}
      {...(props.importer.config.maxFileSize ? { maxFileSize: props.importer.config.maxFileSize } : {})}
      {...(props.templateDownload !== undefined ? { templateDownload: props.templateDownload } : {})}
    >
      <ImporterProvider session={session}>
        <div className={cx('oi-theme oi-root', props.className)} data-theme={scheme} style={{ ...style, ...props.style }} lang={lang}>
          <Shell {...props} />
        </div>
      </ImporterProvider>
    </ImporterUiProvider>
  )
}

const PHASES = ['upload', 'mapping', 'review', 'complete'] as const
let warnedNoSubmit = false
const phaseOf = (step: string) => (step === 'dataset' || step === 'header' ? 'upload' : step === 'submitting' ? 'review' : step)

function Shell<T>({ title, onClose, onComplete, onSubmit }: ImporterProps<T>) {
  const session = useSession<T>()
  const { m, t } = useUi()
  const step = useImportState((s) => s.step)
  const busy = useImportState((s) => s.busy)
  const error = useImportState((s) => s.error)
  const file = useImportState((s) => s.file)
  const rowCount = useImportState((s) => s.rowCount)
  const progress = useImportState((s) => s.progress)
  const phase = phaseOf(step)
  const phaseIndex = PHASES.indexOf(phase as (typeof PHASES)[number])

  // Records accepted across attempts (a failed batch can be retried), for onComplete.
  const collected = useRef<T[]>([])
  useEffect(() => {
    if (step === 'upload') collected.current = []
  }, [step])

  const submit = async () => {
    // Persistence configured on the importer runs where the session runs (in
    // a worker: records never cross to the page), so don't intercept it.
    if (!onSubmit && session.importer.config.onSubmit) {
      const result = await session.submit()
      if (result && onComplete) await notify({ records: [], result })
      return
    }
    if (!onSubmit && !warnedNoSubmit) {
      warnedNoSubmit = true
      console.warn(
        '[openimport] No onSubmit handler: records are only passed to onComplete. Persist them in onSubmit so failures are shown to the user.',
      )
    }
    const result = await session.submit(async (batch) => {
      // Persistence first; only batches it accepts are reported to onComplete.
      const feedback = onSubmit ? await onSubmit(batch) : undefined
      const rejected = new Set(feedback?.rejected?.map((r) => r.rowId))
      batch.rows.forEach((row, i) => {
        if (!rejected.has(row.id)) collected.current.push(batch.records[i] as T)
      })
      return feedback
    })
    if (result && onComplete) await notify({ records: collected.current, result })
  }

  const notify = async (payload: { records: T[]; result: SubmitResult }) => {
    try {
      // A notification: the import has already succeeded at this point.
      await onComplete?.(payload)
    } catch (error) {
      console.error('[openimport] onComplete failed', error)
    }
  }

  return (
    <>
      <header className="oi-header">
        <div className="oi-header__title">
          <h2>{title ?? m.title}</h2>
          {file && phase !== 'upload' && (
            <span className="oi-file">
              <FileSpreadsheet aria-hidden />
              <span className="oi-file__name">{file.name}</span>
              <span className="oi-muted">
                {formatBytes(file.size)}
                {rowCount ? ` · ${t(m.review.rowCount, { count: rowCount })}` : ''}
              </span>
            </span>
          )}
        </div>
        {onClose && (
          <IconButton label={m.close} onClick={onClose} className="oi-header__close">
            <X aria-hidden />
          </IconButton>
        )}
      </header>

      <nav className="oi-stepper" aria-label="Progress">
        <ol>
          {PHASES.map((p, i) => (
            <li
              key={p}
              className={cx(i < phaseIndex && 'is-done', i === phaseIndex && 'is-current')}
              aria-current={i === phaseIndex ? 'step' : undefined}
            >
              <span className="oi-stepper__dot">{i < phaseIndex ? <Check aria-hidden /> : i + 1}</span>
              <span className="oi-stepper__label">{m.steps[p]}</span>
            </li>
          ))}
        </ol>
      </nav>

      <main className="oi-body">
        {error && (
          <div className="oi-body__alert">
            <Alert onDismiss={() => session.clearError()}>{error.message}</Alert>
          </div>
        )}
        {step === 'upload' && <UploadStep />}
        {step === 'dataset' && <DatasetStep />}
        {step === 'header' && <HeaderStep />}
        {step === 'mapping' && <MappingStep />}
        {(step === 'review' || step === 'submitting') && <ReviewStep />}
        {step === 'complete' && <CompleteStep />}
        {busy && busy !== 'submitting' && step !== 'upload' && (
          <div className="oi-overlay" aria-live="polite">
            <Spinner label={busy === 'validating' ? t(m.busy.validating, { count: rowCount }) : m.busy[busy]} />
            {progress && <Progress value={progress.processed} max={progress.total} />}
          </div>
        )}
        {step === 'submitting' && (
          <div className="oi-overlay" aria-live="polite">
            <Spinner label={t(m.busy.submitting, { processed: progress?.processed ?? 0, total: progress?.total ?? 0 })} />
            <Progress value={progress?.processed ?? 0} max={progress?.total ?? 1} />
          </div>
        )}
      </main>

      <Footer onSubmit={submit} onClose={onClose} />
    </>
  )
}

function Footer({ onSubmit, onClose }: { onSubmit: () => void; onClose: (() => void) | undefined }) {
  const session = useSession()
  const step = useImportState((s) => s.step)
  const busy = useImportState((s) => s.busy)
  const { m } = useUi()
  const canBack = useImportState((s) => s.canGoBack) && step !== 'upload'

  if (step === 'upload' || step === 'dataset') {
    return canBack ? (
      <footer className="oi-footer">
        <Button variant="ghost" icon={<ArrowLeft aria-hidden />} onClick={() => session.back()}>
          {m.back}
        </Button>
      </footer>
    ) : null
  }
  if (step === 'complete') {
    return onClose ? (
      <footer className="oi-footer oi-footer--end">
        <Button variant="primary" onClick={onClose}>
          {m.close}
        </Button>
      </footer>
    ) : null
  }

  return (
    <footer className="oi-footer">
      <Button variant="ghost" icon={<ArrowLeft aria-hidden />} onClick={() => session.back()} disabled={!canBack || !!busy}>
        {m.back}
      </Button>
      <div className="oi-footer__info">
        {step === 'mapping' && <MappingInfo />}
        {(step === 'review' || step === 'submitting') && <ReviewInfo />}
      </div>
      {step === 'header' && (
        <Button variant="primary" onClick={() => session.confirmHeader()} loading={!!busy}>
          {m.continue} <ArrowRight aria-hidden />
        </Button>
      )}
      {step === 'mapping' && <MappingContinue />}
      {(step === 'review' || step === 'submitting') && <ReviewSubmit onSubmit={onSubmit} />}
    </footer>
  )
}

function MappingInfo() {
  const { m, t } = useUi()
  const { requiredMissing } = useMapping()
  if (!requiredMissing.length) return null
  return (
    <span className="oi-text-danger">
      {t(m.mapping.requiredMissing, { count: requiredMissing.length })}: {requiredMissing.map((f) => f.label).join(', ')}
    </span>
  )
}

function MappingContinue() {
  const session = useSession()
  const { m } = useUi()
  const { canConfirm, isBusy } = useMapping()
  return (
    <Button variant="primary" onClick={() => session.confirmMapping()} disabled={!canConfirm} loading={isBusy}>
      {m.continue} <ArrowRight aria-hidden />
    </Button>
  )
}

function ReviewInfo() {
  const session = useSession()
  const { m, t } = useUi()
  const { stats } = useReview()
  const mode = session.importer.config.invalidRows ?? 'block'
  if (!stats.withErrors) return <span className="oi-text-success">{t(m.review.ready, { count: stats.valid })}</span>
  return (
    <span className={mode === 'block' ? 'oi-text-danger' : 'oi-muted'}>
      {mode === 'block' ? t(m.review.blocked, { count: stats.withErrors }) : t(m.review.skipping, { count: stats.withErrors })}
    </span>
  )
}

function ReviewSubmit({ onSubmit }: { onSubmit: () => void }) {
  const { m, t } = useUi()
  const { stats, canSubmit } = useReview()
  const busy = useImportState((s) => s.busy)
  return (
    <Button variant="primary" onClick={onSubmit} disabled={!canSubmit} loading={busy === 'submitting'}>
      {t(m.review.submit, { count: stats.valid })}
    </Button>
  )
}

export interface ImporterDialogProps<T> extends Omit<ImporterProps<T>, 'onClose'> {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional element that opens the dialog. */
  trigger?: ReactNode
}

/** `<Importer>` in an accessible modal dialog. */
export function ImporterDialog<T>({ open, onOpenChange, trigger, ...props }: ImporterDialogProps<T>) {
  const scheme = props.theme?.colorScheme ?? 'auto'
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="oi-theme oi-dialog__overlay" data-theme={scheme} />
        <Dialog.Content className="oi-dialog" aria-describedby={undefined} onPointerDownOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="oi-sr-only">{typeof props.title === 'string' ? props.title : 'Import'}</Dialog.Title>
          <Importer
            {...(props as ImporterProps<T>)}
            className={cx('oi-root--dialog', props.className)}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
