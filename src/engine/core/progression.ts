// ---------------------------------------------------------------------------
// Progression constants + shared option shape. PURE, DOM-free.
//
// The flat `destinationMenu` builder was RETIRED by the 4-rung ladder (see
// core/ladder.ts) — the ladder's level rung applies the same availability rule
// (a level appears once its `unlock` key is earned; no skip-ahead). Unlock
// state lives in the Codex (same save), passed into the ladder builders.
// ---------------------------------------------------------------------------

/** The hub's room id — the root the ladder always offers a way back to. */
export const HUB_ID = "hub";

export interface DestinationOption {
  kind: "hub" | "level";
  id: string;    // room id to transition to ("hub" or a level id)
  label: string; // menu display text
  /** Resolved teleport flash color for going here (set by the manager; see portalColors). */
  flashColor?: string;
}
