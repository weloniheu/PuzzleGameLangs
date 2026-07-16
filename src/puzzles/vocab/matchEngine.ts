// ---------------------------------------------------------------------------
// VOCAB puzzle — the pure matching engine. NO DOM. This is the core; tested hard.
//
// Sokoban push-to-match: tiles get pushed around the board, and when two tiles
// that form a VALID PAIR end up side by side they LOCK as matched. This engine
// only answers "are these two tiles a pair?" and "is everything matched?" — the
// PAIRING SEMANTICS live in the pack. Word↔meaning and synonym↔synonym are the
// SAME engine with different pack data; nothing here knows which one it is
// (and nothing knows a language — tile ids are opaque).
// ---------------------------------------------------------------------------

/** An unordered pair of tile ids the pack declares as matching. */
export type VocabPair = readonly [string, string];

/** A tile as the matcher sees it: where it is and whether it's already locked. */
export interface PlacedTile {
  id: string;
  x: number;
  y: number;
  matched: boolean;
}

/** Do `a` and `b` form a declared pair (order-independent)? */
export function isPair(pairs: ReadonlyArray<VocabPair>, a: string, b: string): boolean {
  return pairs.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

/**
 * After a tile moves: the UNMATCHED partner now sitting ORTHOGONALLY adjacent to
 * it (pushed together), or null. Diagonals don't count; already-locked tiles
 * don't re-match; a tile next to somebody ELSE's partner stays unmatched.
 */
export function adjacentPartner(
  tiles: ReadonlyArray<PlacedTile>,
  movedId: string,
  pairs: ReadonlyArray<VocabPair>,
): string | null {
  const moved = tiles.find((t) => t.id === movedId);
  if (!moved || moved.matched) return null;
  for (const t of tiles) {
    if (t.id === moved.id || t.matched) continue;
    const adjacent = Math.abs(t.x - moved.x) + Math.abs(t.y - moved.y) === 1;
    if (adjacent && isPair(pairs, moved.id, t.id)) return t.id;
  }
  return null;
}

/** Win when EVERY declared pair is locked (tiles outside any pair are scenery). */
export function isWon(
  tiles: ReadonlyArray<PlacedTile>,
  pairs: ReadonlyArray<VocabPair>,
): boolean {
  const matched = new Set(tiles.filter((t) => t.matched).map((t) => t.id));
  return pairs.every(([a, b]) => matched.has(a) && matched.has(b));
}

/**
 * ANTI-BRUTE-FORCE: after a push, the WRONG tile the moved tile was shoved face-first
 * against — the unmatched non-partner sitting in the cell the push was heading into.
 * That geometry is a deliberate "do these two match?" test (the same shove that locks
 * a real pair), so it can be priced; lateral adjacency from routing past a tile never
 * counts. Returns the bumped tile's id, or null.
 */
export function bumpedWrongTile(
  tiles: ReadonlyArray<PlacedTile>,
  movedId: string,
  dir: { dx: number; dy: number },
  pairs: ReadonlyArray<VocabPair>,
): string | null {
  const moved = tiles.find((t) => t.id === movedId);
  if (!moved || moved.matched) return null;
  const ahead = tiles.find((t) => t.x === moved.x + dir.dx && t.y === moved.y + dir.dy);
  if (!ahead || ahead.matched) return null;
  return isPair(pairs, moved.id, ahead.id) ? null : ahead.id;
}

/** A prop's mechanical shape: where it stands and which tile its LABEL truly accepts. */
export interface VocabPropLite {
  id: string;
  accepts: string;
  x: number;
  y: number;
}

/**
 * The SIGN a moved tile was shoved face-first against, or null. Presenting a tile to
 * a sign is a deliberate "does this word belong here?" test — the caller compares the
 * tile against `accepts` to confirm (free knowledge) or price it (a guess).
 */
export function propPresented(
  props: ReadonlyArray<VocabPropLite>,
  moved: PlacedTile | undefined,
  dir: { dx: number; dy: number },
): VocabPropLite | null {
  if (!moved || moved.matched) return null;
  return props.find((p) => p.x === moved.x + dir.dx && p.y === moved.y + dir.dy) ?? null;
}
