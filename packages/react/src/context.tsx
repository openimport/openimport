import type { Importer, SessionLike } from '@openimport/core'
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useState } from 'react'

const SessionContext = createContext<SessionLike<any> | null>(null)

/** Creates a session for an importer, e.g. `workerSession()` from `@openimport/worker`. */
export type SessionFactory = <T>(importer: Importer<T>) => SessionLike<T>

const local: SessionFactory = (importer) => importer.createSession()

// Layout effects re-render before the browser handles the next event, so a
// file dropped right after switching factories can't reach the old session.
const useSwapEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Create (once) and own an import session for the lifetime of the component.
 * Pass a factory to run the session elsewhere, e.g. in a Web Worker.
 */
export function useImporterSession<T>(importer: Importer<T>, factory: SessionFactory = local): SessionLike<T> {
  const [current, setCurrent] = useState(() => ({ session: factory(importer), factory }))
  const { session } = current
  // A new importer or factory (e.g. switching to a worker) gets a new session.
  useSwapEffect(() => {
    if (session.importer !== importer || current.factory !== factory) setCurrent({ session: factory(importer), factory })
  }, [importer, session, factory, current.factory])
  useEffect(
    () => () => {
      void session.abort()
      session.dispose?.()
    },
    [session],
  )
  return session
}

export type ImporterProviderProps<T> = { children: ReactNode } & (
  | { importer: Importer<T>; session?: never }
  | { session: SessionLike<T>; importer?: never }
)

/** Provides an import session to the hooks below it. Pass an `importer` or an existing `session`. */
export function ImporterProvider<T>(props: ImporterProviderProps<T>) {
  if (props.session) return <SessionContext.Provider value={props.session}>{props.children}</SessionContext.Provider>
  return <OwnedSession importer={props.importer as Importer<T>}>{props.children}</OwnedSession>
}

function OwnedSession<T>({ importer, children }: { importer: Importer<T>; children: ReactNode }) {
  const session = useImporterSession(importer)
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

/** The session from the nearest provider, or `null`. */
export function useOptionalSession<T = Record<string, unknown>>(): SessionLike<T> | null {
  return useContext(SessionContext) as SessionLike<T> | null
}

export function useSession<T = Record<string, unknown>>(): SessionLike<T> {
  const session = useContext(SessionContext)
  if (!session) throw new Error('[openimport] useSession must be used inside <ImporterProvider> or <Importer>')
  return session as SessionLike<T>
}
