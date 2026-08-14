// ---------------------------------------------------------------------------
// Same shape as Web Storage (getItem/setItem, synchronous, string values) so
// nothing that already talks to localStorage has to change beyond the import.
// Callers keep their own try/catch — this module doesn't add new failure
// modes, it only swaps which backend answers:
//
// - Browser: real `localStorage`.
// - Electron: `window.electronStorage`, a synchronous IPC bridge (see
//   electron/preload.cjs) backed by a real JSON file under the OS's app-data
//   directory. localStorage IS available in Electron's renderer and would
//   "work", but it lives inside Chromium's opaque profile store — Steam Cloud
//   sync needs an actual file it can glob, which is the only reason this
//   backend exists (see SHIPPING_PLAN.md Phase 2).
//
// The backend is resolved FRESH on every call, not cached at module load —
// same late-binding `localStorage.getItem(...)` already had. Caching it in a
// module-level const broke codex.test.ts, which installs a localStorage stub
// in beforeEach (i.e. after this module's imports already ran).
// ---------------------------------------------------------------------------

interface StorageBridge {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function backend(): StorageBridge {
  const electron = typeof window !== "undefined"
    ? (window as unknown as { electronStorage?: StorageBridge }).electronStorage
    : undefined;
  return electron ?? localStorage;
}

export function getItem(key: string): string | null {
  return backend().getItem(key);
}

export function setItem(key: string, value: string): void {
  backend().setItem(key, value);
}
