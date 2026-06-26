// ---------------------------------------------------------------------------
// Teardown registry — a tiny list of "undo" callbacks. PURE, DOM-free, tested.
//
// A mounted room registers an undo for everything it creates (removeEventListener,
// clearTimeout/Interval, clear DOM). Leaving the room runs them ALL exactly once and
// then NULLS the list, so nothing — listener, timer, or state — survives the next
// mount. `run()` is idempotent; a thrown undo never blocks the rest.
// ---------------------------------------------------------------------------

export interface Teardown {
  /** Register an undo callback to run on teardown. */
  add(fn: () => void): void;
  /** Run every registered undo once (in order), then clear the list. Idempotent. */
  run(): void;
  /** How many undos are still tracked (0 after run()). */
  readonly size: number;
}

export function createTeardown(): Teardown {
  let fns: Array<() => void> | null = [];
  return {
    add(fn) {
      if (!fns) return; // already torn down — refuse to re-arm a dead registry
      fns.push(fn);
    },
    run() {
      if (!fns) return; // idempotent: a second run() is a no-op
      const pending = fns;
      fns = null; // null FIRST so a re-entrant add()/run() during teardown can't resurrect it
      for (const fn of pending) {
        try {
          fn();
        } catch {
          /* one bad undo must not strand the others */
        }
      }
    },
    get size() {
      return fns ? fns.length : 0;
    },
  };
}
