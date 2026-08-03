// Every DIFFICULTY a player can reach must explain the mechanic it adds.
//
// The ladder groups levels into mechanic rungs (Base / Mixed / Explicit / Shuffled /
// Shrouded — see core/ladder.resolveMechanic). A rung above Base exists precisely because
// it changes a rule: tiles come pre-placed, or punctuation is yours, or the layout is
// re-dealt, or the room goes dark. Before this guard, only `mixed` said so and a player
// walked into a shuffled or shrouded board with no idea what had changed.
//
// This is a CONTENT lint, not an engine test: it fails when a tier ships un-taught.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Pack, DialogueBeat } from "../schema/types";
import { resolveMechanic } from "./core/ladder";

const ROOT = join(__dirname, "..", "..");
const PACK_DIR = join(ROOT, "content", "packs");
const load = (file: string): Pack => JSON.parse(readFileSync(join(PACK_DIR, file), "utf8"));
const packFiles = readdirSync(PACK_DIR).filter((f) => f.endsWith(".json"));

// Base is the entry rung: it adds nothing to explain, and the room's own guided_tutorial
// teaches the controls there. Every rung ABOVE base introduces a rule change.
const TEACHABLE = ["mixed", "explicit", "shuffled", "shrouded"];

describe.each(packFiles)("%s — every non-base tier is taught", (file) => {
  const pack = load(file);
  const tiers = new Set(pack.puzzles.map((p) => resolveMechanic(p)));
  const teachable = TEACHABLE.filter((t) => tiers.has(t));

  it.each(teachable.length ? teachable : [null])("%s", (tier) => {
    if (tier === null) return; // pack has only base levels — nothing to teach
    const block = pack.tutorials?.[`tier:${tier}`];
    expect(block, `${file} has ${tier} levels but no "tier:${tier}" tutorial`).toBeTruthy();
    expect(block!.dialogue.length).toBeGreaterThan(0);

    // Every level on that rung must actually pull the tutorial in.
    for (const p of pack.puzzles.filter((q) => resolveMechanic(q) === tier)) {
      expect(p.tutorial_refs ?? [], `${p.id} does not reference tier:${tier}`).toContain(`tier:${tier}`);
    }
  });
});

describe.each(packFiles)("%s — shared tutorials are well-formed", (file) => {
  const pack = load(file);
  const entries = Object.entries(pack.tutorials ?? {});

  it.each(entries.length ? entries : [["(none)", null] as const])("%s", (_id, block) => {
    if (!block) return;
    for (const beat of block.dialogue as DialogueBeat[]) {
      expect(beat.trigger).toBe("guided_tutorial");
      // Room-world informational beats must opt out of the reading-speed timer, or they
      // vanish before a slow reader finishes (see dialogue.isAutoAdvance).
      if (!beat.waitFor) expect(beat.autoAdvance).toBe(false);
      // The show-the-idea rule: a shared tutorial introduces a CONCEPT, and a concept
      // that arrives as text alone is the failure mode this whole system exists to avoid.
      // At least the opening beat of each block has to carry a picture.
      expect(beat.text.trim().length).toBeGreaterThan(0);
    }
    expect(
      (block.dialogue as DialogueBeat[]).some((b) => b.demo || b.waitFor),
      `${_id} is text-only — give its opening beat a demo`,
    ).toBe(true);
  });
});
