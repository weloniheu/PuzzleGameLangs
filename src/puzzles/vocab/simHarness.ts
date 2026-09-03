// ---------------------------------------------------------------------------
// VOCAB board SIM — the module's move loop, without the DOM. Test support only
// (nothing in the game imports it), extracted so the two suites that need it
// agree by construction rather than by two copies staying in sync:
//
//   • packPlaythrough.test.ts — replays the AUTHORED ★★★ route for each level;
//   • levelCompletion.test.ts — replays whatever its solver planned, including
//     for the `randomized` deals no authored route could ever cover.
//
// It drives the SAME pure pieces the real module does (ruleEngine.tryMove for the
// push train, matchEngine for locking / guesses / the win test), so a route that
// wins here wins in the room.
// ---------------------------------------------------------------------------

import type { Puzzle, VocabMatchPayload, VocabTileDef } from "../../schema/types";
import { tryMove, DIRECTIONS, type Board, type RuleSet } from "../logic/ruleEngine";
import type { PropertyId } from "../logic/schema";
import { adjacentPartner, bumpedWrongTile, isWon, propPresented, type VocabPair } from "./matchEngine";

export type Dir = "up" | "down" | "left" | "right";

/** A route written as one U/D/L/R string — long push routes read better that way. */
export const path = (s: string): Dir[] =>
  [...s].map((c) => ({ U: "up", D: "down", L: "left", R: "right" } as Record<string, Dir>)[c]);

export interface VocabRun {
  won: boolean;
  /** Moves that actually happened (a blocked press is free). */
  moves: number;
  /** DISTINCT wrong combinations tried — what caps the star rating. */
  guesses: number;
  /** Signs whose label truly took the word presented to them. */
  confirmed: Set<string>;
}

/**
 * Play `moves` on `pz` and report how it went. `tiles` overrides the authored tile
 * placement — that is how a `randomized` DEAL is played: the module permutes the tiles
 * among their own authored cells at mount (see puzzles/vocab/index.ts), and handing the
 * permuted list in here reproduces exactly that room.
 */
export function playVocab(pz: Puzzle, moves: Dir[], tiles?: VocabTileDef[]): VocabRun {
  const payload = pz.payload as VocabMatchPayload;
  const room = pz.room!;
  const pairs = payload.pairs as VocabPair[];
  const deal = tiles ?? payload.tiles;
  const props = (payload.props ?? []).map((p) => ({ id: p.id, accepts: p.accepts, x: p.pos.x, y: p.pos.y }));
  const board: Board = {
    width: room.width - 2,
    height: room.height - 2,
    entities: [
      { id: "player", noun: "player", x: room.spawn!.x - 1, y: room.spawn!.y - 1 },
      ...deal.map((t) => ({ id: t.id, noun: "tile", x: t.pos.x, y: t.pos.y })),
      ...props.map((p) => ({ id: `prop:${p.id}`, noun: "prop", x: p.x, y: p.y })),
    ],
    pattern: { slots: [], directions: [] },
  };
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (room.tiles[y][x] === "#") {
        board.entities.push({ id: `wall:${x},${y}`, noun: "wall", x: x - 1, y: y - 1 });
      }
    }
  }
  const rules: RuleSet = {
    rules: [], transforms: [],
    properties: new Map<string, Set<PropertyId>>([
      ["player", new Set<PropertyId>(["you"])],
      ["tile", new Set<PropertyId>(["push"])],
      ["locked", new Set<PropertyId>(["stop"])],
      ["wall", new Set<PropertyId>(["stop"])],
      ["prop", new Set<PropertyId>(["stop"])],
    ]),
  };
  const matched = new Set<string>();
  const guesses = new Set<string>();
  const confirmed = new Set<string>(); // signs whose LABEL truly took the presented word
  const isWordTile = (e: { noun?: string }) => e.noun === "tile" || e.noun === "locked";
  const placed = () => board.entities
    .filter(isWordTile)
    .map((e) => ({ id: e.id, x: e.x, y: e.y, matched: matched.has(e.id) }));
  let count = 0;
  for (const m of moves) {
    const dir = DIRECTIONS[m];
    const before = new Map(board.entities.map((e) => [e.id, `${e.x},${e.y}`]));
    const player = board.entities.find((e) => e.id === "player")!;
    if (!tryMove(board, player, dir, rules)) continue;
    count++;
    const movedIds = new Set(
      board.entities.filter((e) => before.get(e.id) !== `${e.x},${e.y}`).map((e) => e.id),
    );
    for (const e of board.entities) {
      if (!isWordTile(e) || !movedIds.has(e.id)) continue;
      const partner = adjacentPartner(placed(), e.id, pairs);
      if (partner) {
        matched.add(e.id).add(partner);
        for (const t of board.entities) {
          if (t.id === e.id || t.id === partner) t.noun = "locked";
        }
      }
    }
    for (const e of board.entities) {
      if (!isWordTile(e) || !movedIds.has(e.id) || matched.has(e.id)) continue;
      const b = bumpedWrongTile(placed(), e.id, dir, pairs);
      if (b && !movedIds.has(b)) guesses.add([e.id, b].sort().join("|"));
      const sign = propPresented(props, placed().find((t) => t.id === e.id), dir);
      if (sign && sign.accepts !== e.id) guesses.add(`prop:${sign.id}|${e.id}`);
      else if (sign) confirmed.add(sign.id);
    }
  }
  return { won: isWon(placed(), pairs), moves: count, guesses: guesses.size, confirmed };
}

