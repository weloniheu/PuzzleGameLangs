// ---------------------------------------------------------------------------
// Camera / sizing math (shared engine system). PURE, DOM-free, tested.
//
// Extracted VERBATIM from roomRenderer's relayout/applyViewport — same thresholds,
// same floor, same docked-crop math, no tweaks. The DOM apply (writing px onto
// elements) stays in roomRenderer; only the number-crunching lives here.
//
//   computeTile     — tile px from window+room+roomSize. "fill" scales UP to the
//                     largest INTEGER tile that fits (floor → steps only at true
//                     thresholds, no drift), never below `minTile`. small/medium/large
//                     are fixed sizes independent of the window.
//   computeViewport — visible cols/rows + effective height after the docked-terminal
//                     crop. NEVER changes the tile (docking only crops the camera).
// ---------------------------------------------------------------------------

/** Room sizing mode: "fill" responds to the window; the others are fixed tile sizes. */
export type RoomSize = "fill" | "small" | "medium" | "large";

/** Fixed tile px for the non-"fill" sizes (camera scrolls if the room is larger). */
export const ROOM_TILE: Record<Exclude<RoomSize, "fill">, number> = { small: 30, medium: 40, large: 56 };

/**
 * Tile px. "fill" = the largest integer tile that fits the WHOLE room in the available
 * space (floor() so it only steps at true integer thresholds — no continuous drift),
 * clamped up to `minTile`. Otherwise the fixed size for that mode.
 */
export function computeTile(opts: {
  fullW: number;
  fullH: number;
  roomWidth: number;
  roomHeight: number;
  roomSize: RoomSize;
  minTile: number;
}): number {
  if (opts.roomSize === "fill") {
    const fitTile = Math.floor(Math.min(opts.fullW / opts.roomWidth, opts.fullH / opts.roomHeight));
    return Math.max(opts.minTile, fitTile);
  }
  return ROOM_TILE[opts.roomSize];
}

/**
 * Visible viewport (cols/rows) + effective room height. A docked terminal steals
 * `dockedH` from the height (camera crop, min one tile); popped/none steals nothing.
 * `tile` is an INPUT and is returned untouched — docking never resizes the tile.
 */
export function computeViewport(opts: {
  fullW: number;
  fullH: number;
  tile: number;
  roomWidth: number;
  roomHeight: number;
  docked: boolean;
  dockedH: number;
}): { effH: number; viewCols: number; viewRows: number } {
  const effH = opts.docked ? Math.max(opts.tile, opts.fullH - opts.dockedH) : opts.fullH;
  const viewCols = Math.min(opts.roomWidth, Math.max(1, Math.floor(opts.fullW / opts.tile)));
  const viewRows = Math.min(opts.roomHeight, Math.max(1, Math.floor(effH / opts.tile)));
  return { effH, viewCols, viewRows };
}
