import { describe, it, expect } from "vitest";
import type { RoomLayout } from "../../schema/types";
import {
  parseRoom,
  step,
  pileAt,
  inCodingArea,
  inBounds,
  tileAt,
  isWalkable,
} from "./room";

// Movement vectors (the engine's Direction is just {dx,dy}); kept local so these
// tests don't depend on input.ts internals.
const UP = { dx: 0, dy: -1 };
const DOWN = { dx: 0, dy: 1 };
const LEFT = { dx: -1, dy: 0 };
const RIGHT = { dx: 1, dy: 0 };

// A small, hand-checkable room:
//   row0  # # # # #
//   row1  # S . . #   (S = spawn → floor; pile "print" at x3)
//   row2  # . # . #   (interior wall at x2)
//   row3  # # # # #
// coding area = the 2×2 block at x∈{1,2}, y∈{1,2}.
const LAYOUT: RoomLayout = {
  width: 5,
  height: 4,
  tiles: ["#####", "#S..#", "#.#.#", "#####"],
  piles: [{ token: "print", pos: { x: 3, y: 1 } }],
  coding_area: { x: 1, y: 1, width: 2, height: 2 },
};

// A fully-open 3×3 room (floor reaches every edge) for boundary/step-off tests.
const OPEN: RoomLayout = { width: 3, height: 3, tiles: ["...", "...", "..."] };

describe("parseRoom", () => {
  it("parses width/height and grid dimensions", () => {
    const room = parseRoom(LAYOUT);
    expect(room.width).toBe(5);
    expect(room.height).toBe(4);
    expect(room.grid.length).toBe(4); // rows
    expect(room.grid[0].length).toBe(5); // cols
  });

  it("maps the default legend to tiles (and 'S' becomes floor)", () => {
    const room = parseRoom(LAYOUT);
    expect(room.grid[0][0]).toBe("wall");
    expect(room.grid[1][1]).toBe("floor"); // the spawn cell is floor underneath
    expect(room.grid[1][3]).toBe("floor");
    expect(room.grid[2][2]).toBe("wall"); // interior wall
  });

  it("resolves spawn from the 'S' tile when no explicit spawn is given", () => {
    expect(parseRoom(LAYOUT).spawn).toEqual({ x: 1, y: 1 });
  });

  it("prefers an explicit spawn over the 'S' tile", () => {
    const room = parseRoom({ ...LAYOUT, spawn: { x: 2, y: 1 } });
    expect(room.spawn).toEqual({ x: 2, y: 1 });
  });

  it("defaults to the BOTTOM (lowest floor row, center-most) when there is no spawn or 'S'", () => {
    // OPEN is 3×3 all floor → bottom row y=2, center column x=1.
    expect(parseRoom(OPEN).spawn).toEqual({ x: 1, y: 2 });
  });

  it("the bottom default picks the floor cell nearest the horizontal center", () => {
    // Lowest row "#...#" has floor at x∈{1,2,3}; center (x=2) is nearest.
    const room = parseRoom({ width: 5, height: 2, tiles: [".....", "#...#"] });
    expect(room.spawn).toEqual({ x: 2, y: 1 });
  });

  it("treats unknown characters as floor", () => {
    const room = parseRoom({ width: 1, height: 1, tiles: ["?"] });
    expect(room.grid[0][0]).toBe("floor");
  });

  it("honours a custom legend override", () => {
    const room = parseRoom({ width: 2, height: 1, tiles: ["@."], legend: { "@": "spawn" } });
    expect(room.grid[0][0]).toBe("floor");
    expect(room.spawn).toEqual({ x: 0, y: 0 });
  });

  it("keeps piles at their declared positions (and defaults to none)", () => {
    const room = parseRoom(LAYOUT);
    expect(room.piles).toHaveLength(1);
    expect(room.piles[0]).toEqual({ token: "print", pos: { x: 3, y: 1 } });
    expect(parseRoom(OPEN).piles).toEqual([]);
  });

  it("carries the coding area through (and defaults to null)", () => {
    expect(parseRoom(LAYOUT).codingArea).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(parseRoom(OPEN).codingArea).toBeNull();
  });
});

