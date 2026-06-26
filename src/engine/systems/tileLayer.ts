// ---------------------------------------------------------------------------
// Tile grid render (shared engine system). Extracted VERBATIM from
// roomRenderer.buildTiles — same px/transform math, same order, byte-identical DOM.
//
// Split into a PURE descriptor computation (`tileCells`, testable without a DOM) and a
// thin DOM applier (`renderTileLayer`). The applier is a 1:1 of the old inline loop.
// ---------------------------------------------------------------------------

import type { Room } from "../core/room";

/** One tile's render descriptor — exactly the values the inline buildTiles set per cell. */
export interface TileCell {
  className: string;
  width: string;
  height: string;
  transform: string;
}

/** One descriptor per cell, ROW-MAJOR (y outer, x inner) — the same order and values the
 *  inline `buildTiles` produced. Pure: same inputs → same output, no DOM. */
export function tileCells(room: Room, tile: number): TileCell[] {
  const cells: TileCell[] = [];
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      cells.push({
        className: `tile-room tile-${room.grid[y][x]}`,
        width: `${tile}px`,
        height: `${tile}px`,
        transform: `translate(${x * tile}px, ${y * tile}px)`,
      });
    }
  }
  return cells;
}

/** (Re)build the static tile grid into `layer` at the current tile size. Identical to the
 *  old inline loop: clear, then create one div per descriptor in order and append. */
export function renderTileLayer(layer: HTMLElement, room: Room, tile: number): void {
  layer.innerHTML = "";
  for (const c of tileCells(room, tile)) {
    const t = document.createElement("div");
    t.className = c.className;
    t.style.width = c.width;
    t.style.height = c.height;
    t.style.transform = c.transform;
    layer.appendChild(t);
  }
}
