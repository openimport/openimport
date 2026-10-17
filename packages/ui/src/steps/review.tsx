import { type FieldDefinition, type Issue, type ReviewRow, stringify } from '@openimport/core'
import { type ReviewFilter, useReview, useSession } from '@openimport/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Popover, Segmented, Select } from '../components/primitives'
import { useUi } from '../context'
import { AlertCircle, ArrowRight, CheckCircle2, Download, Filter, Replace, Search, Trash2 } from '../icons'
import { cx, display, download, toCsv } from '../utils'

const ROW_HEIGHT = 36
/** Height of the sticky header inside the scroll container. */
const HEADER_HEIGHT = 38
const severityOf = (i: Issue) => i.severity ?? 'error'

interface Cell {
  row: number
  col: number
}

export function ReviewStep() {
  const session = useSession()
  const { m, t } = useUi()
  const fields = session.schema.fields
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [fieldFilter, setFieldFilter] = useState('')
  const [search, setSearch] = useState('')
  const query = useMemo(
    () => ({ filter, ...(fieldFilter ? { field: fieldFilter } : {}), ...(search ? { search } : {}) }),
    [filter, fieldFilter, search],
  )
  const review = useReview(query)
  const { total, getRow, stats, version } = review
  const [active, setActive] = useState<Cell | null>(null)
  const [editing, setEditing] = useState<{ cell: Cell; initial?: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // Rows start below the sticky header, which also covers the top of the viewport.
    scrollMargin: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  })

  // Start at the top whenever the filter changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter inputs only
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [filter, fieldFilter, search])

  // Keep the active cell inside the visible data when filters change.
  useEffect(() => {
    setActive((a) => (a && a.row >= total ? (total ? { row: total - 1, col: a.col } : null) : a))
  }, [total])
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(id)
  }, [notice])
  // Drop selections of rows that no longer exist.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the rows change
  useEffect(() => {
    if (!selected.size) return
    let live = true
    Promise.resolve(session.rowIds()).then((list) => {
      if (!live) return
      const ids = new Set(list)
      setSelected((s) => {
        const next = new Set([...s].filter((id) => ids.has(id)))
        return next.size === s.size ? s : next
      })
    })
    return () => {
      live = false
    }
  }, [session, version])

  // Fixed pixel widths keep the sticky header and the absolutely positioned rows aligned;
  // the last column stretches to fill wide containers.
  const { columns, width } = useMemo(() => {
    const widths = fields.map((f) => Math.min(Math.max(f.label.length * 8 + 64, 140), 280))
    const total = 40 + 64 + widths.reduce((a, b) => a + b, 0)
    const template = ['40px', '64px', ...widths.map((w, i) => (i === widths.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`))].join(' ')
    return { columns: template, width: total }
  }, [fields])

  const focusGrid = () => scrollRef.current?.focus({ preventScroll: true })
  const move = useCallback(
    (cell: Cell) => {
      const row = Math.max(0, Math.min(total - 1, cell.row))
      const col = Math.max(0, Math.min(fields.length - 1, cell.col))
      setActive({ row, col })
      virtualizer.scrollToIndex(row, { align: 'auto' })
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-col="${col}"]`)
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
    [total, fields.length, virtualizer],
  )

  const commit = (cell: Cell, value: string) => {
    const row = getRow(cell.row)
    const field = fields[cell.col]
    if (row && field && value !== cellText(row, field.key)) void session.editCell(row.id, field.key, value)
    setEditing(null)
    focusGrid()
  }

  const nextError = async () => {
    const hit = await session.findIssue(
      query,
      active,
      fields.map((f) => f.key),
    )
    if (!hit) return
    move(hit)
    focusGrid()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !total) return
    const a = active ?? { row: 0, col: 0 }
    const key = e.key
    if (key === 'ArrowDown') move({ ...a, row: a.row + 1 })
    else if (key === 'ArrowUp') move({ ...a, row: a.row - 1 })
    else if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) move({ ...a, col: a.col + 1 })
    else if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) move({ ...a, col: a.col - 1 })
    else if (key === 'PageDown') move({ ...a, row: a.row + 15 })
    else if (key === 'PageUp') move({ ...a, row: a.row - 15 })
    else if (key === 'Home') move({ ...a, col: 0 })
    else if (key === 'End') move({ ...a, col: fields.length - 1 })
    else if (key === 'Enter' || key === 'F2') setEditing({ cell: a })
    else if (key === 'Backspace' || key === 'Delete') commit(a, '')
    else if (key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) setEditing({ cell: a, initial: key })
    else return
    e.preventDefault()
    if (!active) setActive(a)
  }

  const activeRow = active ? getRow(active.row) : undefined
  const activeField = active ? fields[active.col] : undefined
  const activeIssues = activeRow && activeField ? activeRow.issues.filter((i) => i.field === activeField.key) : []
  const rowIssues = activeRow ? activeRow.issues.filter((i) => !i.field) : []

  const exportErrors = async () => {
    const invalid = await session.getRows({ filter: 'errors' }, 0, stats.withErrors)
    const header = ['Row', ...fields.map((f) => f.label), 'Errors']
    const body = invalid.map((r) => [
      String(r.sourceIndex),
      ...fields.map((f) => cellText(r, f.key)),
      r.issues.map((i) => `${i.field ? `${fields.find((f) => f.key === i.field)?.label ?? i.field}: ` : ''}${i.message}`).join('; '),
    ])
    download(toCsv([header, ...body]), 'rows-with-errors.csv')
  }

  const fieldsWithErrors = fields.filter((f) => stats.byField[f.key]?.errors)

  return (
    <div className="oi-step oi-review">
      <div className="oi-toolbar">
        <Segmented<ReviewFilter>
          label={m.review.heading}
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setActive(null)
          }}
          options={[
            {
              value: 'all',
              label: (
                <>
                  {m.review.all} <span className="oi-count">{stats.total.toLocaleString()}</span>
                </>
              ),
            },
            {
              value: 'errors',
              tone: 'danger',
              label: (
                <>
                  {m.review.errors} <span className="oi-count">{stats.withErrors.toLocaleString()}</span>
                </>
              ),
            },
            {
              value: 'valid',
              tone: 'success',
              label: (
                <>
                  {m.review.valid} <span className="oi-count">{stats.valid.toLocaleString()}</span>
                </>
              ),
            },
          ]}
        />
        {fieldsWithErrors.length > 0 && (
          <Select
            value={fieldFilter}
            onValueChange={setFieldFilter}
            aria-label={m.review.allFields}
            className="oi-toolbar__field"
            options={[
              { value: '', label: m.review.allFields },
              ...fieldsWithErrors.map((f) => ({
                value: f.key,
                label: `${t(m.review.errorsIn, { field: f.label })} (${stats.byField[f.key]?.errors ?? 0})`,
              })),
            ]}
          />
        )}
        <Input
          icon={<Search aria-hidden />}
          placeholder={m.review.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="oi-toolbar__search"
          aria-label={m.review.search}
        />
        <div className="oi-toolbar__spacer" />
        {stats.withErrors > 0 && (
          <Button size="sm" variant="ghost" icon={<ArrowRight aria-hidden />} onClick={nextError}>
            {m.review.nextError}
          </Button>
        )}
        <FindReplace fields={fields} onDone={(count) => setNotice(t(m.review.replaced, { count }))} />
        {stats.withErrors > 0 && (
          <Button size="sm" variant="ghost" icon={<Download aria-hidden />} onClick={exportErrors} title={m.review.exportErrors}>
            <span className="oi-sr-only">{m.review.exportErrors}</span>
          </Button>
        )}
        {selected.size > 0 ? (
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 aria-hidden />}
            onClick={() => {
              void session.deleteRows([...selected])
              setSelected(new Set())
            }}
          >
            {t(m.review.removeSelected, { count: selected.size })}
          </Button>
        ) : (
          stats.withErrors > 0 && (
            <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} onClick={() => void session.deleteInvalidRows()}>
              {t(m.review.removeInvalid, { count: stats.withErrors })}
            </Button>
          )
        )}
      </div>

      {notice && (
        <div className="oi-notice" role="status">
          <CheckCircle2 aria-hidden /> {notice}
        </div>
      )}

      <div
        ref={scrollRef}
        className="oi-grid"
        role="grid"
        aria-rowcount={total + 1}
        aria-colcount={fields.length + 2}
        aria-label={m.review.heading}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div className="oi-grid__inner" style={{ width }}>
          <div className="oi-grid__head" role="row" style={{ gridTemplateColumns: columns }}>
            <span role="columnheader" className="oi-grid__check">
              <input
                type="checkbox"
                aria-label={m.review.selectAll}
                checked={total > 0 && selected.size >= total}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < total
                }}
                onChange={async (e) => {
                  const checked = e.target.checked
                  setSelected(checked ? new Set(await session.rowIds(query)) : new Set())
                }}
              />
            </span>
            <span role="columnheader" className="oi-grid__num">
              #
            </span>
            {fields.map((f, c) => {
              const errors = stats.byField[f.key]?.errors ?? 0
              return (
                <span role="columnheader" key={f.key} data-col={c} className="oi-grid__th">
                  <span className="oi-grid__th-label" title={f.description ?? f.label}>
                    {f.label}
                    {f.required && <span className="oi-required">*</span>}
                  </span>
                  {errors > 0 && (
                    <button
                      type="button"
                      className="oi-grid__th-errors"
                      onClick={() => {
                        setFieldFilter(fieldFilter === f.key ? '' : f.key)
                        setFilter('errors')
                      }}
                      title={t(m.review.errorsIn, { field: f.label })}
                    >
                      <Filter aria-hidden /> {errors.toLocaleString()}
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          {total === 0 ? (
            <div className="oi-grid__empty">
              {stats.withErrors === 0 && filter === 'errors' ? (
                <>
                  <CheckCircle2 aria-hidden /> {m.review.noErrors}
                </>
              ) : (
                m.review.empty
              )}
            </div>
          ) : (
            <div className="oi-grid__body" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = getRow(v.index)
                // Rows in a worker arrive page by page; show where they'll be.
                if (!row)
                  return <LoadingRow key={`loading-${v.index}`} top={v.start - HEADER_HEIGHT} columns={columns} count={fields.length} />
                return (
                  <GridRow
                    key={row.id}
                    row={row}
                    index={v.index}
                    top={v.start - HEADER_HEIGHT}
                    fields={fields}
                    columns={columns}
                    activeCol={active?.row === v.index ? active.col : -1}
                    editingCol={editing?.cell.row === v.index ? editing.cell.col : -1}
                    editingInitial={editing?.cell.row === v.index ? editing.initial : undefined}
                    selected={selected.has(row.id)}
                    onSelect={(checked) =>
                      setSelected((s) => {
                        const next = new Set(s)
                        if (checked) next.add(row.id)
                        else next.delete(row.id)
                        return next
                      })
                    }
                    onActivate={(col) => setActive({ row: v.index, col })}
                    onEdit={(col) => setEditing({ cell: { row: v.index, col } })}
                    onCommit={(col, value) => commit({ row: v.index, col }, value)}
                    onCancel={() => {
                      setEditing(null)
                      focusGrid()
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className={cx('oi-statusbar', activeIssues.some((i) => severityOf(i) === 'error') && 'is-error')} aria-live="polite">
        {activeRow && activeField ? (
          <>
            <span className="oi-statusbar__pos">
              {m.header.row} {activeRow.sourceIndex} · {activeField.label}
            </span>
            {[...activeIssues, ...rowIssues].length ? (
              [...activeIssues, ...rowIssues].map((i, n) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
                <span key={n} className={cx('oi-statusbar__issue', `is-${severityOf(i)}`)}>
                  <AlertCircle aria-hidden /> {i.message}
                </span>
              ))
            ) : (
              <span className="oi-muted">{m.review.editHint}</span>
            )}
          </>
        ) : (
          <span className="oi-muted">
            {t(m.review.rowCount, { count: total })} · {m.review.editHint}
          </span>
        )}
      </div>
    </div>
  )
}

function LoadingRow({ top, columns, count }: { top: number; columns: string; count: number }) {
  return (
    <div
      className="oi-grid__row is-loading"
      role="row"
      aria-busy="true"
      style={{ transform: `translateY(${top}px)`, gridTemplateColumns: columns, height: ROW_HEIGHT }}
    >
      <span className="oi-grid__check" />
      <span className="oi-grid__num" />
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells
        <span key={i} className="oi-grid__cell">
          <span className="oi-skeleton" />
        </span>
      ))}
    </div>
  )
}

function cellText(row: ReviewRow, key: string): string {
  const v = row.values[key]
  return stringify(v === undefined ? row.input[key] : v)
}

interface GridRowProps {
  row: ReviewRow
  index: number
  top: number
  fields: FieldDefinition[]
  columns: string
  activeCol: number
  editingCol: number
  editingInitial: string | undefined
  selected: boolean
  onSelect: (checked: boolean) => void
  onActivate: (col: number) => void
  onEdit: (col: number) => void
  onCommit: (col: number, value: string) => void
  onCancel: () => void
}

const GridRow = memo(function GridRow({
  row,
  index,
  top,
  fields,
  columns,
  activeCol,
  editingCol,
  editingInitial,
  selected,
  onSelect,
  onActivate,
  onEdit,
  onCommit,
  onCancel,
}: GridRowProps) {
  const { m } = useUi()
  const hasError = row.issues.some((i) => severityOf(i) === 'error')
  const rowLevel = row.issues.filter((i) => !i.field)
  return (
    <div
      className={cx('oi-grid__row', hasError && 'has-error', selected && 'is-selected', index % 2 === 1 && 'is-odd')}
      role="row"
      aria-rowindex={index + 2}
      style={{ transform: `translateY(${top}px)`, gridTemplateColumns: columns, height: ROW_HEIGHT }}
    >
      <span role="gridcell" className="oi-grid__check">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`${m.header.row} ${row.sourceIndex}`}
          tabIndex={-1}
        />
      </span>
      <span
        role="rowheader"
        className={cx('oi-grid__num', rowLevel.length > 0 && 'has-issue')}
        title={rowLevel.map((i) => i.message).join('\n') || undefined}
      >
        {row.sourceIndex}
      </span>
      {fields.map((f, c) => {
        const issues = row.issues.filter((i) => i.field === f.key)
        const error = issues.find((i) => severityOf(i) === 'error')
        const warning = !error && issues.find((i) => severityOf(i) === 'warning')
        const edited = row.edited?.includes(f.key)
        const text = cellText(row, f.key)
        return (
          <span
            key={f.key}
            role="gridcell"
            data-col={c}
            aria-invalid={!!error || undefined}
            aria-selected={activeCol === c}
            className={cx(
              'oi-grid__cell',
              error && 'is-error',
              warning && 'is-warning',
              activeCol === c && 'is-active',
              edited && 'is-edited',
              f.type === 'number' || f.type === 'integer' ? 'is-numeric' : undefined,
            )}
            title={issues.map((i) => i.message).join('\n') || undefined}
            onMouseDown={() => onActivate(c)}
            onDoubleClick={() => onEdit(c)}
          >
            {editingCol === c ? (
              <CellEditor field={f} initial={editingInitial ?? text} onCommit={(v) => onCommit(c, v)} onCancel={onCancel} />
            ) : f.type === 'boolean' && typeof row.values[f.key] === 'boolean' ? (
              <span className={cx('oi-bool', row.values[f.key] ? 'is-true' : 'is-false')}>{row.values[f.key] ? '✓' : '✕'}</span>
            ) : (
              <span className="oi-grid__text">{display(text, 200)}</span>
            )}
            {edited && editingCol !== c && <span className="oi-grid__edited" title={m.review.edited} />}
          </span>
        )
      })}
    </div>
  )
})

function CellEditor({
  field,
  initial,
  onCommit,
  onCancel,
}: {
  field: FieldDefinition
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onCommit(value)
    else onCancel()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(false)
    }
  }
  const { m } = useUi()
  const anchor = useRef<HTMLSpanElement>(null)
  const grid = useRef<HTMLElement | null>(null)
  useEffect(() => {
    grid.current = anchor.current?.closest<HTMLElement>('.oi-grid') ?? null
  }, [])
  if (field.type === 'enum' || field.type === 'boolean') {
    const options =
      field.type === 'boolean'
        ? [
            { value: 'true', label: m.review.yes },
            { value: 'false', label: m.review.no },
          ]
        : (field.options ?? [])
    // Opens straight away: picking an option saves it, Esc or clicking outside cancels.
    // The menu holds focus while open, so the grid gets it back once the menu has closed.
    return (
      <span ref={anchor} className="oi-contents">
        <Select
          className="oi-grid__editor"
          defaultOpen
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            grid.current?.focus({ preventScroll: true })
          }}
          value={value}
          placeholder={value || '—'}
          aria-label={field.label}
          options={options.map((o) => ({ value: o.value, label: 'label' in o && o.label ? o.label : o.value }))}
          onValueChange={(v) => {
            if (done.current) return
            done.current = true
            onCommit(v)
          }}
          onOpenChange={(open) => {
            if (!open) finish(false)
          }}
        />
      </span>
    )
  }
  return (
    <input
      className="oi-grid__editor"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(true)}
      onFocus={(e) => {
        const len = e.currentTarget.value.length
        e.currentTarget.setSelectionRange(len, len)
      }}
    />
  )
}

