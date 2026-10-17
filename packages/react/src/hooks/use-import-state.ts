import type { SessionLike, SessionState, Step } from '@openimport/core'
import { useCallback, useRef, useSyncExternalStore } from 'react'
import { useOptionalSession } from '../context'

const identity = (s: SessionState) => s

/**
 * Subscribe to session state. With a selector, the component only re-renders
 * when the selected value changes (compared with `Object.is` or `equals`).
 */
export function useImportState(): SessionState
export function useImportState<S>(selector: (state: SessionState) => S, equals?: (a: S, b: S) => boolean, session?: SessionLike<any>): S
export function useImportState<S>(
  selector: (state: SessionState) => S = identity as (s: SessionState) => S,
  equals: (a: S, b: S) => boolean = Object.is,
  explicit?: SessionLike<any>,
): S {
  const contextSession = useOptionalSession()
  const session = explicit ?? contextSession
  if (!session) throw new Error('[openimport] useImportState needs a session (wrap in <ImporterProvider>)')
  const cache = useRef<{ state: SessionState; selector: unknown; value: S } | null>(null)
  const getSnapshot = useCallback(() => {
    const state = session.getState()
    const cached = cache.current
    if (cached && cached.state === state && cached.selector === selector) return cached.value
    const value = selector(state)
    const stable = cached && equals(cached.value, value) ? cached.value : value
    cache.current = { state, selector, value: stable }
    return stable
  }, [session, selector, equals])
  return useSyncExternalStore(session.subscribe, getSnapshot, getSnapshot)
}

export function useStep(): Step {
  return useImportState(selectStep)
}
const selectStep = (s: SessionState) => s.step

/** Shallow equality for objects/arrays returned by selectors. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
