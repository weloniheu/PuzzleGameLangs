// Proves each authored grammar room is SOLVABLE through the shared push core
// (ruleEngine.tryMove) — the same engine the DOM module drives. Solutions are
// scripted key-sequences (mirrors logic's packPlaythrough); if a layout drifts
// so its scripted solution stops winning, this fails.
import { describe, it, expect } from "vitest";
import enPack from "../../../content/packs/grammar.room.en.v1.json";
import hawPack from "../../../content/packs/grammar.room.haw.v1.json";
import { validatePuzzle } from "../../generation/validateRepair";
import { playGrammar, type Dir } from "./simHarness";
import { slotCell } from "./grammarBoard";
import type { GrammarBuildPayload, Puzzle } from "../../schema/types";

/** Floor origin (1,1) for the wall-ringed rooms these packs use. */
const OX = 1, OY = 1;

/** The move loop lives in ./simHarness — shared with levelCompletion.test.ts, which
 *  solves the randomized deals no authored route can speak for. */
const play = (puzzle: Puzzle, moves: Dir[]): boolean => playGrammar(puzzle, moves);

/** The scripted solution must win AND fit the authored par (the ★★★ budget), so an
 *  author cannot ship a rating the level's own geometry can't deliver. */
function solves(id: string, moves: Dir[], pack: PackLike = enPack) {
  const puzzle = byId(id, pack);
  expect(play(puzzle, moves)).toBe(true);
  const par = (puzzle.payload as GrammarBuildPayload).par;
  if (par !== undefined) expect(moves.length).toBeLessThanOrEqual(par);
}

/** Either shipped grammar pack, as read straight off disk (JSON import). */
type PackLike = { puzzles: unknown[] };

const byId = (id: string, pack: PackLike = enPack) =>
  (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;

const seq = (s: string) => s.split("") as Dir[];

describe("english grammar pack (push format)", () => {
  it("every puzzle passes structural validation", () => {
    for (const p of enPack.puzzles as unknown as Puzzle[]) {
      expect(validatePuzzle(p)).toEqual({ ok: true, errors: [] });
    }
  });

  it("grammar-build-000 (tutorial): two words, straight into the frame", () => {
    solves("grammar-build-000", seq("UUUDDDLUUU"));
  });

  it("grammar-build-001: the verb's column is walled — deliver it SIDEWAYS", () => {
    // 'the dog' rides straight up into who?; the pillar under does-what? forces 'runs'
    // up the next column over and then a shove LEFT into the slot.
    solves("grammar-build-001", seq("LUUUDDDRRUUURUL"));
  });

  it("grammar-build-002: subject, verb, object — leave the decoy", () => {
    solves("grammar-build-002", seq("ULUUUDDDLUUUDDDLUUU"));
  });

  it("grammar-build-003: four slots, two decoys", () => {
    solves("grammar-build-003", seq("UUUUDDDRUUUDDDLLUUUDDDLUUU"));
  });

  it("a wrong arrangement does NOT win (push the object into the subject slot)", () => {
    // Level 1's first slot is subject; push the VERB 'runs' (col 5) up into
    // slot col 4? Instead push only 'runs' up under its own column — leaves the
    // subject slot empty → never valid.
    expect(play(byId("grammar-build-001"), seq("RUUU"))).toBe(false);
  });
});

// The HAWAIIAN pack: same engine, four predicate-first patterns (he / ʻo / aia / e),
// and — unlike the English rooms — frames with NO slot labels. The order is taught by
// the room's tutorial and the English target, so "which box wants which word" is not
// readable off the board: these scripted routes are the proof each one is winnable.
describe("hawaiian grammar pack (predicate-first patterns)", () => {
  it("every puzzle passes structural validation", () => {
    for (const p of hawPack.puzzles as unknown as Puzzle[]) {
      expect(validatePuzzle(p)).toEqual({ ok: true, errors: [] });
    }
  });

  it("grammar-haw-001 (he): He kumu ʻo Kaleo — 'he' starts three cells right of its box", () => {
    solves("grammar-haw-001", seq("ULUUULURDDDRDRUUURRDLLLDLUU"), hawPack);
  });

  it("grammar-haw-002 (ʻo): ʻO Leilani ke kumu — the 'he' block fits nowhere", () => {
    solves("grammar-haw-002", seq("LULUUULURRRDRRDLDLUUDDRDLDLUUUU"), hawPack);
  });

  it("grammar-haw-003 (aia): Aia ʻo Kaleo i ke kula — four boxes, two pillars", () => {
    solves("grammar-haw-003", seq("URUUURULLDDLLDLLUULURRDDDDRRRDRUUUURRDLLDLUU"), hawPack);
  });

  it("grammar-haw-004 (e): E inu ʻoe i ka wai — the command keeps its 'you'", () => {
    solves("grammar-haw-004", seq("URRUUURULLLDDDLLDLUUUDDLLDRRDRUUUUDRRRRDRUURULLL"), hawPack);
  });

  // No level may start already solved, and none may be finished by walking in a
  // straight line: every word starts OUT of its slot's column (that is the whole
  // point of "not already in order"), so a single push-up run can never win.
  it.each((hawPack.puzzles as unknown as Puzzle[]).map((p): [string, Puzzle] => [p.id, p]))(
    "%s: no word starts in its own slot column, and pushing straight up does not win",
    (_id, p) => {
      const payload = p.payload as GrammarBuildPayload;
      const answer = payload.structures[0];
      for (const w of payload.words) {
        const slot = answer.indexOf(w.role);
        if (slot === -1) continue; // a decoy has no column of its own
        expect(w.pos.x).not.toBe(payload.frame.x + slot);
      }
      expect(play(p, seq("UUUUUUU"))).toBe(false);
    },
  );
});

// Same rim rule as the logic pack: a word flush against a wall can't be pushed off
// it (no cell to stand on), and `randomized` shuffles the words among these very
// cells — a rimmed spawn cell would hand out unwinnable rooms. Frame slots keep the
// margin too, so a word can always be pushed INTO a slot from either side.
describe.each([["english", enPack], ["hawaiian", hawPack]] as const)(
  "%s pack — padding lint",
  (_label, pack) => {
    it("no word spawn or frame slot is flush against a wall", () => {
      for (const p of pack.puzzles as unknown as Puzzle[]) {
        const payload = p.payload as GrammarBuildPayload;
        const w = p.room!.width - OX * 2, h = p.room!.height - OY * 2;
        const onRim = (x: number, y: number) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
        const cells = [
          ...payload.words.map((wd) => wd.pos),
          ...payload.structure.map((_, i) => slotCell(payload, i)),
        ];
        expect(cells.filter((c) => onRim(c.x, c.y))).toEqual([]);
      }
    });
  },
);
