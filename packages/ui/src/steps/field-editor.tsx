import type { ColumnOptions, FieldDefinition, FieldMapping, TransformDefinition, TransformStep } from '@openimport/core'
import { useImportState, useSession, useSessionQuery } from '@openimport/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ColumnPicker } from '../components/column-picker'
import { Button, IconButton, Input, Select } from '../components/primitives'
import { useUi } from '../context'
import { ArrowRight, Plus, Trash2, X } from '../icons'
import { cx, display } from '../utils'

interface Draft {
  sources: (string | undefined)[]
  combine: TransformStep
  steps: TransformStep[]
  options: ColumnOptions
  valueMap: Record<string, string>
  fallback: string
}

function toDraft(mapping: FieldMapping | undefined, many: TransformDefinition[]): Draft {
  const transforms = mapping?.transforms ?? []
  const manyOps = new Set(many.map((t) => t.op))
  const combine = transforms.find((t) => manyOps.has(t.op)) ?? { op: 'join', separator: ' ' }
  return {
    sources: mapping?.sources.length ? [...mapping.sources] : [undefined],
    combine,
    steps: transforms.filter((t) => t !== combine),
    options: mapping?.options ?? {},
    valueMap: mapping?.valueMap ?? {},
    fallback: mapping?.fallback === undefined ? '' : String(mapping.fallback),
  }
}

function fromDraft(draft: Draft): FieldMapping | null {
  const sources = draft.sources.filter((s): s is string => !!s)
  if (!sources.length && !draft.fallback) return null
  const transforms = [...(sources.length > 1 ? [draft.combine] : []), ...draft.steps]
  return {
    sources,
    ...(transforms.length ? { transforms } : {}),
    ...(Object.keys(draft.options).length ? { options: draft.options } : {}),
    ...(Object.keys(draft.valueMap).length ? { valueMap: draft.valueMap } : {}),
    ...(draft.fallback ? { fallback: draft.fallback } : {}),
    origin: 'user',
  }
}

