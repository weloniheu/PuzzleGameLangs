import { describe, it, expect } from "vitest";
import { transformBoard, transformRoute, ruleRuns, flipsX, flipsY } from "./boardTransform";
import { createBoard, computeRules, hasProperty, type Board } from "./ruleEngine";
import type { LogicPack, LogicPuzzle } from "./schema";
import type { BoardTransform } from "../../schema/types";

// A minimal board: SLIME IS YOU across the top row, the slime and a flag on the floor.
const VOCAB: LogicPack["vocab"] = [
  { text: "SLIME", role: "noun", noun: "slime" },
  { text: "IS", role: "connector" },
  { text: "YOU", role: "property", property: "you" },
  { text: "FLAG", role: "noun", noun: "flag" },
  { text: "WIN", role: "property", property: "win" },
];
const PATTERN: LogicPack["pattern"] = {
  slots: [{ accepts: ["noun"], capture: "subject" }, { accepts: ["connector"] },
          { accepts: ["property", "noun"], capture: "predicate" }],
  directions: ["horizontal", "vertical"],
};
const PUZZLE: LogicPuzzle = {
  id: "t", title: "t", difficulty: 1, width: 7, height: 5,
  objects: [{ noun: "slime", x: 1, y: 3 }, { noun: "flag", x: 5, y: 3 }],
  words: [
    { text: "SLIME", x: 1, y: 1 }, { text: "IS", x: 2, y: 1 }, { text: "YOU", x: 3, y: 1 },
    { text: "FLAG", x: 1, y: 4 }, { text: "IS", x: 2, y: 4 }, { text: "WIN", x: 3, y: 4 },
  ],
};
const board = (): Board => createBoard(PUZZLE, VOCAB, PATTERN);
const wordsAt = (b: Board) =>
  b.entities.filter((e) => e.word).map((e) => `${e.word!.text}@${e.x},${e.y}`).sort();
const ruleNames = (b: Board) => {
  const rs = computeRules(b);
  return [hasProperty(rs, "slime", "you"), hasProperty(rs, "flag", "win")];
};

describe("flipsX / flipsY", () => {
  it("says which axes each transform touches", () => {
    expect([flipsX("mirror-x"), flipsY("mirror-x")]).toEqual([true, false]);
    expect([flipsX("mirror-y"), flipsY("mirror-y")]).toEqual([false, true]);
    expect([flipsX("mirror-both"), flipsY("mirror-both")]).toEqual([true, true]);
  });
});

describe("transformRoute", () => {
  it("reflects a route the same way the board is reflected", () => {
    const route = ["up", "left", "down", "right"] as const;
    expect(transformRoute(route, "mirror-x")).toEqual(["up", "right", "down", "left"]);
    expect(transformRoute(route, "mirror-y")).toEqual(["down", "left", "up", "right"]);
    expect(transformRoute(route, "mirror-both")).toEqual(["down", "right", "up", "left"]);
  });
});

describe("ruleRuns", () => {
  it("groups the ACTIVE rule cells into their runs of three, from the head", () => {
    const runs = ruleRuns(board());
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.horizontal)).toBe(true);
    expect(runs.map((r) => r.cells[0])).toEqual([{ x: 1, y: 1 }, { x: 1, y: 4 }]);
  });
});

describe("transformBoard", () => {
  it.each(["mirror-x", "mirror-y", "mirror-both"] as BoardTransform[])(
    "%s keeps every rule reading exactly as authored",
    (kind) => {
      const b = board();
      transformBoard(b, kind);
      expect(ruleNames(b)).toEqual([true, true]); // SLIME IS YOU, FLAG IS WIN — both still on
    },
  );

  it("moves everything: mirroring y puts the top rule on the bottom row", () => {
    const b = board();
    transformBoard(b, "mirror-y");
    // height 5 → y 1 becomes y 3, y 4 becomes y 0. Words keep their left-to-right order.
    expect(wordsAt(b)).toEqual([
      "FLAG@1,0", "IS@2,0", "IS@2,3", "SLIME@1,3", "WIN@3,0", "YOU@3,3",
    ]);
  });

  it("mirroring x swaps a horizontal rule's OUTER words back, so it still reads forwards", () => {
    const b = board();
    transformBoard(b, "mirror-x");
    // width 7 → the run at x 1..3 lands at x 3..5, and SLIME/YOU swap so it reads
    // SLIME IS YOU left-to-right again rather than YOU IS SLIME.
    expect(wordsAt(b)).toEqual([
      "FLAG@3,4", "IS@4,1", "IS@4,4", "SLIME@3,1", "WIN@5,4", "YOU@5,1",
    ]);
  });

  it("is its own inverse — applying it twice restores the board", () => {
    for (const kind of ["mirror-x", "mirror-y", "mirror-both"] as BoardTransform[]) {
      const b = board();
      const before = wordsAt(b);
      transformBoard(b, kind);
      transformBoard(b, kind);
      expect(wordsAt(b), kind).toEqual(before);
    }
  });
});
