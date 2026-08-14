// Proves every authored coding level is SOLVABLE with the tokens it puts on the floor,
// and that the punctuation tier actually enforces its punctuation. Mirrors the grammar/
// logic packPlaythrough tests, but runs over the pure order-checker (no DOM): if a level's
// answer drifts from its piles, or a punctuation level stops requiring its parens, this fails.
import { describe, it, expect } from "vitest";
import pack from "../../../content/packs/python.code.v1.json";
import {
  run, runAny, createBuildState, markBuilt, requiresPunctuation, normalizeContent,
  type AnswerLine, type CodeLine,
} from "./codeGameLogic";
import type { Puzzle, CodeBuildSolution, RoomPile } from "../../schema/types";

const puzzles = pack.puzzles as unknown as Puzzle[];
const built = () => markBuilt(createBuildState());
const asProgram = (answer: AnswerLine[]): CodeLine[] => answer.map((l) => ({ ...l }));
// The accepted set, exactly as the coding module builds it (accepted[], else lines as one variant).
const acceptedOf = (p: Puzzle): AnswerLine[][] => {
  const sol = p.solution as CodeBuildSolution;
  return sol.accepted ?? (sol.lines ? [sol.lines] : []);
};

describe("python.code.v1 — every level is solvable from its own floor tokens", () => {
  for (const p of puzzles) {
    const accepted = acceptedOf(p);
    const piles = (p.room?.piles ?? []) as RoomPile[];
    const punct = requiresPunctuation(p.mechanics);

    it(`${p.id}: every accepted variant passes the order-check`, () => {
      expect(accepted.length).toBeGreaterThan(0);
      for (const variant of accepted) {
        expect(runAny(built(), asProgram(variant), accepted, punct)).toEqual({ ok: true });
      }
    });

    it(`${p.id}: every token an accepted variant needs is available (floor pile or scaffolded)`, () => {
      // A token can be FETCHED (a floor pile) or PROVIDED (prefilled/scaffolded in the area).
      // Compare under the SAME normalization the checker uses (quotes stripped; punctuation kept
      // only for mixed/explicit), so a "hi" pile satisfies an `hi` answer token and vice versa.
      const prefilled = (p.room?.coding_area?.prefilled ?? []).map((t) => t.token);
      const available = normalizeContent([...piles.map((pile) => pile.token), ...prefilled], punct);
      for (const variant of accepted) for (const line of variant) {
        for (const tok of normalizeContent(line.content, punct)) expect(available).toContain(tok);
      }
    });
  }
});

describe("explicit tier is actually enforced (py-code-explicit-000)", () => {
  const lvl = puzzles.find((p) => p.id === "py-code-explicit-000")!;
  const answer = (lvl.solution as CodeBuildSolution).lines!;
  const withoutParens: CodeLine[] = answer.map((l) => ({
    ...l, content: l.content.filter((t) => !/^[()]+$/.test(t)),
  }));

  it("is the punctuation tier", () => {
    expect(requiresPunctuation(lvl.mechanics)).toBe(true);
  });

  it("dropping the parentheses FAILS under the punctuation tier", () => {
    expect(run(built(), withoutParens, answer, true)).toMatchObject({ ok: false, reason: "wrong-word" });
  });

  it("the very same tokens would PASS in guided mode — the tier is what enforces it", () => {
    expect(run(built(), withoutParens, answer, false)).toEqual({ ok: true });
  });
});
