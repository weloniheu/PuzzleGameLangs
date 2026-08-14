import type { Pack, Puzzle, Difficulty, PuzzleType } from "../schema/types";
import { validatePuzzle } from "../generation/validateRepair";

// ---------------------------------------------------------------------------
// Packs are BUNDLED, not fetched.
//
// They used to be fetched from "/content/packs/*.json" at runtime. That only
// ever worked in `npm run dev` (the dev server happens to serve the project
// root) — `content/` lives outside `public/`, so Vite never copied it and every
// production build 404'd on all seven packs before the game could start.
//
// Inlining them at build time fixes that everywhere at once, and is also the
// only form that survives a desktop shell, where the page loads over file://
// and fetch() is blocked outright. Costs ~400 KB in the bundle (~100 KB
// gzipped) and removes seven round-trips from boot.
//
// Adding a language is still data-only (CLAUDE.md Rule 1): drop a JSON file in
// content/packs/ and the glob picks it up — though the dev server may need a
// restart to notice a brand-new file.
// ---------------------------------------------------------------------------
const BUNDLED = import.meta.glob<Pack>("../../content/packs/*.json", {
  eager: true,
  import: "default",
});

/** Glob keys are module specifiers ("../../content/packs/x.json") but callers
 *  pass authored URLs ("/content/packs/x.json"). Key by filename so neither
 *  side has to know about the other. */
const BY_FILE = new Map<string, Pack>(
  Object.entries(BUNDLED).map(([spec, pack]) => [spec.slice(spec.lastIndexOf("/") + 1), pack])
);

/** Every pack filename compiled into this build (for diagnostics + tests). */
export function bundledPackFiles(): string[] {
  return [...BY_FILE.keys()].sort();
}

/**
 * Loads a pack and validates EVERY puzzle on load (belt-and-suspenders: even
 * curated packs get re-checked, because the engine version may have changed).
 * Bad puzzles are dropped with a console warning rather than crashing the game.
 *
 * Stays async: the lookup is synchronous now, but every caller awaits this and
 * keeping the signature means none of them had to change.
 */
export async function loadPack(url: string): Promise<Pack> {
  const bundled = BY_FILE.get(url.slice(url.lastIndexOf("/") + 1));
  if (!bundled) {
    throw new Error(
      `Failed to load pack: ${url} — not bundled. Available: ${bundledPackFiles().join(", ")}`
    );
  }
  // Deep-copy: a bundled module is ONE shared object, where every fetch()
  // previously produced a fresh parse. Handing out the shared instance would
  // let any runtime mutation of a puzzle leak into later loads of the same pack.
  const pack = structuredClone(bundled);

  const good: Puzzle[] = [];
  for (const p of pack.puzzles) {
    const { ok, errors } = validatePuzzle(p);
    if (ok) good.push(p);
    else console.warn(`Dropping puzzle "${(p as Puzzle).id}":`, errors);
  }
  // Cross-check tutorial_refs against the pack's shared tutorials (validatePuzzle can't — it
  // sees one puzzle at a time). A dangling ref just won't play; warn so authors catch typos.
  const tutorialIds = new Set(Object.keys(pack.tutorials ?? {}));
  for (const p of good) {
    for (const ref of p.tutorial_refs ?? []) {
      if (!tutorialIds.has(ref)) console.warn(`Puzzle "${p.id}" references unknown tutorial "${ref}"`);
    }
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
