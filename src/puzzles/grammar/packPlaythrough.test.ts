// Proves each authored grammar room is SOLVABLE through the shared push core
// (ruleEngine.tryMove) — the same engine the DOM module drives. Solutions are
// scripted key-sequences (mirrors logic's packPlaythrough); if a layout drifts
// so its scripted solution stops winning, this fails.
import { describe, it, expect } from "vitest";
import enPack from "../../../content/packs/grammar.room.en.v1.json";
import { validatePuzzle } from "../../generation/validateRepair";
import { tryMove, DIRECTIONS, type Direction } from "../logic/ruleEngine";
import { checkSentence } from "./grammarCheck";
import { buildGrammarBoard, filledSlots, slotCell, PUSH_RULES } from "./grammarBoard";
import type { GrammarBuildPayload } from "../../schema/types";
import type { Puzzle } from "../../schema/types";

type Dir = "U" | "D" | "L" | "R";
const D: Record<Dir, Direction> = {
  U: DIRECTIONS.up, D: DIRECTIONS.down, L: DIRECTIONS.left, R: DIRECTIONS.right,
};

/** Floor origin (1,1) for the wall-ringed rooms these packs use. */
const OX = 1, OY = 1;

function play(puzzle: Puzzle, moves: Dir[]): boolean {
  const payload = puzzle.payload as GrammarBuildPayload;
  const room = puzzle.room!;
  const gb = buildGrammarBoard(
    payload, room.width - OX * 2, room.height - OY * 2,
    { x: room.spawn!.x - OX, y: room.spawn!.y - OY },
  );
  const player = () => gb.board.entities.find((e) => e.id === "player")!;
  const solved = () => checkSentence(filledSlots(gb, payload), payload.structures).valid;
  for (const m of moves) {
    tryMove(gb.board, player(), D[m], PUSH_RULES);
    if (solved()) return true;
  }
  return solved();
}

const byId = (id: string) =>
  (enPack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;

const seq = (s: string) => s.split("") as Dir[];

describe("english grammar pack (push format)", () => {
  it("every puzzle passes structural validation", () => {
    for (const p of enPack.puzzles as unknown as Puzzle[]) {
      expect(validatePuzzle(p)).toEqual({ ok: true, errors: [] });
    }
  });

  it("grammar-build-000 (tutorial): two words, straight into the frame", () => {
    expect(play(byId("grammar-build-000"), seq("LUUUDDDRUUU"))).toBe(true);
  });

  it("grammar-build-001: push 'the dog' then 'runs' up into the frame", () => {
    expect(play(byId("grammar-build-001"), seq("LUUUDDDRUUU"))).toBe(true);
  });

  it("grammar-build-002: subject, verb, object — leave the decoy", () => {
    expect(play(byId("grammar-build-002"), seq("LLLUUUUDDDRUUUDDDRUUU"))).toBe(true);
  });

  it("grammar-build-003: four slots, two decoys", () => {
    expect(play(byId("grammar-build-003"), seq("LLUUUUDDDRUUUDDDRUUUDDDRUUU"))).toBe(true);
  });

  // Same rim rule as the logic pack: a word flush against a wall can't be pushed off
  // it (no cell to stand on), and `randomized` shuffles the words among these very
  // cells — a rimmed spawn cell would hand out unwinnable rooms. Frame slots keep the
  // margin too, so a word can always be pushed INTO a slot from either side.
  it("no word spawn or frame slot is flush against a wall", () => {
    for (const p of enPack.puzzles as unknown as Puzzle[]) {
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

  it("a wrong arrangement does NOT win (push the object into the subject slot)", () => {
    // Level 1's first slot is subject; push the VERB 'runs' (col 5) up into
    // slot col 4? Instead push only 'runs' up under its own column — leaves the
    // subject slot empty → never valid.
    expect(play(byId("grammar-build-001"), seq("RUUU"))).toBe(false);
  });
});
