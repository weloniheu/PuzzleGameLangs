// Proves (a) each authored puzzle is solvable through the UNCHANGED engine and (b) the
// LLM-generatable JSON format loads and plays. Solutions are scripted key-sequences;
// the same harness will re-run the Hawaiian pack once its pattern is confirmed.
//
// Every solution is also pinned to the board's PAR (the ★★★ budget): the script must
// win within par, so an author can't ship a dishonest rating. Negative probes assert
// the naive straight-line walk does NOT win — the geometry, not the player's patience,
// must be the puzzle (this is what caught the old walk-around-the-wall en-03).
import { describe, it, expect } from "vitest";
import enPack from "../../../content/packs/logic.rules.en.v1.json";
import hawPack from "../../../content/packs/logic.rules.haw.v1.json";
import { validateLogicPack } from "./packLoader";
import { createBoard, step, DIRECTIONS } from "./ruleEngine";
import { starsFor } from "./index";
import type { LogicPack } from "./schema";

type Dir = "up" | "down" | "left" | "right";

/** Play a sequence of moves; return true if the board reaches "won". */
function play(pack: LogicPack, puzzleId: string, moves: Dir[]): boolean {
  const puzzle = pack.puzzles.find((p) => p.id === puzzleId)!;
  const board = createBoard(puzzle, pack.vocab, pack.pattern);
  for (const m of moves) {
    if (step(board, DIRECTIONS[m]).status === "won") return true;
  }
  return false;
}

/** The scripted solution must win AND fit the authored par (the ★★★ budget). */
function solves(pack: LogicPack, puzzleId: string, moves: Dir[]) {
  const puzzle = pack.puzzles.find((p) => p.id === puzzleId)!;
  expect(play(pack, puzzleId, moves)).toBe(true);
  if (puzzle.par !== undefined) expect(moves.length).toBeLessThanOrEqual(puzzle.par);
}

const en = enPack as unknown as LogicPack;
const haw = hawPack as unknown as LogicPack;
const R: Dir = "right", L: Dir = "left", U: Dir = "up", D: Dir = "down";
const rep = (d: Dir, n: number): Dir[] => Array(n).fill(d);

describe("english logic pack", () => {
  it("passes structural validation", () => {
    expect(validateLogicPack(en)).toEqual([]);
  });

  it("star rule: within par ★★★, within 1.6× ★★, any solve ★", () => {
    expect(starsFor(10, 10)).toBe(3);
    expect(starsFor(16, 10)).toBe(2);
    expect(starsFor(17, 10)).toBe(1);
  });

  it("en-00-tutorial: walk right onto the flag", () => {
    solves(en, "en-00-tutorial", rep(R, 4));
  });

  it("en-01-welcome: walk right onto the flag", () => {
    solves(en, "en-01-welcome", rep(R, 6));
  });

  it("en-02-push: route around and pocket the rock (straight push jams it)", () => {
    solves(en, "en-02-push", [D, D, R, R, R, R, U, U, R, R, R]);
    // Naive corridor push wedges the rock onto the flag against the cap wall.
    expect(play(en, "en-02-push", rep(R, 12))).toBe(false);
  });

  it("en-03-break-wall: breaking WALL IS STOP is now MANDATORY (full-height wall)", () => {
    solves(en, "en-03-break-wall", [U, R, U, D, ...rep(R, 6), D]);
    // No walk-around exists any more.
    expect(play(en, "en-03-break-wall", rep(R, 12))).toBe(false);
  });

  it("en-04-make-win: escort WIN up, across, and into FLAG IS ___", () => {
    solves(en, "en-04-make-win", [R, U, U, U, U, L, U, ...rep(R, 5), D, R, U, D, D, D, D]);
    expect(play(en, "en-04-make-win", rep(R, 12))).toBe(false);
  });

  it("en-05-become: form ROCK IS FLAG so the rock becomes the win-flag", () => {
    solves(en, "en-05-become", [D, ...rep(R, 6), U, L, L, L, D, L, U, U, R, R, R, U, U]);
  });

  it("en-06-through: break the wall rule, then carry WIN through the breach", () => {
    solves(en, "en-06-through", [
      R, D, D,                   // shove STOP off its rule — the wall is just a wall now
      U, U, U, L, L, U,          // get behind the WIN word
      ...rep(R, 7),              // escort it through the breach to the far column
      D, R, U, U,                // push it up into FLAG IS ___
      D, D, D, L,                // the flag is WIN — go touch it
    ]);
    expect(play(en, "en-06-through", rep(R, 12))).toBe(false);
  });

  it("en-07-which-rule: the flag is sealed — build ROCK IS WIN instead", () => {
    solves(en, "en-07-which-rule", [
      D, R, U, R, D, D,          // steer ROCK next to the waiting IS
      R, R, R, D, D, D, R, R, R, U, // loop around to the WIN word
      L, L, L,                   // push WIN into line: ROCK IS WIN
      D, L, U,                   // nudge it up into the rule row
      R,                         // the rock is WIN — touch it
    ]);
  });

  it("en-08-two-locks: break the rock plug, cross, finish FLAG IS WIN beyond it", () => {
    solves(en, "en-08-two-locks", [
      U, U, R, U,                // break ROCK IS STOP — the plug is passable
      D, D, D, D, R, R, R,       // cross through the gap
      U, U, U, U, R, R, R,       // get above the WIN word
      D, D, D, D, D,             // drive it down into FLAG IS ___
      U, U, U, L,                // the flag is WIN — go claim it
    ]);
    expect(play(en, "en-08-two-locks", rep(R, 12))).toBe(false);
  });
});