function FindReplace({ fields, onDone }: { fields: FieldDefinition[]; onDone: (count: number) => void }) {
  const session = useSession()
  const { m } = useUi()
  const [open, setOpen] = useState(false)
  const [field, setField] = useState(fields[0]?.key ?? '')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [substring, setSubstring] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={320}
      trigger={
        <Button size="sm" variant="ghost" icon={<Replace aria-hidden />}>
          {m.review.findReplace}
        </Button>
      }
    >
      <form
        className="oi-form"
        onSubmit={(e) => {
          e.preventDefault()
          void Promise.resolve(session.replaceValues(field, find, replace, { match: substring ? 'substring' : 'cell' })).then(onDone)
          setOpen(false)
        }}
      >
        <label className="oi-field">
          <span>{m.review.replaceIn}</span>
          <Select
            value={field}
            onValueChange={setField}
            options={fields.map((f) => ({ value: f.key, label: f.label }))}
            aria-label={m.review.replaceIn}
          />
        </label>
        <label className="oi-field">
          <span>{m.review.find}</span>
          <Input value={find} onChange={(e) => setFind(e.target.value)} autoFocus />
        </label>
        <label className="oi-field">
          <span>{m.review.replaceWith}</span>
          <Input value={replace} onChange={(e) => setReplace(e.target.value)} />
        </label>
        <label className="oi-check">
          <input type="checkbox" checked={substring} onChange={(e) => setSubstring(e.target.checked)} /> {m.review.matchPart}
        </label>
        <Button type="submit" variant="primary" disabled={!find && substring}>
          {m.review.replaceAll}
        </Button>
      </form>
    </Popover>
  )
}
