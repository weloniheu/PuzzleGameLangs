// ---------------------------------------------------------------------------
// The `randomized` modifier's shuffle core. PURE, DOM-free, tested.
//
// A level that opts into `modifiers: ["randomized"]` gets its interactables'
// spawn cells PERMUTED WITHIN THE SET the content authored — piles for coding,
// movable word-tiles for the board games. The engine never invents a cell: it
// only reassigns the authored positions among the authored items, so what can
// appear where stays a content decision (and solvability stays content's
// responsibility — see the Modifier doc-comment in schema/types).
//
// The seed is RUNTIME state: random at mount, injectable here for tests. It is
// never stored in pack data.
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) — good enough for spawn shuffles.
 *  Same seed → same permutation, which is what the tests pin. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh runtime seed (mount-time). Kept here so callers never reach for
 *  Math.random directly — tests hand mulberry32 a fixed seed instead. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

/** Fisher–Yates over a COPY. PURE — the input array is never touched. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Permute the `pos` cells among `items`: returns NEW item objects, each holding
 * one of the ORIGINAL positions (the authored pool), assignment shuffled by `rng`.
 * The items' own order (and every other field) is preserved.
 */
export function shufflePositions<T extends { pos: { x: number; y: number } }>(
  items: readonly T[],
  rng: Rng,
): T[] {
  const pool = shuffled(items.map((it) => it.pos), rng);
  return items.map((it, i) => ({ ...it, pos: { ...pool[i] } }));
}
