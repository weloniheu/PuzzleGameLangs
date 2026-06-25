import type { Pack, Puzzle, Difficulty, PuzzleType } from "../schema/types";
import { validatePuzzle } from "../generation/validateRepair";

/**
 * Loads a pack and validates EVERY puzzle on load (belt-and-suspenders: even
 * curated packs get re-checked, because the engine version may have changed).
 * Bad puzzles are dropped with a console warning rather than crashing the game.
 */
export async function loadPack(url: string): Promise<Pack> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load pack: ${url} (${res.status})`);
  const pack = (await res.json()) as Pack;

  const good: Puzzle[] = [];
  for (const p of pack.puzzles) {
    const { ok, errors } = validatePuzzle(p);
    if (ok) good.push(p);
    else console.warn(`Dropping puzzle "${(p as Puzzle).id}":`, errors);
  }
  return { ...pack, puzzles: good };
}

/**
 * Query-based selection (roadmap Phase 5.2). Rooms ask for "a difficulty-2
 * Hawaiian match puzzle" instead of hardcoding an id, so generated packs slot
 * straight in.
 */
export function query(
  pack: Pack,
  opts: { difficulty?: Difficulty; puzzle_type?: PuzzleType } = {}
): Puzzle[] {
  return pack.puzzles.filter(
    (p) =>
      (opts.difficulty == null || p.difficulty === opts.difficulty) &&
      (opts.puzzle_type == null || p.puzzle_type === opts.puzzle_type)
  );
}