// ---------------------------------------------------------------------------
// The SOLVER. Test support: it answers "can this arrangement be finished at all?"
//
// PLAN on a fast model, VERIFY on the real one. The model below mirrors the push
// train and the locking pass exactly (see press), but on flat typed arrays so a search
// can afford tens of thousands of positions; whatever it plans is replayed through
// playVocab — the real ruleEngine — so a wrong model can only ever cost a false
// "no route", never a false "solved".
//
// Three things keep it small enough to run in a test:
//   • it searches over PUSHES, not presses. Walking changes nothing, so every position
//     that differs only by where the player stands collapses into one, keyed by the
//     REGION they can walk (the standard Sokoban normalization).
//   • it locks the pairs one leg at a time and backtracks over the ORDER — a locked
//     pair is furniture, so a greedy order really can strand a later pair.
//   • each leg first tries pushing ONLY that pair (how a player would do it) before
//     paying for a search that may shove anything.
//
// A leg that runs out of budget reports "exhausted", never "unsolvable": a test has to
// be able to tell "this room cannot be finished" from "I could not tell".
// ---------------------------------------------------------------------------

import { mulberry32, shufflePositions } from "../../engine/core/shuffle";

/** Cells are ints (y * w + x) throughout the solver — string keys were most of its cost. */
const DIRS: [Dir, number, number][] = [
  ["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0],
];

/** Positions expanded per leg, so a pathological board reports "exhausted", not a hang.
 *  The narrow pass (push only the pair) gets less; the wider one more. */
const PAIR_BUDGET = 12_000;
const FULL_BUDGET = 40_000;

interface Model {
  w: number;
  h: number;
  /** 1 = a static stop (wall or sign). Indexed by cell. */
  blocked: Uint8Array;
  /** Cell → step delta, per direction (bounds-checked via `wall`). */
  partner: Int32Array;   // tile index → its pair's index (-1 = a decoy)
  tiles: number;
  start: SolveState;
}
interface SolveState {
  player: number;
  /** Cell per tile. */
  pos: Int32Array;
  locked: Uint8Array;
}

/** The deal a `randomized` level would produce for `seed` — the module's own permutation
 *  (engine/core/shuffle), over the level's own authored cells. A level without the
 *  modifier always deals as authored, whatever the seed. */
export function dealFor(pz: Puzzle, seed: number): VocabTileDef[] {
  const tiles = (pz.payload as VocabMatchPayload).tiles;
  if (!pz.modifiers?.includes("randomized")) return tiles;
  return shufflePositions(tiles, mulberry32(seed));
}

export type SolveResult =
  | { kind: "solved"; moves: Dir[] }
  | { kind: "unsolvable" }   // the search closed out every position it could reach
  | { kind: "exhausted" };   // ran out of budget — no verdict either way

function buildModel(pz: Puzzle, deal: VocabTileDef[]): Model {
  const payload = pz.payload as VocabMatchPayload;
  const room = pz.room!;
  const w = room.width - 2;
  const h = room.height - 2;
  const cell = (x: number, y: number) => y * w + x;
  const blocked = new Uint8Array(w * h);
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (room.tiles[y][x] === "#") blocked[cell(x - 1, y - 1)] = 1;
    }
  }
  for (const p of payload.props ?? []) blocked[cell(p.pos.x, p.pos.y)] = 1;

  const index = new Map(deal.map((t, i) => [t.id, i]));
  const partner = new Int32Array(deal.length).fill(-1);
  for (const [a, b] of payload.pairs) {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia === undefined || ib === undefined) continue; // a pair naming a tile that isn't dealt
    partner[ia] = ib;
    partner[ib] = ia;
  }
  return {
    w, h, blocked, partner,
    tiles: deal.length,
    start: {
      player: cell(room.spawn!.x - 1, room.spawn!.y - 1),
      pos: Int32Array.from(deal.map((t) => cell(t.pos.x, t.pos.y))),
      locked: new Uint8Array(deal.length),
    },
  };
}

