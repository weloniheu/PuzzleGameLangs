// ---------------------------------------------------------------------------
// Focus / esc ladder (shared engine system). The ONE esc decision, extracted from
// roomRenderer.handleEscape as a PURE state→resolution function (testable); the
// host owns the wiring (what "exit inventory" etc. actually do).
//
// There is NO separate esc listener: the focus-routed keydown handlers (room /
// inventory / settings) all forward esc here, and this resolves it by state:
//   dest menu open    → close it, stay in the room
//   settings open     → back out (sub-tab → menu → closed)
//   inventory focused → return to room focus (cancels a pending drop)
//   overlay focused   → drop focus back to the room (e.g. the terminal)
//   tutorial running  → skip the rest of it
//   plain room        → open settings
// ---------------------------------------------------------------------------

export interface EscContext {
  destMenuOpen: boolean;
  settingsOpen: boolean;
  inventoryFocused: boolean;
  /** Keyboard focus currently sits inside a panel overlay (e.g. the terminal). */
  overlayFocused: boolean;
  /** A skippable guided tutorial is in flight. Deliberately the LAST rung before
   *  "open settings": a tutorial's waitFor step leaves gameplay live, so the player may
   *  well be in the inventory or a menu, and those nearer claims on Escape still win. */
  tutorialActive?: boolean;
}

export type EscResolution =
  | "close-dest-menu"
  | "settings-back"
  | "exit-inventory"
  | "refocus-room"
  | "skip-tutorial"
  | "open-settings";

/** Resolve one Escape press against the current focus state (the ladder above). */
export function resolveEscape(s: EscContext): EscResolution {
  if (s.destMenuOpen) return "close-dest-menu";
  if (s.settingsOpen) return "settings-back";
  if (s.inventoryFocused) return "exit-inventory";
  if (s.overlayFocused) return "refocus-room";
  if (s.tutorialActive) return "skip-tutorial";
  return "open-settings";
}
