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

  it("ladder: tutorial → variables → hunt ×3 → tiers → loops → functions → args → conditions → nesting → the capstone", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const prog = pack.progression?.find((x) => x.puzzle_type === "code_build");
    expect(prog?.levels.map((l) => l.id)).toEqual([
      "py-code-tutorial-000", "py-code-base-001", "py-code-hunt-000", "py-code-hunt-001",
      "py-code-bugs-000", "py-code-mixed-000", "py-code-explicit-000",
      "py-code-loops-001", "py-code-loops-002", "py-code-funcs-001", "py-code-funcs-002",
      "py-code-args-001", "py-code-args-002",
      "py-code-cond-001", "py-code-cond-002", "py-code-nest-001", "py-code-final-001",
    ]);
    expect(byId("py-code-tutorial-000").mechanics?.tier).toBe("base");
    expect((byId("py-code-tutorial-000").solution as { output: string }).output).toBe("hello world");
    expect(byId("py-code-mixed-000").mechanics?.tier).toBe("mixed");
    expect(byId("py-code-explicit-000").mechanics?.tier).toBe("explicit");
    // The HUNT levels are base-tier code with a different token SOURCE (monsters, not piles),
    // so they carry their own ladder rung ("hunted") rather than a tier of their own.
    for (const id of ["py-code-hunt-000", "py-code-hunt-001"]) {
      expect(byId(id).room?.features).toContain("monsters");
      expect(byId(id).room?.piles ?? []).toEqual([]);
      expect(byId(id).room?.monsters?.spawns.length).toBeGreaterThan(0);
      expect(byId(id).tutorial_refs).toContain("mechanic:monsters");
    }
    // BUGS is the third "hunted" level, and the THIEF debut: tokens come from PILES this
    // time (the fight is about the thief, not about fetching) — see MONSTER_THIEF_PLAN.md.
    const bugs = byId("py-code-bugs-000");
    expect(bugs.room?.features).toContain("monsters");
    expect((bugs.room?.piles ?? []).length).toBeGreaterThan(0);
    const spawns = bugs.room?.monsters?.spawns ?? [];
    expect(spawns.some((m) => m.behavior === "thief")).toBe(true);
    expect(spawns.every((m) => m.behavior !== "thief" || m.token === undefined)).toBe(true);
    expect(bugs.tutorial_refs).toContain("mechanic:thieves");
    expect(pack.tutorials?.["mechanic:thieves"]).toBeTruthy();

    expect(prog?.levels.filter((l) => l.mechanic === "hunted").map((l) => l.id))
      .toEqual(["py-code-hunt-000", "py-code-hunt-001", "py-code-bugs-000"]);

    for (const id of ["py-code-base-001", "py-code-hunt-000", "py-code-hunt-001", "py-code-bugs-000",
                      "py-code-loops-001", "py-code-loops-002",
                      "py-code-funcs-001", "py-code-funcs-002", "py-code-args-001", "py-code-args-002",
                      "py-code-cond-001", "py-code-cond-002", "py-code-nest-001", "py-code-final-001"]) {
      expect(byId(id).mechanics?.tier).toBe("base");
    }
  });

  // The levels past Arguments: branching, then nesting, then everything at once. They are
  // the reason the ladder is worth climbing, so their SHAPE is pinned like the rest.
  it("the conditional levels gate a line behind a test, and the second one adds the other road", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const lines = (id: string) =>
      (byId(id).solution as { lines: { content: string[]; indent: number }[] }).lines;

    for (const id of ["py-code-cond-001", "py-code-cond-002"]) {
      const l = lines(id);
      expect(l.find((x) => x.content[0] === "if")!.indent).toBe(0); // the test is at the wall…
      expect(l[l.findIndex((x) => x.content[0] === "if") + 1].indent).toBe(1); // …its line is not
      expect(byId(id).tutorial_refs).toContain("concept:conditionals");
    }
    expect(pack.tutorials?.["concept:conditionals"]).toBeTruthy();
    // II is the branch: else sits at the wall beside the if, with its own indented line.
    const both = lines("py-code-cond-002");
    const elseAt = both.findIndex((x) => x.content[0] === "else");
    expect(both[elseAt]).toEqual({ content: ["else"], indent: 0 });
    expect(both[elseAt + 1].indent).toBe(1);
  });

  it("nesting stacks three indent depths, and the capstone pulls the whole track together", () => {
    const byId = (id: string) => (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === id)!;
    const lines = (id: string) =>
      (byId(id).solution as { lines: { content: string[]; indent: number }[] }).lines;

    // A loop inside a loop: 0 → 1 → 2 is the whole idea, so it has to be in the answer.
    expect(lines("py-code-nest-001").map((l) => l.indent)).toEqual([0, 1, 2, 0]);

    // The capstone: a definition WITH a slot, plain calls, and a call inside a loop.
    const final = lines("py-code-final-001");
    expect(final.length).toBeGreaterThanOrEqual(7);
    expect(final[0]).toEqual({ content: ["def", "shout", "word"], indent: 0 });
    expect(final.some((l) => l.content[0] === "for" && l.indent === 0)).toBe(true);
    expect(final[final.length - 1]).toEqual({ content: ["shout", "\"again\""], indent: 1 });
    expect(byId("py-code-final-001").tutorial_refs)
      .toEqual(expect.arrayContaining(["concept:function_call", "concept:loops"]));
  });

  // Long levels are only fair if they SAY they are long: par is what the score card
  // measures a run against (see engine/core/score.ts), and the engine default is short.
  it("every multi-line level declares its own par", () => {
    for (const p of pack.puzzles as unknown as Puzzle[]) {
      const lines = (p.solution as { lines?: unknown[] }).lines ?? [];
      if (lines.length < 3) continue;
      const par = p.mechanics?.par;
      expect(par?.seconds, `${p.id} has ${lines.length} lines but no par.seconds`).toBeGreaterThan(0);
      expect(par?.steps, `${p.id} has ${lines.length} lines but no par.steps`).toBeGreaterThan(0);
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

  // RENAMEABLE tokens let the player pick which name holds which value (checkProgram
  // accepts any consistent renaming). Two things must stay true of the CONTENT, or the
  // feature turns into a way to cheat: a decoy must never be a legal name, and a name
  // must actually be a name — a token the answer really uses.
  it("every renameable token is a real name in the answer, and no decoy is renameable", () => {
    for (const p of pack.puzzles as unknown as Puzzle[]) {
      const tokens = (p.payload as { tokens?: { text: string; kind: string; renameable?: boolean }[] }).tokens ?? [];
      const sol = p.solution as { lines?: { content: string[] }[]; accepted?: { content: string[] }[][] };
      const used = new Set((sol.accepted ?? (sol.lines ? [sol.lines] : [])).flat().flatMap((l) => l.content));
      for (const t of tokens.filter((t) => t.renameable)) {
        expect({ id: p.id, token: t.text, kind: t.kind }).toMatchObject({ kind: "value" });
        expect(`${p.id}:${t.text}`).toBe(used.has(t.text) ? `${p.id}:${t.text}` : "unused-renameable-token");
      }
    }
  });

  it("the hunt level offers BOTH names, so which one holds which value is the player's call", () => {
    const hunt = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-hunt-001")!;
    const tokens = (hunt.payload as { tokens: { text: string; renameable?: boolean }[] }).tokens;
    const names = new Set(tokens.filter((t) => t.renameable).map((t) => t.text));
    expect([...names].sort()).toEqual(["x", "y"]);
  });

  it("the base variables level is a genuine multi-line program", () => {
    const vars = (pack.puzzles as unknown as Puzzle[]).find((p) => p.id === "py-code-base-001")!;
    expect((vars.solution as { lines?: unknown[] }).lines?.length).toBe(2);
    expect(vars.mechanics?.goalSpec?.output).toBe("5");
  });
});
