// ---------------------------------------------------------------------------
// Keybindings: bindings-as-data for the code game. PURE, DOM-free, tested.
//
// Replaces hardcoded `e.key === …` checks with an action→binding(s) map per scheme.
// A binding is a SHORT SEQUENCE of normalized keys (length 1 = a single key, e.g.
// ["w"]; length >1 = a sequence, e.g. ["d","d"]). The keydown handler appends the
// pressed key to a pending buffer and asks resolve() what to do — one mechanism for
// single keys AND vim operator sequences (dd/dw).
// ---------------------------------------------------------------------------

export type SchemeId = "standard" | "vim";
export type Key = string;          // normalized key, e.g. "ArrowUp", "w", "Enter", "`", "d"
export type Binding = Key[];       // length 1 = single key; >1 = sequence
export type Bindings = Record<string, Binding[]>; // action → alternative bindings

export interface ActionDef { id: string; label: string; }

/** Actions shared by both schemes. `interact` covers Build / Run / Talk (context-disambiguated). */
export const COMMON_ACTIONS: ActionDef[] = [
  { id: "up", label: "Move up" },
  { id: "down", label: "Move down" },
  { id: "left", label: "Move left" },
  { id: "right", label: "Move right" },
  { id: "pickup", label: "Pick up / inventory" },
  { id: "place", label: "Place token" },
  { id: "interact", label: "Interact (Build / Run / Talk)" },
  { id: "debug", label: "Debug readout" },
];
/** Vim adds the editing operator sequences. */
export const VIM_ACTIONS: ActionDef[] = [
  { id: "clearLine", label: "Clear line (dd)" },
  { id: "deleteToken", label: "Delete token (dw)" },
];

export function actionsFor(scheme: SchemeId): ActionDef[] {
  return scheme === "vim" ? [...COMMON_ACTIONS, ...VIM_ACTIONS] : COMMON_ACTIONS;
}

/** Default bindings per scheme. Standard runs arrows AND WASD live at once for movement. */
export function defaultBindings(scheme: SchemeId): Bindings {
  if (scheme === "vim") {
    return {
      up: [["k"]], down: [["j"]], left: [["h"]], right: [["l"]],
      pickup: [["d", 'w']], place: [["p"]], interact: [["Enter"]], debug: [["`"]],
      clearLine: [["d", "d"]], deleteToken: [["x"]],
    };
  }
  return {
    up: [["ArrowUp"], ["w"]], down: [["ArrowDown"], ["s"]],
    left: [["ArrowLeft"], ["a"]], right: [["ArrowRight"], ["d"]],
    pickup: [["i"]], place: [["p"]], interact: [["Enter"]], debug: [["`"]],
  };
}

/** Canonical form of a KeyboardEvent.key: single chars lowercased, Space named. */
export function normalizeKey(key: string): Key {
  if (key === " " || key === "Spacebar") return "Space";
  return key.length === 1 ? key.toLowerCase() : key;
}

const GLYPH: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Enter: "⏎", Space: "␣", Escape: "Esc", Backspace: "⌫",
};
export function keyGlyph(k: Key): string {
  return GLYPH[k] ?? (k.length === 1 ? k.toUpperCase() : k);
}
/** Single keys → glyph (↑, W, H); sequences → typed letters joined ("dd", "dw"). */
export function bindingGlyph(b: Binding): string {
  if (b.length === 1) return keyGlyph(b[0]);
  return b.map((k) => (k.length === 1 ? k : keyGlyph(k))).join("");
}
export function bindingsGlyph(list: Binding[]): string {
  return list.map(bindingGlyph).join(" / ");
}

// --- conflicts ------------------------------------------------------------
export const RESERVED_KEYS: Key[] = ["Escape"]; // Esc drives the esc ladder — never rebindable

/** True when one binding is a prefix of (or exactly equal to) the other → a conflict. */
function isPrefixOrEqual(a: Binding, b: Binding): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; // diverged → independent
  return true;
}

export interface ConflictInfo { action: string; binding: Binding; }
/** Find a conflicting binding in another action: exact duplicate OR prefix either way. */
export function findConflict(bindings: Bindings, action: string, candidate: Binding): ConflictInfo | null {
  for (const a of Object.keys(bindings)) {
    if (a === action) continue;
    for (const b of bindings[a]) {
      if (isPrefixOrEqual(candidate, b)) return { action: a, binding: b };
    }
  }
  return null;
}
export function isReserved(candidate: Binding): boolean {
  return candidate.some((k) => RESERVED_KEYS.includes(k));
}

export type RebindResult =
  | { ok: true; bindings: Bindings }
  | { ok: false; reason: "empty" | "reserved" | "conflict"; conflictAction?: string };

/** Validate + apply a rebind of one slot, returning fresh bindings or a blocking reason. */
export function rebind(bindings: Bindings, action: string, slot: number, candidate: Binding): RebindResult {
  if (!candidate.length) return { ok: false, reason: "empty" };
  if (isReserved(candidate)) return { ok: false, reason: "reserved" };
  const conflict = findConflict(bindings, action, candidate);
  if (conflict) return { ok: false, reason: "conflict", conflictAction: conflict.action };
  const next: Bindings = {};
  for (const a of Object.keys(bindings)) next[a] = bindings[a].map((b) => [...b]);
  if (!next[action]) next[action] = [];
  next[action][slot] = candidate;
  return { ok: true, bindings: next };
}

// --- resolution (sequence-aware) ------------------------------------------
export type Resolution =
  | { kind: "fire"; action: string }
  | { kind: "pending" }   // buffer is a prefix of some longer binding — wait for more
  | { kind: "none" };

/** Given the active bindings and the current key buffer, decide fire / pending / none. */
export function resolve(bindings: Bindings, buffer: Key[]): Resolution {
  let fire: string | null = null;
  let pending = false;
  for (const action of Object.keys(bindings)) {
    for (const b of bindings[action]) {
      if (b.length === buffer.length && b.every((k, i) => k === buffer[i])) fire = action;
      else if (b.length > buffer.length && buffer.every((k, i) => k === b[i])) pending = true;
    }
  }
  if (fire) return { kind: "fire", action: fire };
  if (pending) return { kind: "pending" };
  return { kind: "none" };
}
