// Every BOARD level must frame itself. The room HUD renders exactly two content
// fields — `metadata.concept` (title) and `mechanics.goalSpec` (goal line) — and the
// only in-room help is a `hint_giver` cell plus `dialogue.hints`. Before this guard
// nine consecutive logic levels shipped titled "rule manipulation", with no goal line
// and no hint giver anywhere outside the Python pack, so the authored `prompt` and the
// logic pack's per-board `hint` never reached the screen at all.
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
    "%s: goal line, hint giver on a free floor cell, and escalating hints",
    (_id, p) => {
      // The HUD goal line the player actually reads.
      const desc = p.mechanics?.goalSpec?.description;
      expect(desc && desc.trim().length > 0).toBe(true);

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