describe("step / movement", () => {
  it("moves onto adjacent floor in each open direction", () => {
    const room = parseRoom(LAYOUT);
    expect(step(room, { x: 1, y: 1 }, RIGHT)).toEqual({ x: 2, y: 1 });
    expect(step(room, { x: 1, y: 1 }, DOWN)).toEqual({ x: 1, y: 2 });
    expect(step(room, { x: 2, y: 1 }, RIGHT)).toEqual({ x: 3, y: 1 }); // pile cell is walkable
  });

  it("is blocked by walls and stays put (each side of the spawn)", () => {
    const room = parseRoom(LAYOUT);
    expect(step(room, { x: 1, y: 1 }, LEFT)).toEqual({ x: 1, y: 1 }); // wall at x0
    expect(step(room, { x: 1, y: 1 }, UP)).toEqual({ x: 1, y: 1 }); // wall at y0
    expect(step(room, { x: 1, y: 2 }, RIGHT)).toEqual({ x: 1, y: 2 }); // interior wall at (2,2)
  });

  it("is blocked at the room edge from each side (out of bounds)", () => {
    const room = parseRoom(OPEN);
    expect(step(room, { x: 0, y: 0 }, LEFT)).toEqual({ x: 0, y: 0 });
    expect(step(room, { x: 0, y: 0 }, UP)).toEqual({ x: 0, y: 0 });
    expect(step(room, { x: 2, y: 2 }, RIGHT)).toEqual({ x: 2, y: 2 });
    expect(step(room, { x: 2, y: 2 }, DOWN)).toEqual({ x: 2, y: 2 });
    expect(step(room, { x: 0, y: 0 }, RIGHT)).toEqual({ x: 1, y: 0 }); // sanity: open move works
  });
});

describe("inBounds / tileAt / isWalkable", () => {
  const room = parseRoom(LAYOUT);

  it("inBounds is true inside and false outside the grid", () => {
    expect(inBounds(room, 0, 0)).toBe(true);
    expect(inBounds(room, 4, 3)).toBe(true);
    expect(inBounds(room, -1, 0)).toBe(false);
    expect(inBounds(room, 5, 0)).toBe(false);
    expect(inBounds(room, 0, 4)).toBe(false);
  });

  it("tileAt returns the tile inside and null outside", () => {
    expect(tileAt(room, 1, 1)).toBe("floor");
    expect(tileAt(room, 0, 0)).toBe("wall");
    expect(tileAt(room, -1, 1)).toBeNull();
  });

  it("only floor is walkable; walls and out-of-bounds are not", () => {
    expect(isWalkable(room, 1, 1)).toBe(true);
    expect(isWalkable(room, 0, 0)).toBe(false);
    expect(isWalkable(room, 99, 99)).toBe(false);
  });
});

describe("pileAt", () => {
  const room = parseRoom(LAYOUT);

  it("returns the pile occupying a cell", () => {
    expect(pileAt(room, 3, 1)).toEqual({ token: "print", pos: { x: 3, y: 1 } });
  });

  it("returns null where there is no pile", () => {
    expect(pileAt(room, 1, 1)).toBeNull();
    expect(pileAt(room, 3, 2)).toBeNull();
  });
});

describe("inCodingArea", () => {
  const room = parseRoom(LAYOUT); // coding area: x∈{1,2}, y∈{1,2}

  it("is true for cells inside the region", () => {
    expect(inCodingArea(room, 1, 1)).toBe(true); // top-left corner (inclusive)
    expect(inCodingArea(room, 2, 2)).toBe(true); // bottom-right corner (inclusive)
  });

  it("is false just outside each boundary", () => {
    expect(inCodingArea(room, 0, 1)).toBe(false); // left of x
    expect(inCodingArea(room, 3, 1)).toBe(false); // right of x (x === a.x + width)
    expect(inCodingArea(room, 1, 0)).toBe(false); // above y
    expect(inCodingArea(room, 1, 3)).toBe(false); // below y (y === a.y + height)
  });

  it("is always false when the room declares no coding area", () => {
    const open = parseRoom(OPEN);
    expect(inCodingArea(open, 0, 0)).toBe(false);
    expect(inCodingArea(open, 1, 1)).toBe(false);
  });
});
