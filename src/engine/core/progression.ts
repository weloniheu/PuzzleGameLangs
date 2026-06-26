// ---------------------------------------------------------------------------
// Progression → destination menu. PURE, DOM-free, tested.
//
// The menu portal (arrival = exit) offers: the HUB, plus any UNLOCKED level of the
// current puzzle type. "Unlocked" = the level's `unlock` key is earned (the first level
// has none). Completing a level grants the next one's unlock, so a level only appears
// once earned — no skip-ahead. Unlock state lives in the Codex (same save), passed in here.
// ---------------------------------------------------------------------------

import type { LevelEntry } from "../../schema/types";

/** The hub's room id — the root the menu portal always offers a way back to. */
export const HUB_ID = "hub";

export interface DestinationOption {
  kind: "hub" | "level";
  id: string;    // room id to transition to ("hub" or a level id)
  label: string; // menu display text
  /** Resolved teleport flash color for going here (set by the manager; see portalColors). */
  flashColor?: string;
}

/**
 * The destination menu for a level room: the hub first, then each level of this puzzle
 * type whose unlock is earned (in the pack's order). A level with no `unlock` is always
 * available (the first level); others appear only once their key is in `unlocks`.
 */
export function destinationMenu(
  levels: LevelEntry[],
  unlocks: ReadonlySet<string>,
  hubId: string = HUB_ID,
  hubLabel: string = "Hub",
): DestinationOption[] {
  const out: DestinationOption[] = [{ kind: "hub", id: hubId, label: hubLabel }];
  for (const lv of levels) {
    if (!lv.unlock || unlocks.has(lv.unlock)) {
      out.push({ kind: "level", id: lv.id, label: lv.label });
    }
  }
  return out;
}
