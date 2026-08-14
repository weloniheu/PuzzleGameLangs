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
  isVoid,
  resolveDropTarget,
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

// --- pits, edges, and where a THROWN token lands (the Q drop) ------------------
//
// Movement treats a pit exactly like a wall; the whole difference is what happens to a
// token thrown at one. A wall is a surface (bounce), a pit and the room's outer ring are
// holes (gone). These pin that split, since it is invisible to `step`.

//   row0  # # # # #
//   row1  # . . . #
//   row2  # . O . #   (O = an interior PIT at x2)
//   row3  # # # # #
const PIT_ROOM: RoomLayout = {
  width: 5, height: 4,
  tiles: ["#####", "#...#", "#.O.#", "#####"],
};

describe("pits", () => {
  const room = parseRoom(PIT_ROOM);

  it("parses 'O' as a pit tile", () => {
    expect(room.grid[2][2]).toBe("pit");
  });

  it("blocks movement exactly like a wall", () => {
    expect(isWalkable(room, 2, 2)).toBe(false);
    expect(step(room, { x: 2, y: 1 }, DOWN)).toEqual({ x: 2, y: 1 }); // walked into it → stayed
  });
});

describe("isVoid — what swallows a thrown token", () => {
  const room = parseRoom(PIT_ROOM);

  it("is true for an authored pit and for anything past the grid", () => {
    expect(isVoid(room, 2, 2)).toBe(true);
    expect(isVoid(room, -1, 1)).toBe(true);
    expect(isVoid(room, 99, 1)).toBe(true);
  });

  it("is true for the room's outer WALL ring — the lip of the world", () => {
    expect(isVoid(room, 0, 1)).toBe(true); // left edge
    expect(isVoid(room, 4, 1)).toBe(true); // right edge
    expect(isVoid(room, 2, 0)).toBe(true); // top edge
    expect(isVoid(room, 2, 3)).toBe(true); // bottom edge
  });

  it("is false for plain floor", () => {
    expect(isVoid(room, 1, 1)).toBe(false);
  });

  it("is false for a non-wall tile sitting on the ring (a door is a real surface)", () => {
    // A door on the boundary bounces like any obstacle rather than reading as a hole.
    const withDoor = parseRoom({ width: 5, height: 4, tiles: ["#####", "D...#", "#...#", "#####"] });
    expect(withDoor.grid[1][0]).toBe("door");
    expect(isVoid(withDoor, 0, 1)).toBe(false);
  });

  it("does NOT treat an interior wall as void — that one bounces", () => {
    const inner = parseRoom(LAYOUT); // has an interior wall at (2,2)
    expect(inner.grid[2][2]).toBe("wall");
    expect(isVoid(inner, 2, 2)).toBe(false);
  });
});

describe("resolveDropTarget — where a thrown token comes to rest", () => {
  const room = parseRoom(PIT_ROOM);
  const allFree = () => true;

  it("lands on open floor ahead", () => {
    expect(resolveDropTarget(room, { x: 1, y: 1 }, RIGHT, allFree))
      .toEqual({ kind: "land", cell: { x: 2, y: 1 } });
  });

  it("is swallowed by a pit ahead", () => {
    expect(resolveDropTarget(room, { x: 2, y: 1 }, DOWN, allFree)).toEqual({ kind: "void" });
  });

  it("is swallowed when thrown over the room's edge", () => {
    expect(resolveDropTarget(room, { x: 1, y: 1 }, LEFT, allFree)).toEqual({ kind: "void" });
  });

  it("BOUNCES off an interior wall and lands behind the thrower", () => {
    //   row1  # . . # .    interior wall at (3,1) — x=3 is not the ring (width-1 = 5)
    const r = parseRoom({ width: 6, height: 4, tiles: ["######", "#..#.#", "#....#", "######"] });
    expect(r.grid[1][3]).toBe("wall");
    // At (2,1) facing right → the wall bounces it back past the thrower onto (1,1).
    expect(resolveDropTarget(r, { x: 2, y: 1 }, RIGHT, allFree))
      .toEqual({ kind: "bounce", cell: { x: 1, y: 1 } });
  });

  it("bouncing off a wall and straight over the room's edge still loses it", () => {
    const inner = parseRoom(LAYOUT); // interior wall at (2,2)
    // At (1,2) facing right into that wall → behind is (0,2), the left ring → gone.
    expect(resolveDropTarget(inner, { x: 1, y: 2 }, RIGHT, allFree)).toEqual({ kind: "void" });
  });

  it("bouncing off a wall INTO a pit behind you also loses it", () => {
    //   row2  # O . # . #   pit at (1,2), thrower at (2,2), interior wall at (3,2)
    const r = parseRoom({ width: 6, height: 5, tiles: ["######", "#....#", "#O.#.#", "#....#", "######"] });
    expect(r.grid[2][1]).toBe("pit");
    expect(r.grid[2][3]).toBe("wall");
    // Facing right: the wall rejects it, it flies back past the thrower — into the pit.
    expect(resolveDropTarget(r, { x: 2, y: 2 }, RIGHT, allFree)).toEqual({ kind: "void" });
  });

  it("reports blocked when neither ahead nor behind can take it", () => {
    const r = parseRoom({ width: 6, height: 4, tiles: ["######", "#..#.#", "#....#", "######"] });
    // Same throw as above, but the cell behind is occupied (a pile, another token…).
    const nothingFree = () => false;
    expect(resolveDropTarget(r, { x: 2, y: 1 }, RIGHT, nothingFree)).toEqual({ kind: "blocked" });
  });

  it("respects the injected isFree — an occupied cell ahead bounces rather than stacking", () => {
    const r = parseRoom({ width: 6, height: 4, tiles: ["######", "#....#", "#....#", "######"] });
    // (3,1) is floor but occupied; (1,1) behind is free → bounce past the thrower.
    const occupied = (c: { x: number; y: number }) => !(c.x === 3 && c.y === 1);
    expect(resolveDropTarget(r, { x: 2, y: 1 }, RIGHT, occupied))
      .toEqual({ kind: "bounce", cell: { x: 1, y: 1 } });
  });
});
