import { describe, it, expect } from "vitest";
import { clampGeo, clampDockedHeight } from "./panel";

// The terminal's real bounds (see puzzles/coding/terminal.ts).
const MIN_W = 280;
const MIN_H = 140;
const DOCK_MIN = 80;

describe("clampGeo — keep a popped window fully inside the game window", () => {
  it("leaves an in-bounds window untouched", () => {
    expect(clampGeo({ x: 48, y: 88, w: 480, h: 280 }, 1280, 800, MIN_W, MIN_H))
      .toEqual({ x: 48, y: 88, w: 480, h: 280 });
  });

  it("clamps size FIRST (to the bounds), then position (to the remaining space)", () => {
    // Oversized window: shrinks to the bounds and pins to the origin.
    expect(clampGeo({ x: 100, y: 100, w: 2000, h: 1000 }, 800, 600, MIN_W, MIN_H))
      .toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it("respects the minimum size", () => {
    const g = clampGeo({ x: 0, y: 0, w: 10, h: 10 }, 800, 600, MIN_W, MIN_H);
    expect(g.w).toBe(MIN_W);
    expect(g.h).toBe(MIN_H);
  });

  it("pulls an off-screen window back to the edge", () => {
    expect(clampGeo({ x: 700, y: 550, w: 480, h: 280 }, 800, 600, MIN_W, MIN_H))
      .toEqual({ x: 320, y: 320, w: 480, h: 280 });
    expect(clampGeo({ x: -50, y: -50, w: 480, h: 280 }, 800, 600, MIN_W, MIN_H))
      .toEqual({ x: 0, y: 0, w: 480, h: 280 });
  });
});

describe("clampDockedHeight — the docked band's drag bounds", () => {
  it("clamps between the minimum and the available room", () => {
    expect(clampDockedHeight(200, DOCK_MIN, 560)).toBe(200);
    expect(clampDockedHeight(10, DOCK_MIN, 560)).toBe(DOCK_MIN);
    expect(clampDockedHeight(900, DOCK_MIN, 560)).toBe(560);
  });

  it("never collapses below the minimum, even when the room is tiny (maxH < minH)", () => {
    // maxH = fullH - tile can drop under the minimum on a tiny window; min wins.
    expect(clampDockedHeight(200, DOCK_MIN, 40)).toBe(DOCK_MIN);
  });
});
