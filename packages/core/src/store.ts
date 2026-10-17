export type Listener<S> = (state: S, previous: S) => void

/** Minimal observable store, compatible with React's `useSyncExternalStore`. */
export class Store<S extends object> {
  #state: S
  #listeners = new Set<Listener<S>>()

  /** `derive` can add fields computed from every update (e.g. version counters). */
  constructor(
    initial: S,
    private readonly derive?: (next: S, previous: S) => Partial<S>,
  ) {
    this.#state = initial
  }

  get = (): S => this.#state

  set = (update: Partial<S> | ((state: S) => Partial<S>)): void => {
    const previous = this.#state
    const patch = typeof update === 'function' ? update(previous) : update
    let changed = false
    for (const key in patch) {
      if (!Object.is(patch[key], previous[key])) {
        changed = true
        break
      }
    }
    if (!changed) return
    const next = { ...previous, ...patch }
    this.#state = this.derive ? { ...next, ...this.derive(next, previous) } : next
    for (const listener of this.#listeners) listener(this.#state, previous)
  }

  subscribe = (listener: Listener<S>): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
