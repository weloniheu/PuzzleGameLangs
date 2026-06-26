import { describe, it, expect } from "vitest";
import { tileCells } from "./tileLayer";
import { parseRoom } from "../core/room";

// CHARACTERIZATION TEST (B1): locks the tile-grid render output captured from the
// pre-extraction inline `buildTiles`. Pure (no jsdom) — it asserts the per-cell
// descriptor (count + class + px/transform), which is the behavior-relevant part the
// thin DOM applier then mirrors 1:1. If the extracted math drifts, this fails.

describe("tileCells — byte-identical to the old inline buildTiles", () => {
  // 3×2 room: row0 "#.." → wall,floor,floor ; row1 "..D" → floor,floor,door.
  const room = parseRoom({ width: 3, height: 2, tiles: ["#..", "..D"] });

  it("emits one cell per grid square, ROW-MAJOR (y outer, x inner)", () => {
    const cells = tileCells(room, 40);
    expect(cells.length).toBe(6);
    expect(cells.map((c) => c.className)).toEqual([
      "tile-room tile-wall",  // (0,0)
      "tile-room tile-floor", // (1,0)
      "tile-room tile-floor", // (2,0)
      "tile-room tile-floor", // (0,1)
      "tile-room tile-floor", // (1,1)
      "tile-room tile-door",  // (2,1)
    ]);
  });

  it("sizes every cell to the tile and positions it at x*tile, y*tile", () => {
    const cells = tileCells(room, 40);
    expect(cells[0]).toEqual({
      className: "tile-room tile-wall",
      width: "40px",
      height: "40px",
      transform: "translate(0px, 0px)",
    });
    // index 5 = (x=2, y=1) → translate(80px, 40px)
    expect(cells[5]).toEqual({
      className: "tile-room tile-door",
      width: "40px",
      height: "40px",
      transform: "translate(80px, 40px)",
    });
  });

  it("scales px/transform with the tile size (no hidden rounding)", () => {
    const cells = tileCells(room, 56);
    expect(cells[4]).toEqual({
      className: "tile-room tile-floor", // (x=1, y=1)
      width: "56px",
      height: "56px",
      transform: "translate(56px, 56px)",
    });
  });
});
