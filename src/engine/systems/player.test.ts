import { describe, it, expect } from "vitest";
import { slimeStyle, cameraOffset } from "./player";

// CHARACTERIZATION TEST (B3): locks the slime box + camera-follow math captured from the
// pre-extraction inline draw(). Pure (no jsdom).

describe("slimeStyle — size/inset/transform, byte-identical to inline draw()", () => {
  it("insets the slime and offsets the transform by that inset (tile 40)", () => {
    // inset = max(4, round(40*0.1)=4) = 4; size = 40 - 8 = 32; at (2,3): 2*40+4=84, 3*40+4=124
    expect(slimeStyle({ x: 2, y: 3 }, 40)).toEqual({
      width: "32px",
      height: "32px",
      transform: "translate(84px, 124px)",
    });
  });

  it("never insets below 4px (small tile)", () => {
    // tile 30: round(3)=3 → max(4,3)=4 ; tile 20: round(2)=2 → max(4,2)=4
    expect(slimeStyle({ x: 0, y: 0 }, 30)).toEqual({ width: "22px", height: "22px", transform: "translate(4px, 4px)" });
    expect(slimeStyle({ x: 0, y: 0 }, 20)).toEqual({ width: "12px", height: "12px", transform: "translate(4px, 4px)" });
  });

  it("scales the inset for large tiles (round, not floor)", () => {
    // tile 56: round(5.6)=6 → inset 6; size 56-12=44; at (1,1): 56+6=62
    expect(slimeStyle({ x: 1, y: 1 }, 56)).toEqual({ width: "44px", height: "44px", transform: "translate(62px, 62px)" });
    // tile 45: round(4.5)=5 → inset 5; size 35; at (0,0): translate(5px, 5px)
    expect(slimeStyle({ x: 0, y: 0 }, 45)).toEqual({ width: "35px", height: "35px", transform: "translate(5px, 5px)" });
  });
});

describe("cameraOffset — follows the slime, clamped at room edges", () => {
  it("stays 0 when the whole room is visible (view >= room)", () => {
    // roomWidth 10, viewCols 10 → max(0, 10-10)=0 → camX clamps to 0 for any pos
    expect(cameraOffset({ x: 5, y: 5 }, 10, 9, 10, 9)).toEqual({ camX: 0, camY: 0 });
  });

  it("centers on the slime when the room is larger than the view", () => {
    // pos.x 15 - floor(10/2)=5 → 10; clamp to [0, 30-10=20] → 10
    expect(cameraOffset({ x: 15, y: 12 }, 10, 8, 30, 20)).toEqual({ camX: 10, camY: 8 }); // y: 12-4=8
  });

  it("clamps at the RIGHT/BOTTOM edge (never scrolls past)", () => {
    // pos.x 28 - 5 = 23 → clamp to 20 ; pos.y 19 - 4 = 15 → clamp to max(0,20-8=12) = 12
    expect(cameraOffset({ x: 28, y: 19 }, 10, 8, 30, 20)).toEqual({ camX: 20, camY: 12 });
  });

  it("clamps at the LEFT/TOP edge to 0", () => {
    // pos.x 2 - 5 = -3 → 0 ; pos.y 1 - 4 = -3 → 0
    expect(cameraOffset({ x: 2, y: 1 }, 10, 8, 30, 20)).toEqual({ camX: 0, camY: 0 });
  });
});
