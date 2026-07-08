// Proves (a) each authored puzzle is solvable through the UNCHANGED engine and (b) the
// LLM-generatable JSON format loads and plays. Solutions are scripted key-sequences;
// the same harness will re-run the Hawaiian pack once its pattern is confirmed.
import { describe, it, expect } from "vitest";
import enPack from "../../../content/packs/logic.rules.en.v1.json";
import { validateLogicPack } from "./packLoader";
import { createBoard, step, DIRECTIONS } from "./ruleEngine";
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

const en = enPack as unknown as LogicPack;
const R: Dir = "right", L: Dir = "left", U: Dir = "up", D: Dir = "down";
const rep = (d: Dir, n: number): Dir[] => Array(n).fill(d);

describe("english logic pack", () => {
  it("passes structural validation", () => {
    expect(validateLogicPack(en)).toEqual([]);
  });

  it("en-01-welcome: walk right onto the flag", () => {
    expect(play(en, "en-01-welcome", rep(R, 6))).toBe(true);
  });

  it("en-02-push: push the rock out of the way", () => {
    expect(play(en, "en-02-push", rep(R, 6))).toBe(true);
  });

  it("en-03-break-wall: shove STOP off its line, then cross", () => {
    expect(play(en, "en-03-break-wall", [R, D, D, D, U, U, U, ...rep(R, 6)])).toBe(true);
  });

  it("en-04-make-win: push WIN up to complete FLAG IS WIN", () => {
    expect(play(en, "en-04-make-win", [...rep(R, 6), ...rep(U, 3), ...rep(D, 3)])).toBe(true);
  });

  it("en-05-become: form ROCK IS FLAG so the rock becomes the win-flag", () => {
    expect(play(en, "en-05-become", [...rep(R, 3), U, U, L, U, R])).toBe(true);
  });
});
