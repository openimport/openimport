import { isSubmittable, type ReviewRow, type RowQuery, type SessionLike, type SessionState } from '@openimport/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../context'
import { shallowEqual, useImportState } from './use-import-state'

export type ReviewFilter = 'all' | 'errors' | 'valid'

export interface UseReviewOptions {
  filter?: ReviewFilter
  /** Only rows with an issue on this field. */
  field?: string
  /** Case-insensitive search across all values. */
  search?: string
}

export interface UseReviewReturn {
  /** Number of rows matching the filter. */
  total: number
  /**
   * Row `index` of the filtered view, or `undefined` while it loads. Rows are
   * fetched in pages on demand, so a grid only ever loads what it shows.
   */
  getRow: (index: number) => ReviewRow | undefined
  stats: SessionState['stats']
  canSubmit: boolean
  isBusy: boolean
  /** Changes whenever the rows change; use it as a memo/effect dependency. */
  version: number
}

const PAGE = 100

/** Pages of filtered rows for one (query, rowsVersion). Works for sync and async sessions. */
class RowPages {
  total: number | undefined
  #pages = new Map<number, ReviewRow[]>()
  #pending = new Set<number>()
  constructor(
    private readonly session: SessionLike<any>,
    private readonly query: RowQuery,
    private readonly onLoad: () => void,
  ) {
    const count = session.countRows(query)
    if (count instanceof Promise) {
      count.then((n) => {
        this.total = n
        onLoad()
      }, console.error)
    } else this.total = count
  }

  get(index: number): ReviewRow | undefined {
    const page = Math.floor(index / PAGE)
    const loaded = this.#pages.get(page)
    if (loaded) return loaded[index - page * PAGE]
    if (this.#pending.has(page)) return undefined
    const rows = this.session.getRows(this.query, page * PAGE, (page + 1) * PAGE)
    if (rows instanceof Promise) {
      this.#pending.add(page)
      rows.then((r) => {
        this.#pending.delete(page)
        this.#pages.set(page, r)
        this.onLoad()
      }, console.error)
      return undefined
    }
    this.#pages.set(page, rows)
    return rows[index - page * PAGE]
  }
}

const select = (s: SessionState) => ({ stats: s.stats, busy: s.busy, version: s.rowsVersion })

/** Filtered, paged review rows plus stats. Actions (`editCell`, `deleteRows`, `submit`, …) live on `useSession()`. */
export function useReview({ filter = 'all', field, search }: UseReviewOptions = {}): UseReviewReturn {
  const session = useSession()
  const { stats, busy, version } = useImportState(select, shallowEqual)
  const [, rerender] = useState(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const onLoad = useCallback(() => {
    if (live.current) rerender((n) => n + 1)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page cache per query and rows version
  const pages = useMemo(
    () => new RowPages(session, { filter, ...(field ? { field } : {}), ...(search ? { search } : {}) }, onLoad),
    [session, filter, field, search, version, onLoad],
  )
  return {
    total: pages.total ?? 0,
    getRow: (index) => pages.get(index),
    stats,
    // isSubmittable only reads stats and busy, which this hook already subscribes to.
    canSubmit: isSubmittable({ stats, busy } as SessionState, session.importer.config.invalidRows),
    isBusy: !!busy,
    version,
  }
}
