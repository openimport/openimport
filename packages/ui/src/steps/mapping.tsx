import type { FieldPreview } from '@openimport/core'
import { type MappingField, useImportState, useMapping, useSession, useSessionQuery } from '@openimport/react'
import { Fragment, useMemo, useState } from 'react'
import { ColumnPicker } from '../components/column-picker'
import { Badge, Button, IconButton, Progress, Tooltip } from '../components/primitives'
import { useUi } from '../context'
import { AlertCircle, ArrowRight, Bookmark, Check, Combine, Info, RotateCcw, Sparkles, Wand2, X } from '../icons'
import { cx, display } from '../utils'
import { FieldEditor } from './field-editor'

const TYPE_LABEL: Record<string, string> = {
  string: 'Text',
  number: 'Number',
  integer: 'Integer',
  boolean: 'Yes / No',
  date: 'Date',
  datetime: 'Date & time',
  email: 'Email',
  url: 'URL',
  enum: 'Option',
}

export function MappingStep() {
  const session = useSession()
  const { m, t } = useUi()
  const mapping = useMapping()
  const rawMapping = useImportState((s) => s.mapping)
  const [editing, setEditing] = useState<string | null>(null)
  const fieldLabels = useMemo(() => Object.fromEntries(session.schema.fields.map((f) => [f.key, f.label])), [session])
  const total = mapping.fields.length

  // Group fields, required first within the natural order.
  const groups = useMemo(() => {
    const out = new Map<string, MappingField[]>()
    for (const f of mapping.fields) {
      const g = f.field.group ?? ''
      out.set(g, [...(out.get(g) ?? []), f])
    }
    return [...out.entries()]
  }, [mapping.fields])

  return (
    <div className="oi-step oi-mapping">
      <div className="oi-mapping__summary">
        <div className="oi-mapping__progress">
          <div className="oi-row oi-row--between">
            <span className="oi-strong">{t(m.mapping.progress, { mapped: mapping.mappedCount, total })}</span>
            {mapping.requiredMissing.length > 0 ? (
              <span className="oi-text-danger">
                <AlertCircle aria-hidden /> {t(m.mapping.requiredMissing, { count: mapping.requiredMissing.length })}
              </span>
            ) : (
              <span className="oi-text-success">
                <Check aria-hidden /> {m.mapping.allRequired}
              </span>
            )}
          </div>
          <Progress
            value={mapping.mappedCount}
            max={total}
            tone={mapping.requiredMissing.length ? 'accent' : 'success'}
            label={t(m.mapping.progress, { mapped: mapping.mappedCount, total })}
          />
        </div>
        <div className="oi-row">
          <Button size="sm" variant="ghost" icon={<Sparkles aria-hidden />} onClick={() => session.autoMap()}>
            {m.mapping.autoMap}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw aria-hidden />}
            onClick={() => session.clearMapping()}
            disabled={!mapping.mappedCount}
          >
            {m.mapping.clear}
          </Button>
        </div>
      </div>

      {mapping.recipe && (
        <div className="oi-banner">
          <Bookmark aria-hidden />
          <span>{t(m.mapping.recipe, { name: mapping.recipe.name ? ` “${mapping.recipe.name}”` : '' })}</span>
          <Button size="sm" variant="ghost" onClick={() => session.clearMapping()}>
            {m.mapping.recipeReset}
          </Button>
        </div>
      )}

      <div className="oi-map" role="table" aria-label={m.mapping.heading}>
        <div className="oi-map__head" role="row">
          <span role="columnheader">{m.mapping.field}</span>
          <span role="columnheader" aria-hidden />
          <span role="columnheader">{m.mapping.column}</span>
          <span role="columnheader">{m.mapping.preview}</span>
        </div>
        {groups.map(([group, fields]) => (
          <Fragment key={group || '_'}>
            {group && (
              <div className="oi-map__group" role="row">
                <span role="cell">{group}</span>
              </div>
            )}
            {fields.map((f) => (
              <Fragment key={f.field.key}>
                <FieldRow
                  item={f}
                  fieldLabels={fieldLabels}
                  editing={editing === f.field.key}
                  onEdit={() => setEditing(editing === f.field.key ? null : f.field.key)}
                />
                {editing === f.field.key && (
                  <div className="oi-map__editor" role="row">
                    <div role="cell">
                      <FieldEditor field={f.field} mapping={rawMapping[f.field.key]} onClose={() => setEditing(null)} />
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </div>

      <div className="oi-unused">
        <span className="oi-unused__title">{m.mapping.unused}</span>
        {mapping.unusedSources.length ? (
          <div className="oi-unused__list">
            {mapping.unusedSources.map((s) => (
              <Tooltip
                key={s.key}
                content={
                  s.samples.length
                    ? s.samples
                        .slice(0, 3)
                        .map((x) => display(x, 30))
                        .join(' · ')
                    : m.mapping.empty
                }
              >
                <span className="oi-chip oi-chip--muted">{s.label}</span>
              </Tooltip>
            ))}
          </div>
        ) : (
          <span className="oi-muted">{m.mapping.unusedNone}</span>
        )}
      </div>
    </div>
  )
}

function FieldRow({
  item,
  fieldLabels,
  editing,
  onEdit,
}: {
  item: MappingField
  fieldLabels: Record<string, string>
  editing: boolean
  onEdit: () => void
}) {
  const session = useSession()
  const { m, t } = useUi()
  const { field, mapping, sources, suggestion, status } = item
  const allMapping = useImportState((s) => s.mapping)
  const sourceFields = useImportState((s) => s.sourceFields)
  const composite = !!mapping && (mapping.sources.length > 1 || !!mapping.transforms?.length)
  const preview = useSessionQuery<FieldPreview[]>(
    () => (mapping ? session.previewField(field.key, mapping, 3) : []),
    [session, field.key, mapping],
    [],
  )
  const valueMapCount = mapping?.valueMap ? Object.keys(mapping.valueMap).length : 0

  return (
    <div className={cx('oi-map__row', `is-${status}`, editing && 'is-editing')} role="row">
      <div className="oi-map__field" role="cell">
        <span className={cx('oi-status', `oi-status--${status}`)} aria-hidden>
          {status === 'mapped' ? <Check /> : status === 'missing' ? <AlertCircle /> : null}
        </span>
        <div className="oi-map__field-text">
          <span className="oi-map__label">
            {field.label}
            {field.required && (
              <span className="oi-required" title={m.mapping.required}>
                *
              </span>
            )}
            {field.description && (
              <Tooltip content={field.description}>
                <button type="button" className="oi-info" aria-label={field.description}>
                  <Info aria-hidden />
                </button>
              </Tooltip>
            )}
          </span>
          <span className="oi-map__type">
            {TYPE_LABEL[field.type] ?? field.type}
            {field.multiple ? ' · list' : ''}
            {field.unique ? ' · unique' : ''}
          </span>
        </div>
      </div>

      <div className="oi-map__arrow" role="cell" aria-hidden>
        <ArrowRight />
      </div>

      <div className="oi-map__source" role="cell">
        <div className="oi-row oi-row--tight">
          {composite ? (
            <button type="button" className="oi-picker oi-picker--composite" onClick={onEdit}>
              <Combine aria-hidden />
              <span className="oi-picker__value">{sources.map((s) => s.label).join(' + ')}</span>
            </button>
          ) : (
            <ColumnPicker
              field={field}
              value={mapping?.sources[0]}
              sourceFields={sourceFields}
              mapping={allMapping}
              fieldLabels={fieldLabels}
              onSelect={(key) => session.assign(field.key, key)}
              invalid={status === 'missing'}
            />
          )}
          <IconButton
            label={m.mapping.configure}
            onClick={onEdit}
            className={cx('oi-map__configure', editing && 'is-active')}
            disabled={!sourceFields.length}
          >
            <Wand2 aria-hidden />
          </IconButton>
        </div>
        <div className="oi-map__badges">
          {mapping?.origin === 'recipe' && (
            <Badge tone="accent">
              <Bookmark aria-hidden /> {m.mapping.fromRecipe}
            </Badge>
          )}
          {mapping?.origin === 'suggestion' && mapping.confidence !== undefined && (
            <Badge tone={mapping.confidence >= 0.9 ? 'success' : 'neutral'}>
              <Sparkles aria-hidden /> {t(m.mapping.match, { confidence: Math.round(mapping.confidence * 100) })}
            </Badge>
          )}
          {composite && (
            <Badge>{mapping.sources.length > 1 ? t(m.mapping.combined, { count: mapping.sources.length }) : m.mapping.transformed}</Badge>
          )}
          {valueMapCount > 0 && <Badge>{t(m.mapping.valuesMapped, { count: valueMapCount })}</Badge>}
          {!mapping && suggestion && (
            <span className="oi-suggestion">
              {t(m.mapping.suggestion, { column: suggestion.sourceFields.map((s) => s.label).join(' + ') })}
              <span className="oi-muted"> · {Math.round(suggestion.confidence * 100)}%</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  session.setMapping(field.key, {
                    sources: suggestion.sources,
                    ...(suggestion.transforms ? { transforms: suggestion.transforms } : {}),
                    origin: 'suggestion',
                    confidence: suggestion.confidence,
                  })
                }
              >
                {m.mapping.useSuggestion}
              </Button>
            </span>
          )}
        </div>
      </div>

      <div className="oi-map__preview" role="cell">
        {preview.length === 0 ? (
          <span className="oi-muted">—</span>
        ) : (
          preview.map((p) => (
            <Tooltip key={p.rowId} content={p.issue ? `${display(p.transformed, 60)} — ${p.issue.message}` : undefined}>
              <span
                className={cx(
                  'oi-pill',
                  p.issue && 'oi-pill--error',
                  (p.output === undefined || p.output === '') && !p.issue && 'oi-pill--empty',
                )}
                tabIndex={p.issue ? 0 : undefined}
              >
                {p.issue ? <X aria-hidden /> : null}
                {p.issue ? display(p.transformed, 28) : p.output === undefined || p.output === '' ? m.mapping.empty : display(p.output, 28)}
              </span>
            </Tooltip>
          ))
        )}
      </div>
    </div>
  )
}