/** Step one cell, or -1 off the board (columns wrap in a flat array — check x explicitly). */
function stepCell(m: Model, c: number, dx: number, dy: number): number {
  const x = (c % m.w) + dx;
  const y = Math.floor(c / m.w) + dy;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return -1;
  return y * m.w + x;
}

function tileAt(s: SolveState, c: number): number {
  for (let i = 0; i < s.pos.length; i++) if (s.pos[i] === c) return i;
  return -1;
}

/**
 * One press, made from cell `from`. Mirrors ruleEngine.tryMove for this rule set (tile =
 * push, locked/wall/sign = stop, the whole train moves or nothing does) plus the module's
 * locking pass. Null = blocked, nothing changed.
 */
function press(m: Model, s: SolveState, from: number, dx: number, dy: number): SolveState | null {
  const train: number[] = [];
  let c = from;
  for (;;) {
    const n = stepCell(m, c, dx, dy);
    if (n < 0 || m.blocked[n]) return null;
    const ti = tileAt(s, n);
    if (ti >= 0) {
      if (s.locked[ti]) return null; // a matched pair is furniture now
      train.push(ti);
      c = n;
      continue;
    }
    break;
  }
  const next: SolveState = {
    player: stepCell(m, from, dx, dy),
    pos: Int32Array.from(s.pos),
    locked: Uint8Array.from(s.locked),
  };
  for (const ti of train) next.pos[ti] = stepCell(m, next.pos[ti], dx, dy);
  for (const ti of train) {
    const pj = m.partner[ti];
    if (pj < 0 || next.locked[ti] || next.locked[pj]) continue;
    const a = next.pos[ti];
    const b = next.pos[pj];
    const adjacent =
      (Math.abs((a % m.w) - (b % m.w)) === 1 && Math.floor(a / m.w) === Math.floor(b / m.w)) ||
      ((a % m.w) === (b % m.w) && Math.abs(Math.floor(a / m.w) - Math.floor(b / m.w)) === 1);
    if (adjacent) { next.locked[ti] = 1; next.locked[pj] = 1; }
  }
  return next;
}

/** Where the player can walk without pushing anything: which cells, the breadcrumbs to
 *  rebuild a walk, and the region's identity (its lowest cell) for dedup. Walks are only
 *  reconstructed for the handful of cells a push actually uses (see walkTo). */
interface Reach {
  /** -2 = unreachable, else the cell walked from (-1 for the start). */
  from: Int32Array;
  dir: Int8Array;
  region: number;
}
function reachable(m: Model, s: SolveState): Reach {
  const size = m.w * m.h;
  const from = new Int32Array(size).fill(-2);
  const dir = new Int8Array(size);
  const occupied = new Uint8Array(size);
  for (let i = 0; i < s.pos.length; i++) occupied[s.pos[i]] = 1;
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  queue[tail++] = s.player;
  from[s.player] = -1;
  let region = s.player;
  while (head < tail) {
    const c = queue[head++];
    for (let d = 0; d < 4; d++) {
      const n = stepCell(m, c, DIRS[d][1], DIRS[d][2]);
      if (n < 0 || from[n] !== -2 || m.blocked[n] || occupied[n]) continue;
      from[n] = c;
      dir[n] = d;
      if (n < region) region = n;
      queue[tail++] = n;
    }
  }
  return { from, dir, region };
}

/** The walk from where the player stands to `cell` (which must be in the region). */
function walkTo(reach: Reach, cell: number): Dir[] {
  const out: Dir[] = [];
  for (let c = cell; reach.from[c] >= 0; c = reach.from[c]) out.push(DIRS[reach.dir[c]][0]);
  return out.reverse();
}

/** What makes two positions THE SAME to the search: where every tile is (and whether it
 *  is locked), plus which region the player is in — not the cell they stand on. */
function stateKey(s: SolveState, reach: Reach): string {
  let key = `${reach.region}`;
  for (let i = 0; i < s.pos.length; i++) key += `|${s.pos[i]}${s.locked[i] ? "L" : ""}`;
  return key;
}

interface Node { state: SolveState; reach: Reach; parent: Node | null; seg: Dir[] }
const flatten = (n: Node): Dir[] => {
  const out: Dir[] = [];
  for (let cur: Node | null = n; cur; cur = cur.parent) out.unshift(...cur.seg);
  return out;
};

