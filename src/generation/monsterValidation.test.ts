// Monster validation — the load-time guards that keep a bad monster table from ever
// reaching a player (see the "MONSTERS" block in validateRepair.ts). Content-lint style:
// each test builds the smallest puzzle that isolates ONE rule, rather than exercising a
// full shipped pack (packIntegrity.test.ts already covers the happy path there).
import { describe, it, expect } from "vitest";
import { validatePuzzle } from "./validateRepair";
import type { Puzzle, RoomLayout, MonsterDef } from "../schema/types";

const BASE_ROOM: RoomLayout = {
  width: 5, height: 4,
  tiles: ["#####", "#...#", "#...#", "#####"],
  spawn: { x: 2, y: 2 },
  features: ["monsters", "coding_area", "inventory"],
  coding_area: { x: 1, y: 1, width: 2, height: 1 },
  controls: [
    { action: "build", label: "Build", pos: { x: 1, y: 2 } },
    { action: "run", label: "Run", pos: { x: 2, y: 2 } },
  ],
};

/** The smallest code_build puzzle that passes every OTHER check — one spawn override
 *  per test isolates exactly the rule under test. */
function puzzle(overrides: {
  spawns?: MonsterDef[];
  digest_ms?: number;
  steal_cooldown_ms?: number;
  piles?: RoomLayout["piles"];
  prefilled?: { token: string; x: number; y: number }[];
  lines?: { content: string[]; indent: number }[];
}): Puzzle {
  return {
    id: "test-monster-validation", schema_version: "1.0.0", language: "test",
    puzzle_type: "code_build", validator_type: "code_match", difficulty: 1,
    prompt: "p",
    payload: { scenario: "s", goal: "g", tokens: [{ text: "print", kind: "function" }] },
    solution: {
      output: "hi",
      lines: overrides.lines ?? [{ content: ["print"], indent: 0 }],
    },
    hints: [], metadata: { reviewed: true },
    room: {
      ...BASE_ROOM,
      piles: overrides.piles,
      coding_area: { ...BASE_ROOM.coding_area!, prefilled: overrides.prefilled },
      monsters: {
        digest_ms: overrides.digest_ms,
        steal_cooldown_ms: overrides.steal_cooldown_ms,
        spawns: overrides.spawns ?? [{ token: "print", pos: { x: 3, y: 1 } }],
      },
    },
  };
}

describe("behavior × token — mutually exclusive", () => {
  it("a carrier (default behavior) needs a token", () => {
    const { ok, errors } = validatePuzzle(puzzle({ spawns: [{ pos: { x: 3, y: 1 } }] }));
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes("carrier monster needs a loot token"))).toBe(true);
  });

  it("an explicit carrier behavior also needs a token", () => {
    const { errors } = validatePuzzle(
      puzzle({ spawns: [{ behavior: "carrier", pos: { x: 3, y: 1 } }] }),
    );
    expect(errors.some((e) => e.includes("carrier monster needs a loot token"))).toBe(true);
  });

  it("a thief must NOT declare a token", () => {
    const { ok, errors } = validatePuzzle(
      puzzle({ spawns: [{ behavior: "thief", token: "print", pos: { x: 3, y: 1 } }] }),
    );
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('must not declare "token"'))).toBe(true);
  });

  it("a thief with NO token, and a safe pile source, validates cleanly", () => {
    const { ok, errors } = validatePuzzle(puzzle({
      spawns: [{ behavior: "thief", pos: { x: 3, y: 1 } }],
      piles: [{ token: "print", pos: { x: 3, y: 3 } }],
    }));
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects an unknown behavior string", () => {
    const { errors } = validatePuzzle(
      // @ts-expect-error deliberately invalid content, exactly what this guard exists for
      puzzle({ spawns: [{ behavior: "ghost", token: "print", pos: { x: 3, y: 1 } }] }),
    );
    expect(errors.some((e) => e.includes('unknown behavior "ghost"'))).toBe(true);
  });
});

describe("thief timings must be positive", () => {
  it("rejects digest_ms <= 0", () => {
    const { errors } = validatePuzzle(puzzle({ digest_ms: 0 }));
    expect(errors.some((e) => e.includes("digest_ms must be > 0"))).toBe(true);
  });

  it("rejects a negative steal_cooldown_ms", () => {
    const { errors } = validatePuzzle(puzzle({ steal_cooldown_ms: -50 }));
    expect(errors.some((e) => e.includes("steal_cooldown_ms must be > 0"))).toBe(true);
  });

  it("accepts sane positive values", () => {
    const { ok } = validatePuzzle(puzzle({ digest_ms: 5000, steal_cooldown_ms: 2000 }));
    expect(ok).toBe(true);
  });
});

describe("the softlock guard — a thief must never be a token's ONLY source", () => {
  it("rejects a level where the answer's only source is the thief's OWN loot", () => {
    const { ok, errors } = validatePuzzle(puzzle({
      spawns: [{ behavior: "thief", pos: { x: 3, y: 1 } }],
      // No pile, no carrier, no prefilled — "print" has nowhere thief-proof to come from.
    }));
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('token "print" has no thief-proof source'))).toBe(true);
  });

  it("a PILE source clears the guard", () => {
    const { ok } = validatePuzzle(puzzle({
      spawns: [{ behavior: "thief", pos: { x: 3, y: 1 } }],
      piles: [{ token: "print", pos: { x: 3, y: 3 } }],
    }));
    expect(ok).toBe(true);
  });

  it("a CARRIER's loot clears the guard (a second, non-thief monster)", () => {
    const { ok } = validatePuzzle(puzzle({
      spawns: [
        { behavior: "thief", pos: { x: 3, y: 1 } },
        { token: "print", pos: { x: 3, y: 2 } }, // carrier
      ],
    }));
    expect(ok).toBe(true);
  });

  it("PREFILLED scaffolding clears the guard (never stealable in the first place)", () => {
    const { ok } = validatePuzzle(puzzle({
      spawns: [{ behavior: "thief", pos: { x: 3, y: 1 } }],
      prefilled: [{ token: "print", x: 1, y: 1 }],
    }));
    expect(ok).toBe(true);
  });

  it("does NOT fire for a room with no coding_area (a thief can't steal from what doesn't exist)", () => {
    const p = puzzle({ spawns: [{ behavior: "thief", pos: { x: 3, y: 1 } }] });
    p.room!.features = ["monsters", "inventory"]; // coding_area feature dropped
    delete p.room!.coding_area;
    // Also drop the assembly requirement this room type would otherwise need.
    p.solution = { output: "hi" };
    const { errors } = validatePuzzle(p);
    expect(errors.some((e) => e.includes("thief-proof source"))).toBe(false);
  });

  it("does NOT fire for carrier-only rooms (no thief at all)", () => {
    const { errors } = validatePuzzle(puzzle({ spawns: [{ token: "print", pos: { x: 3, y: 1 } }] }));
    expect(errors.some((e) => e.includes("thief-proof source"))).toBe(false);
  });
});
