import { columnLetter } from '@openimport/core'
import { useImportState, useSession } from '@openimport/react'
import { useUi } from '../context'
import { Sparkles } from '../icons'
import { cx, display } from '../utils'

const VISIBLE_ROWS = 20

export function HeaderStep() {
  const session = useSession()
  const { m, t } = useUi()
  const preview = useImportState((s) => s.preview)
  const headerRow = useImportState((s) => s.headerRow)
  const detected = useImportState((s) => s.detectedHeaderRow)
  const rows = preview.slice(0, VISIBLE_ROWS)
  const width = Math.min(Math.max(0, ...rows.map((r) => r.length)), 30)

  return (
    <div className="oi-step">
      <div className="oi-step__intro">
        <h2>{m.header.heading}</h2>
        <p>{m.header.description}</p>
        {detected > 0 && (
          <p className="oi-hint">
            <Sparkles aria-hidden /> {t(m.header.detected, { row: detected + 1 })}
          </p>
        )}
      </div>
      <div className="oi-sheet" role="radiogroup" aria-label={m.header.heading}>
        <table>
          <thead>
            <tr>
              <th aria-label={m.header.row} />
              {Array.from({ length: width }, (_, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                <th key={c}>{columnLetter(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                key={i}
                role="radio"
                aria-checked={i === headerRow}
                tabIndex={i === headerRow ? 0 : -1}
                className={cx(i === headerRow && 'is-header', i < headerRow && 'is-skipped')}
                onClick={() => session.setHeaderRow(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    session.setHeaderRow(Math.min(i + 1, rows.length - 1))
                    ;(e.currentTarget.nextElementSibling as HTMLElement | null)?.focus()
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    session.setHeaderRow(Math.max(i - 1, 0))
                    ;(e.currentTarget.previousElementSibling as HTMLElement | null)?.focus()
                  }
                }}
              >
                <th scope="row">{i + 1}</th>
                {Array.from({ length: width }, (_, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  <td key={c}>{display(row[c], 40)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
