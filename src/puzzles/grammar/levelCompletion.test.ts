// The completability stress test for the grammar track — the counterpart to
// puzzles/vocab/levelCompletion.test.ts and puzzles/coding/levelCompletion.test.ts.
//
// packPlaythrough.test.ts replays the AUTHORED route, which speaks only for the
// arrangement the author wrote it for. `randomized` levels DEAL THE WORDS OUT FRESH AT
// EVERY MOUNT (puzzles/grammar/index.ts permutes them among their own authored cells),
// so no fixed route can cover them — and a bad deal is a frame that cannot be filled.
//
// So: SOLVE every level from its own board — the authored deal, plus many of the deals
// the shuffle can really produce — and confirm each solution on the real push core.
import { describe, it, expect } from "vitest";
import enPack from "../../../content/packs/grammar.room.en.v1.json";
import hawPack from "../../../content/packs/grammar.room.haw.v1.json";
import type { Pack, Puzzle } from "../../schema/types";
import { playGrammar, solveGrammar, dealFor } from "./simHarness";

const packs: [string, Pack][] = [
  ["grammar.room.en.v1", enPack as unknown as Pack],
  ["grammar.room.haw.v1", hawPack as unknown as Pack],
];

/** Deals to demand of a randomized level — a wide sample, not every permutation. */
const DEALS = 16;

/** `-shrouded` is `-shuffled` plus a lighting change: same room, same words, same deals.
 *  Memoize on what the solver actually reads so the second one costs nothing. */
const proved = new Set<string>();

function proveSolvable(pz: Puzzle, seed: number) {
  const deal = dealFor(pz, seed);
  const memo = JSON.stringify([pz.room!.tiles, pz.room!.spawn, (pz.payload as { frame: unknown }).frame,
    (pz.payload as { structures: unknown }).structures, deal]);
  if (proved.has(memo)) return;
  const result = solveGrammar(pz, deal);
  const where = deal.map((word) => `${word.text}@${word.pos.x},${word.pos.y}`).join(" ");
  // "exhausted" is reported separately on purpose: it is a fact about the SOLVER's
  // budget, not about the room, and must never read as "this level is fine".
  expect(result.kind, `${pz.id} deal#${seed} — ${where}`).toBe("solved");
  // The planner works on a fast model; the WIN is only ever claimed by the real one.
  expect(
    playGrammar(pz, result.kind === "solved" ? result.moves : [], deal),
    `${pz.id} deal#${seed}: the planned route did not actually win`,
  ).toBe(true);
  proved.add(memo);
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
