// Guards that the shipped coding pack survives load validation (packLoader drops any
// puzzle validatePuzzle rejects — so a mislabeled level would vanish from the game
// silently). The smoke test mounts from raw JSON and wouldn't catch a dropped level.
import { describe, it, expect } from "vitest";
import pack from "../../../content/packs/python.code.v1.json";
import { validatePuzzle } from "../../generation/validateRepair";
import type { Puzzle } from "../../schema/types";

describe("python.code.v1 — every puzzle passes load validation", () => {
  for (const p of pack.puzzles as unknown as Puzzle[]) {
    it(`${p.id} validates`, () => {
      expect(validatePuzzle(p)).toEqual({ ok: true, errors: [] });
    });
  }

  it("guided tutorial leads the ladder (ends on hello world); the punctuation tier follows", () => {
    const prog = pack.progression?.find((x) => x.puzzle_type === "code_build");
    expect(prog?.levels.map((l) => l.id)).toEqual(["py-code-tutorial-000", "py-code-punct-000"]);
    const tut = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-tutorial-000")!;
    expect(tut.mechanics?.tier).toBe("guided");
    expect((tut.solution as { output: string }).output).toBe("hello world");
    const punct = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-punct-000")!;
    expect(punct.mechanics?.tier).toBe("punctuation");
  });
});
