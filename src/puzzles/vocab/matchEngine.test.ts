import { describe, it, expect } from "vitest";
import { isPair, adjacentPartner, isWon, type PlacedTile, type VocabPair } from "./matchEngine";

// Pack-shaped data: the ids are opaque to the engine (word↔meaning here, but a
// synonym pack is the same shape — that's the point).
const PAIRS: VocabPair[] = [
  ["pohaku", "rock"],
  ["wai", "water"],
];

const tile = (id: string, x: number, y: number, matched = false): PlacedTile =>
  ({ id, x, y, matched });

describe("isPair — the pack decides what matches", () => {
  it("a declared pair matches in either order", () => {
    expect(isPair(PAIRS, "pohaku", "rock")).toBe(true);
    expect(isPair(PAIRS, "rock", "pohaku")).toBe(true);
  });
  it("undeclared combinations don't", () => {
    expect(isPair(PAIRS, "pohaku", "water")).toBe(false); // the WRONG partner
    expect(isPair(PAIRS, "pohaku", "wai")).toBe(false);   // two words, no pairing
    expect(isPair(PAIRS, "pohaku", "pohaku")).toBe(false);
  });
});

describe("adjacentPartner — pushed together locks; anything else doesn't", () => {
  it("a valid pair pushed side-by-side finds its partner (all four directions)", () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const tiles = [tile("pohaku", 3, 3), tile("rock", 3 + dx, 3 + dy)];
      expect(adjacentPartner(tiles, "pohaku", PAIRS)).toBe("rock");
    }
  });

  it("an INVALID neighbor does not lock (wrong partner stays unmatched)", () => {
    const tiles = [tile("pohaku", 3, 3), tile("water", 4, 3), tile("rock", 8, 8)];
    expect(adjacentPartner(tiles, "pohaku", PAIRS)).toBeNull();
  });

  it("diagonal adjacency is not 'pushed together'", () => {
    const tiles = [tile("pohaku", 3, 3), tile("rock", 4, 4)];
    expect(adjacentPartner(tiles, "pohaku", PAIRS)).toBeNull();
  });

  it("distance does not match, even for a valid pair", () => {
    const tiles = [tile("pohaku", 3, 3), tile("rock", 6, 3)];
    expect(adjacentPartner(tiles, "pohaku", PAIRS)).toBeNull();
  });

  it("an already-locked tile cannot match again (no stealing partners)", () => {
    const tiles = [tile("pohaku", 3, 3), tile("rock", 4, 3, true)];
    expect(adjacentPartner(tiles, "pohaku", PAIRS)).toBeNull();
    expect(adjacentPartner([tile("pohaku", 3, 3, true), tile("rock", 4, 3)], "pohaku", PAIRS)).toBeNull();
  });
});

describe("isWon — all declared pairs matched", () => {
  it("won when every pair is locked", () => {
    const tiles = [
      tile("pohaku", 3, 3, true), tile("rock", 4, 3, true),
      tile("wai", 1, 5, true), tile("water", 2, 5, true),
    ];
    expect(isWon(tiles, PAIRS)).toBe(true);
  });

  it("not won while any pair is open", () => {
    const tiles = [
      tile("pohaku", 3, 3, true), tile("rock", 4, 3, true),
      tile("wai", 1, 5), tile("water", 6, 5),
    ];
    expect(isWon(tiles, PAIRS)).toBe(false);
  });

  it("tiles outside any pair are scenery — they never gate the win", () => {
    const tiles = [
      tile("pohaku", 3, 3, true), tile("rock", 4, 3, true),
      tile("wai", 1, 5, true), tile("water", 2, 5, true),
      tile("decoration", 8, 8), // in no pair
    ];
    expect(isWon(tiles, PAIRS)).toBe(true);
  });

  it("an empty board with no pairs is trivially won (guard)", () => {
    expect(isWon([], [])).toBe(true);
  });
});
