// ---------------------------------------------------------------------------
// Keyboard input (engine, written once).
//
// Gameplay is KEYBOARD-ONLY (see CLAUDE.md). This module owns the mapping from a
// physical key to a movement direction, plus the selectable scheme. The mouse is
// never wired here — it's allowed only for the settings button and room⇄terminal
// focus switching, which live in the view layer.
//
// One tile per press; browser key-repeat (holding a key) just fires more keydowns,
// which is the desired "held-key repeat is fine" behavior.
// ---------------------------------------------------------------------------

export type MovementScheme = "arrows" | "wasd" | "vim";

export interface Direction {
  dx: number;
  dy: number;
}

const UP: Direction = { dx: 0, dy: -1 };
const DOWN: Direction = { dx: 0, dy: 1 };
const LEFT: Direction = { dx: -1, dy: 0 };
const RIGHT: Direction = { dx: 1, dy: 0 };

const SCHEMES: Record<MovementScheme, Record<string, Direction>> = {
  arrows: {
    ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
  },
  wasd: {
    w: UP, W: UP, s: DOWN, S: DOWN, a: LEFT, A: LEFT, d: RIGHT, D: RIGHT,
  },
  vim: {
    k: UP, K: UP, j: DOWN, J: DOWN, h: LEFT, H: LEFT, l: RIGHT, L: RIGHT,
  },
};

export const SCHEME_ORDER: MovementScheme[] = ["arrows", "wasd", "vim"];

export const SCHEME_LABEL: Record<MovementScheme, string> = {
  arrows: "Arrows",
  wasd: "WASD",
  vim: "hjkl (vim)",
};

/** Mutable settings flag. Default 'arrows'. */
export const inputSettings: { scheme: MovementScheme } = { scheme: "arrows" };

/** Returns the direction a key maps to under the given scheme, or null. */
export function keyToDirection(key: string, scheme: MovementScheme = inputSettings.scheme): Direction | null {
  return SCHEMES[scheme][key] ?? null;
}

/** Advances the scheme to the next one (for the settings button) and returns it. */
export function cycleScheme(): MovementScheme {
  const i = SCHEME_ORDER.indexOf(inputSettings.scheme);
  inputSettings.scheme = SCHEME_ORDER[(i + 1) % SCHEME_ORDER.length];
  return inputSettings.scheme;
}
