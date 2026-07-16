// Proves every authored coding level is SOLVABLE with the tokens it puts on the floor,
// and that the punctuation tier actually enforces its punctuation. Mirrors the grammar/
// logic packPlaythrough tests, but runs over the pure order-checker (no DOM): if a level's
// answer drifts from its piles, or a punctuation level stops requiring its parens, this fails.
import { describe, it, expect } from "vitest";
import pack from "../../../content/packs/python.code.v1.json";
import {
  run, createBuildState, markBuilt, requiresPunctuation, type AnswerLine, type CodeLine,
} from "./codeGameLogic";
import type { Puzzle, CodeBuildSolution, RoomPile } from "../../schema/types";

const puzzles = pack.puzzles as unknown as Puzzle[];
const built = () => markBuilt(createBuildState());
const asProgram = (answer: AnswerLine[]): CodeLine[] => answer.map((l) => ({ ...l }));

describe("python.code.v1 — every level is solvable from its own floor tokens", () => {
  for (const p of puzzles) {
    const answer = (p.solution as CodeBuildSolution).lines ?? [];
    const piles = (p.room?.piles ?? []) as RoomPile[];
    const punct = requiresPunctuation(p.mechanics);

    it(`${p.id}: the authored solution passes its own order-check`, () => {
      expect(answer.length).toBeGreaterThan(0);
      expect(run(built(), asProgram(answer), answer, punct)).toEqual({ ok: true });
    });

    it(`${p.id}: every token the answer needs is on the floor`, () => {
      const floor = piles.map((pile) => pile.token);
      for (const line of answer) for (const tok of line.content) expect(floor).toContain(tok);
    });
  }
});

describe("punctuation tier is actually enforced (py-code-punct-000)", () => {
  const lvl = puzzles.find((p) => p.id === "py-code-punct-000")!;
  const answer = (lvl.solution as CodeBuildSolution).lines!;
  const withoutParens: CodeLine[] = answer.map((l) => ({
    ...l, content: l.content.filter((t) => !/^[()]+$/.test(t)),
  }));

  it("is the punctuation tier", () => {
    expect(requiresPunctuation(lvl.mechanics)).toBe(true);
  });

  it("dropping the parentheses FAILS under the punctuation tier", () => {
    expect(run(built(), withoutParens, answer, true)).toEqual({ ok: false, reason: "wrong-word" });
  });

  it("the very same tokens would PASS in guided mode — the tier is what enforces it", () => {
    expect(run(built(), withoutParens, answer, false)).toEqual({ ok: true });
  });
});
