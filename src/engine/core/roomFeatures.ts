// ---------------------------------------------------------------------------
// Room features + inventory sizing. PURE, DOM-free, tested.
//
// A room renders ONLY the features it declares (terminal, coding_area, …). Undeclared
// = absent; the renderer never builds it. This is the substrate the hub and the
// portal/transition system sit on — adding a gateable feature later is: extend
// RoomFeature (schema) + a render branch in renderRoom.
//
// Inventory size resolves room-first, then by puzzle type, then a fallback. Difficulty
// is deliberately NOT part of this yet.
// ---------------------------------------------------------------------------

import type { RoomFeature, RoomLayout, PuzzleType } from "../../schema/types";

/** Inventory slot defaults per puzzle type. A room's own `inventory_slots` ALWAYS wins
 *  over this; this is only the fallback when the room doesn't declare a count. */
const INVENTORY_BY_TYPE: Partial<Record<PuzzleType, number>> = {
  code_build: 5,
};
/** Last-resort slot count when neither the room nor the puzzle type specifies one. */
export const INVENTORY_FALLBACK = 4;

/** The set of features a room declares (empty when it declares none). */
export function resolveFeatures(layout: Pick<RoomLayout, "features">): Set<RoomFeature> {
  return new Set(layout.features ?? []);
}

/** Whether a room declares a given feature. */
export function hasFeature(layout: Pick<RoomLayout, "features">, feature: RoomFeature): boolean {
  return (layout.features ?? []).includes(feature);
}

/**
 * Inventory slot count: the room's declared count wins; otherwise the puzzle-type
 * default; otherwise a sane fallback. (Room ALWAYS beats type. Difficulty excluded.)
 */
export function resolveInventorySlots(
  roomSlots: number | undefined,
  puzzleType: PuzzleType,
): number {
  if (typeof roomSlots === "number") return roomSlots;
  return INVENTORY_BY_TYPE[puzzleType] ?? INVENTORY_FALLBACK;
}
