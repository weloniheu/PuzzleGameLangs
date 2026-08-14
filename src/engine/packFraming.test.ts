// Every BOARD level must frame itself. The room HUD renders exactly two content
// fields — `metadata.concept` (title) and `mechanics.goalSpec` (the on-demand task
// prompt, opened with the "task" action — see systems/taskOverlay.ts) — and the only
// in-room help is a `hint_giver` cell plus `dialogue.hints`. Before this guard nine
// consecutive logic levels shipped titled "rule manipulation", with no task prompt
// and no hint giver anywhere outside the Python pack, so the authored `prompt` and the
// logic pack's per-board `hint` never reached the screen at all.
//
// `logic_rules` (Baba-style rule manipulation) is the one exception to the goalSpec
// requirement, and deliberately so: its rule tiles ON THE FLOOR (e.g. "FLAG IS WIN")
// ARE the goal, so a goalSpec banner would spell out in English what the puzzle itself
// already says — it shipped once, by accident, and got walked back (see
// validateRepair.ts's matching guard). Title + hint giver + hints still apply there.
//
// This is a CONTENT lint, not an engine test: it fails when a level is authored
// without the framing the room is able to show.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack, Puzzle, DialogueConfig } from "../schema/types";
import { resolveMechanic } from "./core/ladder";

const ROOT = join(__dirname, "..", "..");
const load = (rel: string): Pack => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const BOARD_PACKS = [
  "content/packs/vocab.room.haw.v1.json",
  "content/packs/vocab.room.en.v1.json",
  "content/packs/grammar.room.en.v1.json",
  "content/packs/logic.room.en.v1.json",
  "content/packs/logic.room.haw.v1.json",
];

const dialogueOf = (p: Puzzle): DialogueConfig | undefined =>
  (p.payload as { dialogue?: DialogueConfig }).dialogue;

describe.each(BOARD_PACKS)("%s — every level frames itself", (rel) => {
  const pack = load(rel);

  it("titles are unique within the pack (no repeated 'rule manipulation')", () => {
    const concepts = pack.puzzles.map((p) => p.metadata.concept);
    expect(concepts.every((c) => !!c && c.trim().length > 0)).toBe(true);
    expect(new Set(concepts).size).toBe(concepts.length);
  });

  it.each(pack.puzzles.map((p): [string, Puzzle] => [p.id, p]))(
    "%s: task prompt (except Baba-style logic_rules), hint giver on a free floor cell, and escalating hints",
    (_id, p) => {
      if (p.puzzle_type === "logic_rules") {
        // The rule tiles ARE the goal — a goalSpec here would spoil the puzzle by
        // spelling out in English what the floor already says (see validateRepair.ts).
        expect(p.mechanics?.goalSpec).toBeUndefined();
      } else {
        // The task prompt (opened with T) the player actually reads.
        const desc = p.mechanics?.goalSpec?.description;
        expect(desc && desc.trim().length > 0).toBe(true);
      }

      // Declaring a goalSpec must NOT claim a mechanic tier — that would collapse the
      // ladder's Shuffled/Shrouded rungs into "Base" (see ladder.resolveMechanic).
      expect(p.mechanics?.tier).toBeUndefined();
      expect(resolveMechanic(p)).toBe(
        p.modifiers?.includes("lowlight") ? "shrouded"
          : p.modifiers?.includes("randomized") ? "shuffled" : "base",
      );

      // In-room help: a reachable marker plus at least two escalating lines.
      const giver = p.room?.hint_giver;
      expect(giver).toBeTruthy();
      const { x, y } = giver!.pos;
      const row = p.room!.tiles[y];
      expect(row?.[x]).toBe("."); // a floor cell, not a wall and not off-grid
      // Never on the spawn cell — that is the menu portal (the room's exit).
      expect(`${x},${y}`).not.toBe(`${p.room!.spawn!.x},${p.room!.spawn!.y}`);

      const hints = dialogueOf(p)?.hints ?? [];
      expect(hints.length).toBeGreaterThanOrEqual(2);
      expect(hints.every((h) => h.text.trim().length > 0)).toBe(true);
    },
  );
});

// The CODING pack can't join BOARD_PACKS above: that loop asserts `mechanics.tier`
// is undefined, and coding levels legitimately carry tiers (base/mixed/explicit).
// It gets its own narrower lint — which is exactly why it drifted: four levels once
// shipped a single hint whose text was the finished program, so the first press of
// the "?" handed over the answer with no ladder in between.
describe("content/packs/python.code.v1.json — hints must be a LADDER, not the answer", () => {
  const pack = load("content/packs/python.code.v1.json");

  it.each(pack.puzzles.map((p): [string, Puzzle] => [p.id, p]))(
    "%s: a reachable hint giver and at least three escalating hints",
    (_id, p) => {
      const giver = p.room?.hint_giver;
      expect(giver).toBeTruthy();
      const { x, y } = giver!.pos;
      expect(p.room!.tiles[y]?.[x]).toBe("."); // a floor cell, not a wall and not off-grid

      const hints = dialogueOf(p)?.hints ?? [];
      // Nudge → structure → answer. Fewer than three means the ladder collapsed.
      expect(hints.length).toBeGreaterThanOrEqual(3);
      expect(hints.every((h) => h.text.trim().length > 0)).toBe(true);
      // Every rung distinct — a repeated line is a rung that teaches nothing.
      expect(new Set(hints.map((h) => h.text)).size).toBe(hints.length);
    },
  );
});
