// Proves (a) each authored puzzle is solvable through the UNCHANGED engine and (b) the
// LLM-generatable JSON format loads and plays. Solutions are scripted key-sequences;
// the same harness will re-run the Hawaiian pack once its pattern is confirmed.
//
// The routes themselves live in ./authoredRoutes — shared with levelCompletion.test.ts,
// which replays them MIRRORED to prove the `randomized` variants finishable.
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
import { AUTHORED_ROUTES } from "./authoredRoutes";
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
    solves(en, "en-00-tutorial", AUTHORED_ROUTES["en-00-tutorial"]);
  });

  it("en-01-welcome: the rock plugs the wall's only gap — shove it through", () => {
    solves(en, "en-01-welcome", AUTHORED_ROUTES["en-01-welcome"]);
    // Straight down the row never wins: the flag sits off the rock's line.
    expect(play(en, "en-01-welcome", rep(R, 12))).toBe(false);
    // And there is no way around — the wall runs the full height of the room.
    expect(play(en, "en-01-welcome", [D, D, ...rep(R, 9)])).toBe(false);
  });

  it("en-02-push: route around and pocket the rock (straight push jams it)", () => {
    solves(en, "en-02-push", AUTHORED_ROUTES["en-02-push"]);
    // Naive corridor push wedges the rock onto the flag against the cap wall.
    expect(play(en, "en-02-push", rep(R, 12))).toBe(false);
  });

  it("en-03-break-wall: breaking WALL IS STOP is now MANDATORY (full-height wall)", () => {
    solves(en, "en-03-break-wall", AUTHORED_ROUTES["en-03-break-wall"]);
    // No walk-around exists any more.
    expect(play(en, "en-03-break-wall", rep(R, 12))).toBe(false);
  });

  it("en-04-make-win: escort WIN up, across, and into FLAG IS ___", () => {
    solves(en, "en-04-make-win", AUTHORED_ROUTES["en-04-make-win"]);
    expect(play(en, "en-04-make-win", rep(R, 12))).toBe(false);
  });

  it("en-05-become: form ROCK IS FLAG so the rock becomes the win-flag", () => {
    solves(en, "en-05-become", AUTHORED_ROUTES["en-05-become"]);
  });

  it("en-06-through: break the wall rule, then carry WIN through the breach", () => {
    solves(en, "en-06-through", AUTHORED_ROUTES["en-06-through"]);
    expect(play(en, "en-06-through", rep(R, 12))).toBe(false);
  });

  it("en-07-which-rule: the flag is sealed — build ROCK IS WIN instead", () => {
    solves(en, "en-07-which-rule", AUTHORED_ROUTES["en-07-which-rule"]);
  });

  it("en-08-two-locks: break the rock plug, cross, finish FLAG IS WIN beyond it", () => {
    solves(en, "en-08-two-locks", AUTHORED_ROUTES["en-08-two-locks"]);
    expect(play(en, "en-08-two-locks", rep(R, 12))).toBe(false);
  });
});

// A tile flush against the border can never be pushed OFF that border — the pusher
// would have to stand outside the board. That is survivable in an authored layout
// (the author knows it never has to move) but fatal under the `randomized` modifier,
// which permutes the loose words among these same cells: a required word landing on
// the rim makes the level unwinnable. Every board therefore keeps a one-cell margin
// of free floor, and only WALLS (which are scenery, or a rule away from scenery) may
// sit on it.
describe("padding lint — no pushable tile starts flush against the border", () => {
  for (const [label, pack] of [["english", en], ["hawaiian", haw]] as const) {
    it(`${label} pack: words and non-wall objects keep a one-cell margin`, () => {
      for (const p of pack.puzzles) {
        const onRim = (x: number, y: number) =>
          x === 0 || y === 0 || x === p.width - 1 || y === p.height - 1;
        const rim = [
          ...p.words.filter((w) => onRim(w.x, w.y)).map((w) => `${p.id}: ${w.text}`),
          ...p.objects
            .filter((o) => o.noun !== "wall" && onRim(o.x, o.y))
            .map((o) => `${p.id}: ${o.noun}`),
        ];
        expect(rim).toEqual([]);
      }
    });
  }
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
    solves(haw, "haw-00-e-hele", AUTHORED_ROUTES["haw-00-e-hele"]);
  });

  it("haw-01-ke-ala: PAHU KA PŌHAKU — pocket the rock (straight push jams)", () => {
    solves(haw, "haw-01-ke-ala", AUTHORED_ROUTES["haw-01-ke-ala"]);
    expect(play(haw, "haw-01-ke-ala", rep(R, 12))).toBe(false);
  });

  it("haw-02-wawahi: break PAʻA KA PĀ, then cross the wall", () => {
    solves(haw, "haw-02-wawahi", AUTHORED_ROUTES["haw-02-wawahi"]);
    expect(play(haw, "haw-02-wawahi", rep(R, 12))).toBe(false);
  });

  it("haw-03-lanakila: escort LANAKILA to the FRONT of ___ KA HAE (predicate-first!)", () => {
    solves(haw, "haw-03-lanakila", AUTHORED_ROUTES["haw-03-lanakila"]);
    expect(play(haw, "haw-03-lanakila", rep(R, 12))).toBe(false);
  });
});
