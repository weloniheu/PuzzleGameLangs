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

  it("ladder: base tutorial → variables → mixed → explicit, with the right tiers", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const prog = pack.progression?.find((x) => x.puzzle_type === "code_build");
    expect(prog?.levels.map((l) => l.id)).toEqual([
      "py-code-tutorial-000", "py-code-base-001", "py-code-mixed-000", "py-code-explicit-000",
    ]);
    expect(byId("py-code-tutorial-000").mechanics?.tier).toBe("base");
    expect((byId("py-code-tutorial-000").solution as { output: string }).output).toBe("hello world");
    expect(byId("py-code-base-001").mechanics?.tier).toBe("base");
    expect(byId("py-code-mixed-000").mechanics?.tier).toBe("mixed");
    expect(byId("py-code-explicit-000").mechanics?.tier).toBe("explicit");
  });

  it("the mixed level scaffolds punctuation via coding_area.prefilled", () => {
    const mixed = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-mixed-000")!;
    const prefilled = mixed.room?.coding_area?.prefilled ?? [];
    expect(prefilled.map((t) => t.token)).toContain(")");
  });

  it("the base variables level is a genuine multi-line program", () => {
    const vars = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-base-001")!;
    expect((vars.solution as { lines?: unknown[] }).lines?.length).toBe(2);
    expect(vars.mechanics?.goalSpec?.output).toBe("5");
  });
});
