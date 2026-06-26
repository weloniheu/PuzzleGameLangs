import { describe, it, expect } from "vitest";
import {
  resolveFeatures,
  hasFeature,
  resolveInventorySlots,
  INVENTORY_FALLBACK,
} from "./roomFeatures";

describe("resolveFeatures / hasFeature — declared present, undeclared absent", () => {
  it("a room that declares features has exactly those", () => {
    const layout = { features: ["terminal", "coding_area"] as const };
    const set = resolveFeatures(layout);
    expect(set.has("terminal")).toBe(true);
    expect(set.has("coding_area")).toBe(true);
    expect(hasFeature(layout, "terminal")).toBe(true);
    expect(hasFeature(layout, "coding_area")).toBe(true);
  });

  it("a room that declares only one has just that one", () => {
    const layout = { features: ["terminal"] as const };
    expect(hasFeature(layout, "terminal")).toBe(true);
    expect(hasFeature(layout, "coding_area")).toBe(false);
  });

  it("a room that declares NOTHING has no features", () => {
    expect(resolveFeatures({}).size).toBe(0);
    expect(hasFeature({}, "terminal")).toBe(false);
    expect(hasFeature({}, "coding_area")).toBe(false);
    expect(hasFeature({ features: [] }, "terminal")).toBe(false);
  });
});

describe("resolveInventorySlots — room-first, then puzzle-type, then fallback", () => {
  it("the room's own count ALWAYS wins over the puzzle-type default", () => {
    expect(resolveInventorySlots(7, "code_build")).toBe(7);
    expect(resolveInventorySlots(1, "code_build")).toBe(1); // even a small explicit count wins
  });

  it("falls back to the puzzle-type default when the room is unset", () => {
    expect(resolveInventorySlots(undefined, "code_build")).toBe(5);
  });

  it("falls back to the sane fallback when neither room nor type specifies", () => {
    expect(resolveInventorySlots(undefined, "match")).toBe(INVENTORY_FALLBACK);
    // and the fallback is distinct from the code_build default, so this is a real branch
    expect(INVENTORY_FALLBACK).not.toBe(5);
  });
});
