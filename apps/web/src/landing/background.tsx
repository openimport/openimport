import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * The hero's ambient layer, drawn as a real import running in slow motion:
 * three stage columns (parse → map → validate). Each record types in as a raw
 * CSV line, a packet carries it to the mapped cells, and validation either
 * passes it or flags the exact cell that's wrong. A soft sweep and a few
 * drifting raw → clean values keep the field alive in between.
 * Deterministic (no Math.random) so every render looks the same.
 */

const ROW = 44 // matches the faint sheet rules

const HEADER = {
  raw: 'Vorname;Nachname;E-Mail-Adresse;Kunde seit;Umsatz',
  cells: ['firstName', 'email', 'signupDate', 'revenue'],
}

/** Column widths for mapped cells, in ch, shared by header and records. */
const WIDTHS = [10, 18, 11, 8]

const RECORDS: { lane: number; raw: string; cells: string[]; bad?: number; status: string }[] = [
  {
    lane: 13,
    raw: 'Anna;Müller;anna@beispiel.de;15.03.2024;1.234,50',
    cells: ['Anna', 'anna@beispiel.de', '2024-03-15', '1234.5'],
    status: 'row 5',
  },
  {
    lane: 14,
    raw: 'Lukas;Weber;lukas@beispiel;02.11.2021;980',
    cells: ['Lukas', 'lukas@beispiel', '2021-11-02', '980'],
    bad: 1,
    status: 'invalid email · row 6',
  },
  {
    lane: 15,
    raw: 'Jonas;Koch;jonas@beispiel.de;31.02.2020;',
    cells: ['Jonas', 'jonas@beispiel.de', '31.02.2020', '—'],
    bad: 2,
    status: 'invalid date · row 8',
  },
]

/** One loop for all records; they start a third of a loop apart, so roughly one is in flight at a time. */
const LOOP = 24

/** Raw → normalised values drifting slowly in the outer margins. */
const DRIFT: [lane: number, left: number, raw: string, clean: string][] = [
  [3, 91, '1.234,50', '1234.5'],
  [8, 3, 'Kunde', 'customer'],
  [11, 92, 'Ja', 'true'],
]

/** Stage columns, as % of the hero width. */
const Z = { raw: 2, link1: 30, map: 36, link2: 69, check: 74 }

/** Fades the field out toward the bottom and keeps it faint behind the copy column. */
const MASK =
  'linear-gradient(to bottom, black 86%, transparent), linear-gradient(to right, black 0%, rgb(0 0 0 / 0.55) 9%, rgb(0 0 0 / 0.2) 18%, rgb(0 0 0 / 0.2) 44%, rgb(0 0 0 / 0.6) 56%, black 66%)'

const top = (lane: number) => `${lane * ROW + 14}px`

function Cells({ values, bad, header }: { values: string[]; bad?: number; header?: boolean }) {
  return (
    <span className="flex gap-1">
      {values.map((v, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional columns
          key={i}
          className={cn(
            'lp-cell-in truncate border px-1',
            header ? 'border-zinc-900 text-zinc-600' : 'border-zinc-800 text-zinc-500',
            i === bad && 'lp-flag',
          )}
          style={{ width: `${(WIDTHS[i] ?? 8) + 1.5}ch`, '--i': i } as CSSProperties}
        >
          {v}
        </span>
      ))}
    </span>
  )
}

export function HeroBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden font-mono text-[10.5px]', className)}
      style={{ maskImage: MASK, WebkitMaskImage: MASK, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }}
    >
      {/* faint row rules, like an empty sheet */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-zinc-900)_1px,transparent_1px)] bg-[size:100%_44px] opacity-40" />
      {[
        [Z.raw, '01 parse', 'raw rows'],
        [Z.map, '02 map', 'schema fields'],
        [Z.check, '03 validate', 'issues'],
      ].map(([x, n, label]) => (
        <span key={n} className="absolute tracking-[0.1em] text-zinc-700 uppercase" style={{ left: `${x}%`, top: top(0) }}>
          {n} <span className="text-zinc-800">· {label}</span>
        </span>
      ))}

      {/* the detected header row, mapped once and kept */}
      <span className="absolute flex items-center gap-2" style={{ left: `${Z.raw}%`, top: top(1) }}>
        <span className="text-zinc-600">{HEADER.raw}</span>
      </span>
      <span className="absolute" style={{ left: `${Z.map}%`, top: `${ROW + 11}px` }}>
        <Cells values={HEADER.cells} header />
      </span>
      <span className="absolute text-emerald-500/45" style={{ left: `${Z.check}%`, top: top(1) }}>
        header · row 4
      </span>

      {/* the parser pass */}
      <div className="lp-sweep absolute inset-y-0 left-0 w-[22vw] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.02)_45%,rgb(255_255_255/0.035)_50%,rgb(255_255_255/0.02)_55%,transparent)]" />

      {/* records moving through the pipeline */}
      {RECORDS.map((r, i) => {
        const ok = r.bad === undefined
        const style = { top: top(r.lane), '--dur': `${LOOP}s`, '--delay': `${-(i * LOOP) / RECORDS.length}s` } as CSSProperties
        return (
          <div key={r.raw} className="lp-lane absolute inset-x-0" style={style}>
            <span className="lp-raw-row absolute whitespace-pre text-zinc-600" style={{ left: `${Z.raw}%` }}>
              {r.raw}
            </span>
            <span className="absolute top-[6px] h-px" style={{ left: `${Z.link1}%`, width: `${Z.map - Z.link1 - 1}%` }}>
              <span className="lp-link1 absolute inset-0 bg-zinc-800" />
              <span className="lp-packet1 absolute -top-[2px] size-[5px] bg-zinc-400" />
            </span>
            <span className="absolute -top-[3px]" style={{ left: `${Z.map}%` }}>
              <Cells values={r.cells} {...(r.bad !== undefined ? { bad: r.bad } : {})} />
            </span>
            <span className="absolute top-[6px] h-px" style={{ left: `${Z.link2}%`, width: `${Z.check - Z.link2 - 1}%` }}>
              <span className="lp-link2 absolute inset-0 bg-zinc-800" />
              <span className={cn('lp-packet2 absolute -top-[2px] size-[5px]', ok ? 'bg-emerald-400/80' : 'bg-red-400/80')} />
            </span>
            <span
              className={cn('lp-status absolute flex items-center gap-1.5 whitespace-pre', ok ? 'text-emerald-500/70' : 'text-red-400/75')}
              style={{ left: `${Z.check}%` }}
            >
              <span>{ok ? '✓' : '✕'}</span>
              {r.status}
            </span>
          </div>
        )
      })}

      {/* stray values being normalised */}
      {DRIFT.map(([lane, left, raw, clean], i) => {
        const style = {
          top: top(lane),
          left: `${left}%`,
          '--dur': `${22 + (i % 3) * 3}s`,
          '--delay': `${-((i * 7.3) % 22)}s`,
        } as CSSProperties
        return (
          <span key={raw} className="lp-cell absolute whitespace-pre" style={style}>
            <span className="lp-raw absolute text-zinc-700">{raw}</span>
            <span className="lp-clean text-zinc-600">{clean}</span>
          </span>
        )
      })}
    </div>
  )
}
