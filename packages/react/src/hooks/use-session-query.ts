import type { MaybePromise } from '@openimport/core'
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Run a session query that may be synchronous (in-process session) or async
 * (worker session). Sync results are returned in the same render; async ones
 * keep showing the previous value until the new one arrives.
 */
export function useSessionQuery<R>(run: () => MaybePromise<R>, deps: unknown[], initial: R): R {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller owns the dependency list
  const result = useMemo(run, deps)
  const last = useRef<R>(initial)
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!(result instanceof Promise)) return
    let live = true
    result.then(
      (value) => {
        if (!live) return
        last.current = value
        rerender((n) => n + 1)
      },
      (error) => console.error('[openimport] session query failed', error),
    )
    return () => {
      live = false
    }
  }, [result])
  if (result instanceof Promise) return last.current
  last.current = result
  return result
}
