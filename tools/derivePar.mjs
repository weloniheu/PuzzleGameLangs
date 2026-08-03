// Phase 2 — derive `par` from the layout instead of guessing it.
//
// Base levels: par = solved route + 15%.
// `randomized` variants: the tiles are permuted among their authored cells at mount, so
// one par has to cover every arrangement. Sample permutations, take the WORST route, and
// add the same 15%. The sampling doubles as a winnability check — now that the rooms have
// interior walls, a shuffle that strands a tile would be a shipped soft-lock.
import fs from "fs";
import { solveGrammar, solveVocab, parFor } from "./pushSolver.mjs";

const SAMPLES = Number(process.env.SAMPLES ?? 24);
const baseOf = (id) => id.replace(/-(shuffled|shrouded)$/, "");

// mulberry32 + the same position permutation the engine uses (core/shuffle.ts).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shufflePositions(items, rnd) {
  const cells = items.map((i) => ({ ...i.pos }));
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return items.map((it, i) => ({ ...it, pos: cells[i] }));
}

function withShuffle(puzzle, seed, key) {
  const p = JSON.parse(JSON.stringify(puzzle));
  p.payload[key] = shufflePositions(p.payload[key], mulberry32(seed));
  return p;
}

const PACKS = [
  ["content/packs/vocab.room.haw.v1.json", solveVocab, "tiles"],
  ["content/packs/vocab.room.en.v1.json", solveVocab, "tiles"],
  ["content/packs/grammar.room.en.v1.json", solveGrammar, "words"],
];

let failures = 0;
for (const [path, solve, key] of PACKS) {
  const pack = JSON.parse(fs.readFileSync(path, "utf8"));
  const basePar = {};
  // Pass 1: base levels.
  for (const p of pack.puzzles) {
    if (p.id !== baseOf(p.id)) continue;
    const r = solve(p);
    if (r.moves == null) { console.log(`!! ${p.id}: UNSOLVABLE`); failures++; continue; }
    basePar[p.id] = parFor(r.moves);
    p.payload.par = basePar[p.id];
    console.log(`${p.id}: route=${r.moves} par=${p.payload.par}`);
  }
  // Pass 2: randomized variants — worst sampled arrangement.
  for (const p of pack.puzzles) {
    if (p.id === baseOf(p.id)) continue;
    let worst = 0, bad = 0;
    for (let s = 1; s <= SAMPLES; s++) {
      const r = solve(withShuffle(p, s * 7919, key));
      if (r.moves == null) { bad++; continue; }
      worst = Math.max(worst, r.moves);
    }
    if (bad) { console.log(`!! ${p.id}: ${bad}/${SAMPLES} sampled shuffles UNSOLVABLE`); failures++; }
    // Never below the base level's budget — a shuffle should not be stricter.
    p.payload.par = Math.max(parFor(worst), basePar[baseOf(p.id)] ?? 0);
    console.log(`${p.id}: worst of ${SAMPLES}=${worst} par=${p.payload.par}${bad ? ` (${bad} unsolvable)` : ""}`);
  }
  fs.writeFileSync(path, JSON.stringify(pack, null, 2) + "\n");
}
console.log(failures ? `\n${failures} PROBLEM(S) — see !! lines` : "\nall levels solvable");
