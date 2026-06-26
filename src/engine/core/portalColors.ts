// ---------------------------------------------------------------------------
// Portal flash colors. PURE, DOM-free, tested.
//
// The teleport flash is colored by the DESTINATION:
//   hub exit (returning to the hub) → RED, always (reserved; ignores any override)
//   else → the destination puzzle type's color, unless a per-room override wins.
// Keyed by the existing puzzle_type field — never hardcoded per portal.
// ---------------------------------------------------------------------------

import type { PuzzleType } from "../../schema/types";

/** Red is reserved for the hub exit. */
export const HUB_FLASH = "#e23b3b";
/** Fallback for puzzle types without a category color yet. */
export const FALLBACK_FLASH = "#6aa0e8";

/** puzzle_type → flash color. The task's categories map onto the engine's puzzle types:
 *  code→blue, language→green, logic→yellow, grammar→purple. */
const TYPE_FLASH: Partial<Record<PuzzleType, string>> = {
  code_build: "#3b6ea5",      // code → blue
  match: "#3a9a55",           // language → green
  combine: "#d8b13a",         // logic → yellow
  sentence_build: "#8a5cc4",  // grammar → purple
};

/**
 * Resolve the flash color for a teleport.
 *   hub:true      → RED, always (a custom override does NOT win over the hub case).
 *   override set  → the override (wins over the type-derived default).
 *   else          → the puzzle type's color, or the fallback.
 */
export function portalFlashColor(opts: {
  hub?: boolean;
  puzzleType?: PuzzleType;
  override?: string;
}): string {
  if (opts.hub) return HUB_FLASH;
  if (opts.override) return opts.override;
  if (opts.puzzleType && TYPE_FLASH[opts.puzzleType]) return TYPE_FLASH[opts.puzzleType]!;
  return FALLBACK_FLASH;
}
