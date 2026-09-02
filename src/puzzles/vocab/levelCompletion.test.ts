// The completability stress test for the vocab track — the counterpart to
// puzzles/coding/levelCompletion.test.ts.
//
// packPlaythrough.test.ts replays the AUTHORED ★★★ route, which proves the levels an
// author wrote a route for, in the arrangement the author wrote it for. That leaves the
// bigger half unproven: `randomized` levels DEAL THE TILES OUT FRESH AT EVERY MOUNT
// (puzzles/vocab/index.ts permutes them among their own authored cells), so no fixed
// route can speak for them — and a bad deal is a room that cannot be finished at all.
// The pack's "padding lint" (no tile flush against a wall) is a proxy for exactly that
// worry; this is the proof.
//
// So: SOLVE every level from its own board — the authored deal, plus many of the deals
// the shuffle can actually produce — and replay each solution through the real engine.
import { describe, it, expect } from "vitest";
import hawPack from "../../../content/packs/vocab.room.haw.v1.json";
import enPack from "../../../content/packs/vocab.room.en.v1.json";
import type { Pack, Puzzle } from "../../schema/types";
import { playVocab, solveVocab, dealFor } from "./simHarness";

const packs: [string, Pack][] = [
  ["vocab.room.haw.v1", hawPack as unknown as Pack],
  ["vocab.room.en.v1", enPack as unknown as Pack],
];

/** How many distinct deals to demand of a randomized level. Each is a room a player can
 *  really be dropped into, so each has to be finishable. A sample, not a proof over every
 *  permutation — nine tiles deal 362,880 ways — but a wide one, and it re-runs on every
 *  change to the pack. */
const DEALS = 16;

/** Solving is the expensive part, and the `-shrouded` variant of a level is the `-shuffled`
 *  one plus a lighting change: same room, same tiles, same pairs, same deals. Memoize on
 *  what the solver actually reads so the second one is free. */
const solved = new Map<string, boolean>();
const boardKey = (pz: Puzzle, seed: number) => JSON.stringify([
  pz.room!.tiles, pz.room!.spawn, (pz.payload as { pairs: unknown }).pairs,
  (pz.payload as { props?: unknown }).props ?? null, dealFor(pz, seed), seed,
]);

/** Solve one deal and prove the route on the real engine. Returns nothing — it throws
 *  with the level and seed when a room turns out to be unfinishable. */
function proveSolvable(pz: Puzzle, seed: number) {
  const memo = boardKey(pz, seed);
  if (solved.get(memo)) return; // an identical board+deal already proved out
  const deal = dealFor(pz, seed);
  const result = solveVocab(pz, deal);
  const where = deal.map((t) => `${t.id}@${t.pos.x},${t.pos.y}`).join(" ");
  // "exhausted" is reported separately on purpose — it means the search ran out of
  // budget, which is a fact about the SOLVER, not about the room.
  expect(result.kind, `${pz.id} deal#${seed} — ${where}`).toBe("solved");
  // The planner works on a fast model; the WIN is only ever claimed by the real one.
  const run = playVocab(pz, result.kind === "solved" ? result.moves : [], deal);
  expect(run.won, `${pz.id} deal#${seed}: the planned route did not actually win`).toBe(true);
  solved.set(memo, true);
}

describe.each(packs)("%s — every level can be finished from every deal it can hand out", (_name, pack) => {
  it.each(pack.puzzles.map((p): [string, Puzzle] => [p.id, p]))("%s", (_id, pz) => {
    // A fixed level only ever plays one arrangement — its authored one, which every
    // seed returns. A randomized level deals a new arrangement at every mount, so it
    // has to answer for a whole sample of them.
    const deals = pz.modifiers?.includes("randomized") ? DEALS : 1;
    for (let seed = 1; seed <= deals; seed++) proveSolvable(pz, seed);
  });
});
