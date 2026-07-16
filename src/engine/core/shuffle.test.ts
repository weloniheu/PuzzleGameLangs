import { describe, it, expect } from "vitest";
import { mulberry32, shuffled, shufflePositions } from "./shuffle";

const ITEMS = [
  { token: "a", pos: { x: 1, y: 1 } },
  { token: "b", pos: { x: 2, y: 1 } },
  { token: "c", pos: { x: 3, y: 5 } },
  { token: "d", pos: { x: 7, y: 2 } },
];

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe("mulberry32 — the injectable runtime seed", () => {
  it("is deterministic: same seed → same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("different seeds diverge", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("shuffled — Fisher–Yates over a copy", () => {
  it("never mutates the input", () => {
    const input = [1, 2, 3, 4, 5];
    shuffled(input, mulberry32(7));
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
  it("is a permutation (same members, possibly different order)", () => {
    const out = shuffled([1, 2, 3, 4, 5], mulberry32(7));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("same seed → same order (deterministic for tests)", () => {
    expect(shuffled(ITEMS, mulberry32(9))).toEqual(shuffled(ITEMS, mulberry32(9)));
  });
});

describe("shufflePositions — permute authored cells among the authored items", () => {
  it("keeps item order and fields; only pos assignments change", () => {
    const out = shufflePositions(ITEMS, mulberry32(3));
    expect(out.map((it) => it.token)).toEqual(["a", "b", "c", "d"]);
  });
  it("uses EXACTLY the authored pool of cells (never invents one)", () => {
    const out = shufflePositions(ITEMS, mulberry32(3));
    expect(out.map((it) => key(it.pos)).sort()).toEqual(ITEMS.map((it) => key(it.pos)).sort());
  });
  it("never mutates the input items or their positions", () => {
    const snapshot = JSON.stringify(ITEMS);
    shufflePositions(ITEMS, mulberry32(3));
    expect(JSON.stringify(ITEMS)).toBe(snapshot);
  });
  it("different seeds can produce different arrangements", () => {
    const arrangements = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => shufflePositions(ITEMS, mulberry32(s)).map((it) => key(it.pos)).join("|")),
    );
    expect(arrangements.size).toBeGreaterThan(1);
  });
});
