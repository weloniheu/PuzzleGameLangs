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

  it("ladder: tutorial → variables → mixed → explicit → loops ×2 → functions ×2, right tiers", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const prog = pack.progression?.find((x) => x.puzzle_type === "code_build");
    expect(prog?.levels.map((l) => l.id)).toEqual([
      "py-code-tutorial-000", "py-code-base-001", "py-code-mixed-000", "py-code-explicit-000",
      "py-code-loops-001", "py-code-loops-002", "py-code-funcs-001", "py-code-funcs-002",
      "py-code-args-001", "py-code-args-002",
    ]);
    expect(byId("py-code-tutorial-000").mechanics?.tier).toBe("base");
    expect((byId("py-code-tutorial-000").solution as { output: string }).output).toBe("hello world");
    expect(byId("py-code-mixed-000").mechanics?.tier).toBe("mixed");
    expect(byId("py-code-explicit-000").mechanics?.tier).toBe("explicit");
    for (const id of ["py-code-base-001", "py-code-loops-001", "py-code-loops-002",
                      "py-code-funcs-001", "py-code-funcs-002", "py-code-args-001", "py-code-args-002"]) {
      expect(byId(id).mechanics?.tier).toBe("base");
    }
  });

  it("the argument levels declare a parameter slot in the def and pass a value in the call", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const lines = (id: string) => (byId(id).solution as { lines: { content: string[] }[] }).lines;
    // Args I: def header carries the "name" slot; the call passes the quoted "Sam".
    const a1 = lines("py-code-args-001");
    expect(a1[0].content).toContain("name");
    expect(a1[a1.length - 1].content).toEqual(["greet", "\"Sam\""]);
    // Args II: two slots in the header, two values in the call.
    const a2 = lines("py-code-args-002");
    expect(a2[0].content).toEqual(["def", "greet", "first", "last"]);
    expect(a2[a2.length - 1].content).toEqual(["greet", "\"Sam\"", "\"Lee\""]);
    expect(byId("py-code-args-001").tutorial_refs).toContain("concept:function_call");
  });

  it("the function levels DEFINE then CALL: indented body, then the call back at indent 0", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    for (const id of ["py-code-funcs-001", "py-code-funcs-002"]) {
      const lvl = byId(id);
      const lines = (lvl.solution as { lines: { content: string[]; indent: number }[] }).lines;
      expect(lines[0]).toEqual({ content: ["def", "greet"], indent: 0 }); // definition header
      expect(lines[1].indent).toBe(1);                                     // body indented
      expect(lines[lines.length - 1]).toEqual({ content: ["greet"], indent: 0 }); // the call, dedented
      expect(lvl.tutorial_refs).toContain("concept:function_def");
    }
  });

  it("the loop levels have an INDENTED body (indentation-as-placement) and share concept:loops", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    for (const id of ["py-code-loops-001", "py-code-loops-002"]) {
      const lvl = byId(id);
      const lines = (lvl.solution as { lines: { indent: number }[] }).lines;
      expect(lines[0].indent).toBe(0);      // the for-header
      expect(lines[1].indent).toBe(1);      // the body, one tile deeper
      expect(lvl.tutorial_refs).toContain("concept:loops");
    }
    expect(pack.tutorials?.["concept:loops"]).toBeTruthy();
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
