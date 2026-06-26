// ---------------------------------------------------------------------------
// Player (slime) + camera-follow (shared engine system). Extracted VERBATIM from
// roomRenderer's slime creation + draw() — same inset, same transforms, same clamp.
//
// PURE math (`slimeStyle`, `cameraOffset`) is split from the thin DOM apply
// (`createSlime`, `drawPlayer`). The applier is a 1:1 of the old inline draw().
// ---------------------------------------------------------------------------

import type { Cell } from "../core/room";

/** The slime element (recolorable via CSS). roomRenderer appends it into the world. */
export function createSlime(): HTMLDivElement {
  const slime = document.createElement("div");
  slime.className = "slime";
  return slime;
}

export interface SlimeStyle {
  width: string;
  height: string;
  transform: string;
}

/** Slime box at a cell: scaled to the tile, inset a touch so the cell border shows.
 *  Inset = max(4, round(tile*0.1)); transform offsets by that inset. PURE. */
export function slimeStyle(pos: Cell, tile: number): SlimeStyle {
  const inset = Math.max(4, Math.round(tile * 0.1));
  return {
    width: `${tile - inset * 2}px`,
    height: `${tile - inset * 2}px`,
    transform: `translate(${pos.x * tile + inset}px, ${pos.y * tile + inset}px)`,
  };
}

/** Camera-follow offset (in CELLS), clamped so the view never scrolls past a room edge.
 *  When the whole room is visible (viewCols >= roomWidth) this is always 0. PURE. */
export function cameraOffset(
  pos: Cell,
  viewCols: number,
  viewRows: number,
  roomWidth: number,
  roomHeight: number,
): { camX: number; camY: number } {
  const camX = Math.max(0, Math.min(Math.max(0, roomWidth - viewCols), pos.x - Math.floor(viewCols / 2)));
  const camY = Math.max(0, Math.min(Math.max(0, roomHeight - viewRows), pos.y - Math.floor(viewRows / 2)));
  return { camX, camY };
}

/** Apply the slime box + camera translate (1:1 with the old inline draw(), same order). */
export function drawPlayer(
  slime: HTMLElement,
  world: HTMLElement,
  opts: { pos: Cell; tile: number; viewCols: number; viewRows: number; roomWidth: number; roomHeight: number },
): void {
  const s = slimeStyle(opts.pos, opts.tile);
  slime.style.width = s.width;
  slime.style.height = s.height;
  slime.style.transform = s.transform;
  const { camX, camY } = cameraOffset(opts.pos, opts.viewCols, opts.viewRows, opts.roomWidth, opts.roomHeight);
  world.style.transform = `translate(${-camX * opts.tile}px, ${-camY * opts.tile}px)`;
}
