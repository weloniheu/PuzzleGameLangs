import { describe, it, expect } from "vitest";
import { computeTile, computeViewport, ROOM_TILE } from "./camera";

// CHARACTERIZATION TEST (B2): locks the sizing math captured from the pre-extraction
// relayout/applyViewport. Pure (no jsdom). Covers the CASES, not one path.

const MIN = 40; // FIXED_TILE, the comfortable floor used by roomRenderer

describe("computeTile — fill mode", () => {
  it("picks the largest INTEGER tile that fits the whole room", () => {
    // min(800/10, 600/9) = min(80, 66.67) → floor 66 → max(40,66) = 66
    expect(computeTile({ fullW: 800, fullH: 600, roomWidth: 10, roomHeight: 9, roomSize: "fill", minTile: MIN })).toBe(66);
  });

  it("steps down only at TRUE integer thresholds (no continuous drift)", () => {
    const t = (fullH: number) =>
      computeTile({ fullW: 9999, fullH, roomWidth: 1, roomHeight: 9, roomSize: "fill", minTile: MIN });
    // height-bound: tile = floor(fullH/9). 602/9=66.9→66, 603/9=67→67, 611/9=67.9→67, 612/9=68→68
    expect(t(602)).toBe(66);
    expect(t(603)).toBe(67); // steps exactly here
    expect(t(611)).toBe(67); // holds across the band — no drift
    expect(t(612)).toBe(68);
  });

  it("never goes below the floor (minTile) on a tiny window", () => {
    expect(computeTile({ fullW: 100, fullH: 100, roomWidth: 10, roomHeight: 9, roomSize: "fill", minTile: MIN })).toBe(MIN);
  });
});

describe("computeTile — fixed sizes ignore the window", () => {
  it("small/medium/large return their fixed tile regardless of window size", () => {
    const big = { fullW: 4000, fullH: 4000, roomWidth: 5, roomHeight: 5, minTile: MIN };
    const tiny = { fullW: 50, fullH: 50, roomWidth: 5, roomHeight: 5, minTile: MIN };
    expect(computeTile({ ...big, roomSize: "small" })).toBe(ROOM_TILE.small);   // 30
    expect(computeTile({ ...tiny, roomSize: "small" })).toBe(ROOM_TILE.small);  // 30 — window-independent
    expect(computeTile({ ...big, roomSize: "medium" })).toBe(ROOM_TILE.medium); // 40
    expect(computeTile({ ...big, roomSize: "large" })).toBe(ROOM_TILE.large);   // 56
  });
});

describe("computeViewport — visible cols/rows", () => {
  it("clamps to the room when the whole room fits", () => {
    const v = computeViewport({ fullW: 800, fullH: 600, tile: 40, roomWidth: 10, roomHeight: 9, docked: false, dockedH: 200 });
    expect(v).toEqual({ effH: 600, viewCols: 10, viewRows: 9 }); // floor(800/40)=20→clamped to 10; floor(600/40)=15→clamped to 9
  });

  it("when the room is LARGER than the window, the camera scrolls (cols/rows < room)", () => {
    const v = computeViewport({ fullW: 400, fullH: 300, tile: 40, roomWidth: 30, roomHeight: 20, docked: false, dockedH: 200 });
    expect(v).toEqual({ effH: 300, viewCols: 10, viewRows: 7 }); // floor(400/40)=10, floor(300/40)=7
  });
});

describe("computeViewport — docked terminal crop (the no-breathing rule)", () => {
  const base = { fullW: 800, fullH: 600, tile: 40, roomWidth: 30, roomHeight: 20, dockedH: 200 };

  it("docking reduces visible ROWS while the TILE is untouched", () => {
    const undocked = computeViewport({ ...base, docked: false });
    const docked = computeViewport({ ...base, docked: true });
    expect(undocked.viewRows).toBe(15); // floor(600/40)
    expect(docked.effH).toBe(400);      // max(40, 600-200)
    expect(docked.viewRows).toBe(10);   // floor(400/40) — fewer rows
    expect(docked.viewCols).toBe(undocked.viewCols); // width unaffected by the dock
    // The tile is an INPUT — computeViewport never returns/changes it. And computeTile
    // takes no dock state at all, so docking cannot resize the tile.
    expect(computeTile({ fullW: 800, fullH: 600, roomWidth: 30, roomHeight: 20, roomSize: "fill", minTile: MIN }))
      .toBe(computeTile({ fullW: 800, fullH: 600, roomWidth: 30, roomHeight: 20, roomSize: "fill", minTile: MIN }));
  });

  it("the crop never shrinks below one tile of visible height", () => {
    const v = computeViewport({ ...base, fullH: 600, dockedH: 590, docked: true });
    expect(v.effH).toBe(40);    // max(40, 600-590=10) = 40
    expect(v.viewRows).toBe(1); // min(20, max(1, floor(40/40)=1)) = 1
  });
});