/** BFS over PUSHES until tile `goal` and its partner lock together. `movers` limits
 *  which tiles may be shoved. */
function lockPair(m: Model, from: SolveState, goal: number, movers: Set<number>, budget: number): SolveResult {
  const partner = m.partner[goal];
  if (partner < 0) return { kind: "unsolvable" };
  const startReach = reachable(m, from);
  const seen = new Set([stateKey(from, startReach)]);
  let frontier: Node[] = [{ state: from, reach: startReach, parent: null, seg: [] }];
  let nodes = 0;
  while (frontier.length) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (++nodes > budget) return { kind: "exhausted" };
      // The only choices that change anything are PUSHES: pick a tile, pick a side, and
      // check the player can reach the cell behind it. Everything else is walking.
      for (const ti of movers) {
        if (node.state.locked[ti]) continue;
        for (let d = 0; d < 4; d++) {
          const [name, dx, dy] = DIRS[d];
          const stand = stepCell(m, node.state.pos[ti], -dx, -dy);
          if (stand < 0 || node.reach.from[stand] === -2) continue;
          const s = press(m, node.state, stand, dx, dy);
          if (!s) continue;
          const reach = reachable(m, s);
          const key = stateKey(s, reach);
          if (seen.has(key)) continue;
          seen.add(key);
          const child: Node = { state: s, reach, parent: node, seg: [...walkTo(node.reach, stand), name] };
          if (s.locked[goal] && s.locked[partner]) return { kind: "solved", moves: flatten(child) };
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return { kind: "unsolvable" };
}

/** Try the pair on its own first, then with every tile in play. */
function lockPairAnyhow(m: Model, s: SolveState, goal: number): SolveResult {
  const partner = m.partner[goal];
  const narrow = lockPair(m, s, goal, new Set([goal, partner]), PAIR_BUDGET);
  if (narrow.kind === "solved") return narrow;
  const all = new Set<number>();
  for (let i = 0; i < m.tiles; i++) all.add(i);
  const wide = lockPair(m, s, goal, all, FULL_BUDGET);
  // "unsolvable" only stands if the WIDER search also closed out on its own budget.
  if (wide.kind === "unsolvable" && narrow.kind === "exhausted") return { kind: "exhausted" };
  return wide;
}

const allLocked = (m: Model, s: SolveState) => {
  for (let i = 0; i < m.tiles; i++) if (m.partner[i] >= 0 && !s.locked[i]) return false;
  return true;
};

/** Replay a leg's moves to get its end position (the search returns moves, not states). */
function replay(m: Model, s: SolveState, moves: Dir[]): SolveState {
  let cur = s;
  for (const name of moves) {
    const d = DIRS.find(([n]) => n === name)!;
    cur = press(m, cur, cur.player, d[1], d[2]) ?? cur;
  }
  return cur;
}

/** Lock every pair, trying each remaining pair as the next leg. */
function plan(m: Model, s: SolveState, seen: Set<string>): SolveResult {
  if (allLocked(m, s)) return { kind: "solved", moves: [] };
  const key = stateKey(s, reachable(m, s));
  if (seen.has(key)) return { kind: "unsolvable" };
  seen.add(key);
  let exhausted = false;
  // One leg per PAIR, not per tile: the lower index of each pair represents it.
  const open: number[] = [];
  for (let i = 0; i < m.tiles; i++) if (m.partner[i] > i && !s.locked[i]) open.push(i);
  // Nearest pair first — it is usually the cheapest leg, and a cheap leg disturbs least.
  const dist = (i: number) => {
    const a = s.pos[i];
    const b = s.pos[m.partner[i]];
    return Math.abs((a % m.w) - (b % m.w)) + Math.abs(Math.floor(a / m.w) - Math.floor(b / m.w));
  };
  open.sort((a, b) => dist(a) - dist(b));
  for (const goal of open) {
    const leg = lockPairAnyhow(m, s, goal);
    if (leg.kind === "exhausted") { exhausted = true; continue; }
    if (leg.kind === "unsolvable") continue;
    const rest = plan(m, replay(m, s, leg.moves), seen);
    if (rest.kind === "solved") return { kind: "solved", moves: [...leg.moves, ...rest.moves] };
    if (rest.kind === "exhausted") exhausted = true;
  }
  return exhausted ? { kind: "exhausted" } : { kind: "unsolvable" };
}

/** Can this deal be finished? "solved" carries a route that really wins. */
export function solveVocab(pz: Puzzle, deal: VocabTileDef[]): SolveResult {
  const m = buildModel(pz, deal);
  if (allLocked(m, m.start)) return { kind: "solved", moves: [] };
  return plan(m, m.start, new Set());
}
