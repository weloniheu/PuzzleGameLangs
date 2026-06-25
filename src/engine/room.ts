// ---------------------------------------------------------------------------
// Room model + movement / collision (engine, written once). NO DOM here.
//
// The renderer reads from this module: it parses a data-driven RoomLayout into a
// tile grid, and answers "where does the player end up if it tries to move?".
// Keeping this pure makes the rules testable and the renderer dumb.
// ---------------------------------------------------------------------------

import type { RoomLayout, RoomTile, RoomPile, CodingArea } from "../schema/types";
import type { Direction } from "./input";

export interface Cell {
  x: number;
  y: number;
}

export interface Room {
  width: number;
  height: number;
  grid: RoomTile[][]; // grid[y][x]
  spawn: Cell;
  piles: RoomPile[];
  codingArea: CodingArea | null;
}

const DEFAULT_LEGEND: Record<string, RoomTile | "spawn"> = {
  "#": "wall",
  ".": "floor",
  D: "door",
  S: "spawn",
};

/** Parse a data-driven layout into a tile grid + spawn cell. */
export function parseRoom(layout: RoomLayout): Room {
  const legend = { ...DEFAULT_LEGEND, ...(layout.legend ?? {}) };
  const grid: RoomTile[][] = [];
  let spawn: Cell | null = layout.spawn ?? null;

  for (let y = 0; y < layout.height; y++) {
    const rowStr = layout.tiles[y] ?? "";
    const row: RoomTile[] = [];
    for (let x = 0; x < layout.width; x++) {
      const ch = rowStr[x] ?? "#";
      const meaning = legend[ch] ?? "floor";
      if (meaning === "spawn") {
        row.push("floor");
        if (!spawn) spawn = { x, y };
      } else {
        row.push(meaning);
      }
    }
    grid.push(row);
  }

  // Fall back to the first floor tile if no spawn was given or found.
  if (!spawn) {
    outer: for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        if (grid[y][x] === "floor") {
          spawn = { x, y };
          break outer;
        }
      }
    }
  }

  return {
    width: layout.width,
    height: layout.height,
    grid,
    spawn: spawn ?? { x: 0, y: 0 },
    piles: layout.piles ?? [],
    codingArea: layout.coding_area ?? null,
  };
}

/** The pile occupying a cell, or null. */
export function pileAt(room: Room, x: number, y: number): RoomPile | null {
  return room.piles.find((p) => p.pos.x === x && p.pos.y === y) ?? null;
}

/** Whether a cell is inside the coding area (where tokens may be placed). */
export function inCodingArea(room: Room, x: number, y: number): boolean {
  const a = room.codingArea;
  return !!a && x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height;
}

export function inBounds(room: Room, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < room.width && y < room.height;
}

export function tileAt(room: Room, x: number, y: number): RoomTile | null {
  return inBounds(room, x, y) ? room.grid[y][x] : null;
}

/** Only floor is walkable. Walls and doors (non-functional for now) block. Piles
 *  sit ON floor and are walkable — you stand on a pile to interact with it. */
export function isWalkable(room: Room, x: number, y: number): boolean {
  return tileAt(room, x, y) === "floor";
}

/** One step: returns the new cell if walkable, otherwise the original (blocked). */
export function step(room: Room, from: Cell, dir: Direction): Cell {
  const nx = from.x + dir.dx;
  const ny = from.y + dir.dy;
  return isWalkable(room, nx, ny) ? { x: nx, y: ny } : from;
}
