// ---------------------------------------------------------------------------
// Doors — ONE mechanic (interact), a DATA-DRIVEN reaction. PURE, DOM-free, tested.
//
// Interacting with a door always runs the same code; what HAPPENS depends on the
// door's data + the player's saved unlocks:
//   open                         → transition to the door's target
//   locked  (+earned unlock)     → transition (the unlock opens it)
//   locked  (no unlock yet)      → blocked ("beat this first")
//   coming_soon                  → blocked ("not ready yet")
// The renderer turns a "transition" into a teardown+mount and a "blocked" into a beat.
// ---------------------------------------------------------------------------

import type { DoorState } from "../schema/types";

/** The door fields this resolver needs (a structural subset of RoomDoor). */
export interface DoorData {
  target: string;
  state: DoorState;
  /** When the door is `locked`, this key being in `unlocks` opens it. */
  unlock?: string;
}

export type DoorReaction =
  | { kind: "transition"; target: string }
  | { kind: "blocked"; reason: "locked" | "coming_soon" };

/** The door's EFFECTIVE state after applying earned unlocks. Only a `locked` door with
 *  a matching earned `unlock` flips to `open`; `open`/`coming_soon` are unaffected. */
export function effectiveDoorState(door: DoorData, unlocks: ReadonlySet<string>): DoorState {
  if (door.state === "locked" && door.unlock && unlocks.has(door.unlock)) return "open";
  return door.state;
}

/** Resolve what interacting with a door does, given the player's earned unlocks. */
export function doorReaction(door: DoorData, unlocks: ReadonlySet<string>): DoorReaction {
  const state = effectiveDoorState(door, unlocks);
  if (state === "open") return { kind: "transition", target: door.target };
  return { kind: "blocked", reason: state };
}