export function FieldEditor({
  field,
  mapping,
  onClose,
}: {
  field: FieldDefinition
  mapping: FieldMapping | undefined
  onClose: () => void
}) {
  const session = useSession()
  const { m, t } = useUi()
  const sourceFields = useImportState((s) => s.sourceFields)
  const allMapping = useImportState((s) => s.mapping)
  const transforms = useMemo(() => [...session.importer.transforms.values()], [session])
  const many = transforms.filter((x) => x.arity === 'many')
  const one = transforms.filter((x) => x.arity === 'one')
  const [draft, setDraft] = useState<Draft>(() => toDraft(mapping, many))
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const fieldLabels = useMemo(() => Object.fromEntries(session.schema.fields.map((f) => [f.key, f.label])), [session])

  const candidate = useMemo(() => fromDraft(draft), [draft])
  const preview = useSessionQuery(
    () => (candidate ? session.previewField(field.key, candidate, 6) : []),
    [session, field.key, candidate],
    [],
  )
  // Distinct values only depend on the inputs (columns + transforms), not on the value map being edited.
  const { sources, combine, steps } = draft
  const distinct = useSessionQuery(
    () => {
      const input = fromDraft({ sources, combine, steps, options: {}, valueMap: {}, fallback: '' })
      return field.type === 'enum' && input?.sources.length ? session.distinctValues(field.key, input, 100) : []
    },
    [session, field, sources, combine, steps],
    [],
  )

  // The editor opens inline below its row — bring it into view, e.g. for the last fields.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    const body = el?.closest('.oi-body')
    if (!el || !body) return
    // Show it whole if it fits, otherwise start at its header.
    const fits = el.getBoundingClientRect().height <= body.clientHeight
    el.scrollIntoView({ block: fits ? 'nearest' : 'start', behavior: 'smooth' })
  }, [])

  const apply = () => {
    session.setMapping(field.key, fromDraft(draft))
    onClose()
  }

  const combineDef = many.find((x) => x.op === draft.combine.op)
  const multiple = draft.sources.filter(Boolean).length > 1

  return (
    <section ref={ref} className="oi-editor" aria-label={t(m.editor.title, { field: field.label })}>
      <header className="oi-editor__head">
        <h3>{t(m.editor.title, { field: field.label })}</h3>
        <IconButton label={m.close} onClick={onClose}>
          <X aria-hidden />
        </IconButton>
      </header>

      <div className="oi-editor__grid">
        <div className="oi-editor__config">
          {/* Sources */}
          <fieldset className="oi-fieldset">
            <legend>{m.editor.sources}</legend>
            <ol className="oi-sources">
              {draft.sources.map((key, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: position is identity here
                <li key={i} className="oi-row oi-row--tight">
                  <span className="oi-sources__index">{i + 1}</span>
                  <ColumnPicker
                    field={field}
                    value={key}
                    sourceFields={sourceFields}
                    mapping={allMapping}
                    fieldLabels={fieldLabels}
                    allowClear={false}
                    onSelect={(k) => update({ sources: draft.sources.map((s, j) => (j === i ? (k ?? undefined) : s)) })}
                  />
                  {draft.sources.length > 1 && (
                    <IconButton label={m.editor.remove} onClick={() => update({ sources: draft.sources.filter((_, j) => j !== i) })}>
                      <Trash2 aria-hidden />
                    </IconButton>
                  )}
                </li>
              ))}
            </ol>
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus aria-hidden />}
              onClick={() => update({ sources: [...draft.sources, undefined] })}
            >
              {draft.sources.filter(Boolean).length ? m.editor.combineWith : m.editor.addColumn}
            </Button>

            {multiple && (
              <div className="oi-editor__combine">
                <Select
                  value={draft.combine.op}
                  onValueChange={(op) => update({ combine: { op } })}
                  options={many.map((x) => ({ value: x.op, label: x.label }))}
                  {...(combineDef ? { 'aria-label': combineDef.label } : {})}
                />
                <StepParams def={combineDef} step={draft.combine} onChange={(combine) => update({ combine })} />
              </div>
            )}
          </fieldset>

          {/* One-to-one transformations */}
          <fieldset className="oi-fieldset">
            <legend>{m.editor.steps}</legend>
            {draft.steps.length === 0 && <p className="oi-muted oi-small">{m.editor.noSteps}</p>}
            <ol className="oi-steps">
              {draft.steps.map((step, i) => {
                const def = one.find((x) => x.op === step.op)
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: steps are ordered
                  <li key={i} className="oi-steps__item">
                    <Select
                      value={step.op}
                      onValueChange={(op) => update({ steps: draft.steps.map((s, j) => (j === i ? { op } : s)) })}
                      options={one.map((x) => ({ value: x.op, label: x.label }))}
                      aria-label={m.editor.steps}
                    />
                    <StepParams
                      def={def}
                      step={step}
                      onChange={(next) => update({ steps: draft.steps.map((s, j) => (j === i ? next : s)) })}
                    />
                    <IconButton label={m.editor.remove} onClick={() => update({ steps: draft.steps.filter((_, j) => j !== i) })}>
                      <Trash2 aria-hidden />
                    </IconButton>
                  </li>
                )
              })}
            </ol>
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus aria-hidden />}
              onClick={() => update({ steps: [...draft.steps, { op: 'split' }] })}
            >
              {m.editor.addStep}
            </Button>
          </fieldset>

          {/* Parsing options */}
          {(field.type === 'date' || field.type === 'datetime') && (
            <label className="oi-field">
              <span>{m.editor.dateOrder}</span>
              <Select
                value={draft.options.dateOrder ?? ''}
                onValueChange={(v) => update({ options: { ...draft.options, dateOrder: (v || undefined) as ColumnOptions['dateOrder'] } })}
                options={[
                  { value: '', label: m.editor.auto },
                  { value: 'DMY', label: 'DD.MM.YYYY' },
                  { value: 'MDY', label: 'MM/DD/YYYY' },
                  { value: 'YMD', label: 'YYYY-MM-DD' },
                ]}
                aria-label={m.editor.dateOrder}
              />
            </label>
          )}
          {(field.type === 'number' || field.type === 'integer') && (
            <label className="oi-field">
              <span>{m.editor.decimal}</span>
              <Select
                value={draft.options.decimal ?? ''}
                onValueChange={(v) => update({ options: { ...draft.options, decimal: (v || undefined) as ColumnOptions['decimal'] } })}
                options={[
                  { value: '', label: m.editor.auto },
                  { value: '.', label: '1,234.56' },
                  { value: ',', label: '1.234,56' },
                ]}
                aria-label={m.editor.decimal}
              />
            </label>
          )}

          {/* biome-ignore lint/a11y/noLabelWithoutControl: the control is a conditional Select or Input */}
          <label className="oi-field">
            <span>{m.editor.fallback}</span>
            {field.type === 'enum' ? (
              <Select
                value={draft.fallback}
                onValueChange={(fallback) => update({ fallback })}
                options={[{ value: '', label: '—' }, ...(field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }))]}
                aria-label={m.editor.fallback}
              />
            ) : (
              <Input
                value={draft.fallback}
                placeholder={m.editor.fallbackPlaceholder}
                onChange={(e) => update({ fallback: e.target.value })}
              />
            )}
          </label>
        </div>

        <div className="oi-editor__side">
          {field.type === 'enum' && distinct.length > 0 && (
            <div className="oi-values">
              <h4>{m.editor.values}</h4>
              <p className="oi-muted oi-small">{m.editor.valuesDescription}</p>
              <div className="oi-values__table">
                <div className="oi-values__head">
                  <span>{m.editor.sourceValue}</span>
                  <span />
                  <span>{m.editor.targetValue}</span>
                </div>
                {distinct.map((d) => {
                  const explicit = draft.valueMap[d.value]
                  const resolved = explicit ?? d.matched
                  return (
                    <div key={d.value} className={cx('oi-values__row', !resolved && 'is-unmatched')}>
                      <span className="oi-values__source">
                        {display(d.value, 40)} <span className="oi-muted">×{d.count}</span>
                      </span>
                      <ArrowRight aria-hidden />
                      <Select
                        value={resolved ?? ''}
                        aria-label={`${m.editor.targetValue}: ${d.value}`}
                        onValueChange={(v) => {
                          const valueMap = { ...draft.valueMap }
                          if (v) valueMap[d.value] = v
                          else delete valueMap[d.value]
                          update({ valueMap })
                        }}
                        options={[
                          { value: '', label: m.editor.unmatched },
                          ...(field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value })),
                        ]}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="oi-live">
            <h4>{m.editor.preview}</h4>
            <div className="oi-live__table">
              <div className="oi-live__head">
                <span>{m.editor.input}</span>
                <span />
                <span>{m.editor.output}</span>
              </div>
              {preview.map((p) => (
                <div key={p.rowId} className={cx('oi-live__row', p.issue && 'is-error')}>
                  <span className="oi-live__in">{p.inputs.map((v) => display(v, 30) || '∅').join(' │ ')}</span>
                  <ArrowRight aria-hidden />
                  <span className="oi-live__out">{p.issue ? p.issue.message : display(p.output, 40) || <em>{m.mapping.empty}</em>}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="oi-editor__foot">
        <Button variant="ghost" onClick={() => setDraft(toDraft(mapping, many))}>
          {m.editor.reset}
        </Button>
        <Button variant="primary" onClick={apply}>
          {m.editor.apply}
        </Button>
      </footer>
    </section>
  )
}

function StepParams({
  def,
  step,
  onChange,
}: {
  def: TransformDefinition | undefined
  step: TransformStep
  onChange: (s: TransformStep) => void
}) {
  if (!def?.params?.length) return null
  return (
    <div className="oi-params">
      {def.params.map((p) => {
        const value = step[p.name] ?? p.default ?? ''
        const set = (v: unknown) => onChange({ ...step, [p.name]: v })
        if (p.type === 'boolean')
          return (
            <label key={p.name} className="oi-check">
              <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} />
              {p.label}
            </label>
          )
        if (p.type === 'select')
          return (
            <Select
              key={p.name}
              aria-label={p.label}
              value={String(value)}
              onValueChange={set}
              options={(p.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            />
          )
        return (
          <label key={p.name} className="oi-param">
            <span>{p.label}</span>
            <Input
              type={p.type === 'number' ? 'number' : 'text'}
              value={String(value)}
              onChange={(e) => set(p.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className={p.type === 'number' ? 'oi-input--narrow' : undefined}
            />
          </label>
        )
      })}
    </div>
  )
}
