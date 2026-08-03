// Every authored level must actually REACH the player.
//
// `loadPack` validates each puzzle and DROPS the failures with a console.warn (a warning
// nobody reads in a browser). That silence hid 21 levels: `Difficulty` was capped at 5
// while three packs ramp to 6-8, so the whole English Lexicon II/III tier, Hoʻopunipuni,
// and the late logic boards were parsed, rejected and discarded on every boot. In the
// ladder they degraded further — a progression entry whose puzzle is missing falls back
// to `resolveMechanic(undefined)` → "base", so the dropped levels showed up as duplicate
// dead rows on the Base rung that could never be entered.
//
// These are the two guards that turn that class of failure loud.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Pack } from "../schema/types";
import { validatePuzzle } from "../generation/validateRepair";
import { resolveMechanic } from "./core/ladder";

const ROOT = join(__dirname, "..", "..");
const PACK_DIR = join(ROOT, "content", "packs");
const load = (file: string): Pack => JSON.parse(readFileSync(join(PACK_DIR, file), "utf8"));
// PUZZLE packs only — the ones that go through engine/packLoader. `logic.rules.*` are LOGIC
// BOARD packs (objects/words/par), read by the logic module's own loader against its own
// schema (src/puzzles/logic/schema.ts); the Puzzle validator does not describe them.
const packFiles = readdirSync(PACK_DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => (load(f).puzzles ?? []).some((p) => !!p?.puzzle_type));

describe.each(packFiles)("%s — ships nothing the loader will throw away", (file) => {
  const pack = load(file);

  it("every puzzle passes validatePuzzle (a failure is a level the player never sees)", () => {
    const rejected = pack.puzzles
      .map((p) => ({ id: p.id, errors: validatePuzzle(p).errors }))
      .filter((r) => r.errors.length)
      .map((r) => `${r.id}: ${r.errors.join("; ")}`);
    expect(rejected).toEqual([]);
  });

  it("every progression entry resolves to a real puzzle", () => {
    const ids = new Set(pack.puzzles.map((p) => p.id));
    const dangling: string[] = [];
    for (const prog of pack.progression ?? []) {
      for (const lv of prog.levels) if (!ids.has(lv.id)) dangling.push(lv.id);
    }
    expect(dangling).toEqual([]);
  });

  it("a level's ladder rung comes from its own puzzle, so variants never collapse into Base", () => {
    // The symptom of a missing puzzle: `-shuffled` / `-shrouded` entries stamped "base".
    const byId = new Map(pack.puzzles.map((p) => [p.id, p]));
    const miscategorised: string[] = [];
    for (const prog of pack.progression ?? []) {
      for (const lv of prog.levels) {
        const mech = lv.mechanic ?? resolveMechanic(byId.get(lv.id));
        const expected = lv.id.endsWith("-shrouded") ? "shrouded"
          : lv.id.endsWith("-shuffled") ? "shuffled" : null;
        if (expected && mech !== expected) miscategorised.push(`${lv.id} → ${mech}`);
      }
    }
    expect(miscategorised).toEqual([]);
  });
});