// The Hawaiian pack: SAME engine, a PREDICATE-FIRST pattern ([predicate] KA [subject],
// e.g. ʻO ʻOE KA LIMU / PAʻA KA PĀ) — proving the rule grammar really is pack data.
describe("typology lint — the label may not contradict the declared pattern", () => {
  it("both shipped packs' typology agrees with their patterns", () => {
    expect(validateLogicPack(en)).toEqual([]);   // SVO ↔ subject-first slots
    expect(validateLogicPack(haw)).toEqual([]);  // VSO ↔ predicate-first slots
  });

  it("rejects a pack claiming predicate-first over a subject-first pattern", () => {
    const lying: LogicPack = {
      ...en,
      typology: { word_order: "VSO", pattern_family: "predicate-first-equational" },
    };
    expect(validateLogicPack(lying).some((e) => e.includes("typology"))).toBe(true);
  });

  it("rejects a pack claiming subject-first over a predicate-first pattern", () => {
    const lying: LogicPack = { ...haw, typology: { word_order: "SVO" } };
    expect(validateLogicPack(lying).some((e) => e.includes("typology"))).toBe(true);
  });
});

describe("hawaiian logic pack (predicate-first pattern)", () => {
  it("passes structural validation", () => {
    expect(validateLogicPack(haw)).toEqual([]);
  });

  it("haw-00-e-hele: ʻO ʻOE KA LIMU / LANAKILA KA HAE — walk onto the flag", () => {
    solves(haw, "haw-00-e-hele", rep(R, 4));
  });

  it("haw-01-ke-ala: PAHU KA PŌHAKU — pocket the rock (straight push jams)", () => {
    solves(haw, "haw-01-ke-ala", [D, D, R, R, R, R, U, U, R, R, R]);
    expect(play(haw, "haw-01-ke-ala", rep(R, 12))).toBe(false);
  });

  it("haw-02-wawahi: break PAʻA KA PĀ, then cross the wall", () => {
    solves(haw, "haw-02-wawahi", [U, R, U, D, ...rep(R, 6), D]);
    expect(play(haw, "haw-02-wawahi", rep(R, 12))).toBe(false);
  });

  it("haw-03-lanakila: escort LANAKILA to the FRONT of ___ KA HAE (predicate-first!)", () => {
    solves(haw, "haw-03-lanakila", [
      R, U, U, U, U,             // push LANAKILA up the column
      L, U,                      // get behind it
      R, R, R,                   // escort it along the top corridor
      D, R, U,                   // nudge it up into the rule's FIRST slot
      D, D, D, D, R, R,          // the flag wins now — go touch it
    ]);
    expect(play(haw, "haw-03-lanakila", rep(R, 12))).toBe(false);
  });
});
