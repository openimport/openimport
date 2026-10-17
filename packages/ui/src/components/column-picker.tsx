import { type FieldDefinition, type Mapping, type SourceField, scoreMatch } from '@openimport/core'
import { Command } from 'cmdk'
import { type ReactNode, useMemo, useState } from 'react'
import { useUi } from '../context'
import { Check, ChevronDown, Search, X } from '../icons'
import { cx, display } from '../utils'
import { Popover } from './primitives'

export interface ColumnPickerProps {
  field: FieldDefinition
  /** Selected source key (single-column mapping). */
  value: string | undefined
  sourceFields: SourceField[]
  mapping: Mapping
  fieldLabels: Record<string, string>
  onSelect: (sourceKey: string | null) => void
  /** Custom trigger content; defaults to the selected column. */
  trigger?: ReactNode
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** Hide the "don't import" entry (e.g. when adding a column to a combination). */
  allowClear?: boolean
}

export function ColumnPicker({
  field,
  value,
  sourceFields,
  mapping,
  fieldLabels,
  onSelect,
  trigger,
  placeholder,
  invalid,
  disabled,
  allowClear = true,
}: ColumnPickerProps) {
  const { m, t } = useUi()
  const [open, setOpen] = useState(false)
  const selected = sourceFields.find((f) => f.key === value)

  const usedBy = useMemo(() => {
    const map = new Map<string, string>()
    for (const [target, fm] of Object.entries(mapping)) {
      if (target === field.key) continue
      for (const k of fm.sources) map.set(k, fieldLabels[target] ?? target)
    }
    return map
  }, [mapping, field.key, fieldLabels])

  const best = useMemo(
    () =>
      open
        ? sourceFields
            .map((s) => ({ s, score: scoreMatch(field, s).score }))
            .filter((x) => x.score >= 0.45)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
        : [],
    [open, sourceFields, field],
  )
  const bestKeys = new Set(best.map((b) => b.s.key))

  const pick = (key: string | null) => {
    onSelect(key)
    setOpen(false)
  }

  const item = (s: SourceField, score?: number) => {
    const used = usedBy.get(s.key)
    return (
      <Command.Item
        key={s.key}
        value={`${s.key} ${s.label}`}
        keywords={s.samples.map((x) => display(x, 40))}
        onSelect={() => pick(s.key)}
        className="oi-cmd__item"
      >
        <span className="oi-cmd__check">{s.key === value && <Check aria-hidden />}</span>
        <span className="oi-cmd__main">
          <span className="oi-cmd__label">
            {s.label}
            {score !== undefined && <span className="oi-cmd__score">{Math.round(score * 100)}%</span>}
          </span>
          <span className="oi-cmd__samples">
            {s.samples.length ? (
              s.samples
                .slice(0, 3)
                .map((x) => display(x, 24))
                .join(' · ')
            ) : (
              <em>{m.mapping.empty}</em>
            )}
          </span>
        </span>
        {used && <span className="oi-cmd__used">{t(m.mapping.usedBy, { field: used })}</span>}
      </Command.Item>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={340}
      trigger={
        <button
          type="button"
          className={cx('oi-picker', !selected && 'oi-picker--empty', invalid && 'oi-picker--invalid')}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {trigger ?? <span className="oi-picker__value">{selected ? selected.label : (placeholder ?? m.mapping.selectColumn)}</span>}
          <ChevronDown aria-hidden className="oi-picker__chevron" />
        </button>
      }
    >
      <Command className="oi-cmd" loop>
        <div className="oi-cmd__search">
          <Search aria-hidden />
          <Command.Input placeholder={m.mapping.searchColumns} autoFocus />
        </div>
        <Command.List className="oi-cmd__list">
          <Command.Empty className="oi-cmd__empty">{m.mapping.noColumns}</Command.Empty>
          {best.length > 0 && <Command.Group heading={m.mapping.suggested}>{best.map((b) => item(b.s, b.score))}</Command.Group>}
          <Command.Group heading={m.mapping.allColumns}>
            {sourceFields.filter((s) => !bestKeys.has(s.key)).map((s) => item(s))}
          </Command.Group>
          {allowClear && value && (
            <Command.Group>
              <Command.Item value="__none__" onSelect={() => pick(null)} className="oi-cmd__item oi-cmd__item--muted">
                <span className="oi-cmd__check">
                  <X aria-hidden />
                </span>
                {m.mapping.dontImport}
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Popover>
  )
}
