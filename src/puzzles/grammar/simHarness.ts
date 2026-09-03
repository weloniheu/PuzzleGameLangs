// ---------------------------------------------------------------------------
// GRAMMAR board SIM + SOLVER — the module's move loop without the DOM, and a search
// that answers "can this arrangement be finished at all?". Test support only
// (nothing in the game imports it), shared by the two suites that need it:
//
//   • packPlaythrough.test.ts — replays the AUTHORED route for each level;
//   • levelCompletion.test.ts — solves every level, including the `randomized`
//     DEALS that no authored route could ever speak for.
//
// playGrammar drives the SAME pure pieces the real module does (ruleEngine.tryMove
// for the push, grammarBoard for the frame, grammarCheck for the win), so a route
// that wins here wins in the room. The solver plans on a faster model and then has
// playGrammar confirm it — see puzzles/vocab/simHarness.ts, which does the same for
// the matching game and explains the shape of the search in full.
// ---------------------------------------------------------------------------

import type { GrammarBuildPayload, Puzzle, GrammarWordDef } from "../../schema/types";
import { tryMove, DIRECTIONS, type Direction } from "../logic/ruleEngine";
import { checkSentence } from "./grammarCheck";
import { buildGrammarBoard, filledSlots, slotCell, wallCells, PUSH_RULES } from "./grammarBoard";
import { mulberry32, shufflePositions } from "../../engine/core/shuffle";

export type Dir = "U" | "D" | "L" | "R";
const D: Record<Dir, Direction> = {
  U: DIRECTIONS.up, D: DIRECTIONS.down, L: DIRECTIONS.left, R: DIRECTIONS.right,
};
/** Floor origin (1,1) — every grammar room is a wall-ringed rectangle. */
const OX = 1, OY = 1;

/** The deal a `randomized` level would produce for `seed`: the module's own permutation
 *  (engine/core/shuffle) over the level's own authored cells. */
export function dealFor(pz: Puzzle, seed: number): GrammarWordDef[] {
  const words = (pz.payload as GrammarBuildPayload).words;
  if (!pz.modifiers?.includes("randomized")) return words;
  return shufflePositions(words, mulberry32(seed));
}

/** Play `moves`; true if the frame ever holds a valid sentence (the module auto-wins
 *  the moment it does). `words` overrides the authored placement — that is a deal. */
export function playGrammar(pz: Puzzle, moves: Dir[], words?: GrammarWordDef[]): boolean {
  const payload = { ...(pz.payload as GrammarBuildPayload), words: words ?? (pz.payload as GrammarBuildPayload).words };
  const room = pz.room!;
  const floorW = room.width - OX * 2;
  const floorH = room.height - OY * 2;
  const gb = buildGrammarBoard(
    payload, floorW, floorH,
    { x: room.spawn!.x - OX, y: room.spawn!.y - OY },
    // Interior '#' cells are SOLID here exactly as they are in the module.
    wallCells(floorW, floorH, (rx, ry) => room.tiles[ry][rx] === "#", OX, OY),
  );
  const player = () => gb.board.entities.find((e) => e.id === "player")!;
  const solved = () => checkSentence(filledSlots(gb, payload), payload.structures).valid;
  for (const m of moves) {
    tryMove(gb.board, player(), D[m], PUSH_RULES);
    if (solved()) return true;
  }
  return solved();
}

// --- the solver --------------------------------------------------------------

const DIRS: [Dir, number, number][] = [["U", 0, -1], ["D", 0, 1], ["L", -1, 0], ["R", 1, 0]];
const LEG_BUDGET = 6_000;      // positions expanded while pushing ONE word into ONE slot
const TOTAL_BUDGET = 60_000;   // …across a whole frame, so backtracking can't run away
const DIRECT_BUDGET = 30_000;  // …and for the last-resort straight-to-valid search

export type SolveResult =
  | { kind: "solved"; moves: Dir[] }
  | { kind: "unsolvable" }
  | { kind: "exhausted" };

interface Model {
  w: number;
  h: number;
  blocked: Uint8Array;
  /** Word index → its role, as an index into `roles`. */
  role: Int32Array;
  /** Frame slot cells, left→right. */
  slots: Int32Array;
  /** The role each slot wants, as an index into `roles` (-1 = a role no word has). */
  want: Int32Array;
  start: State;
}
interface State { player: number; pos: Int32Array }

const stepCell = (m: Model, c: number, dx: number, dy: number): number => {
  const x = (c % m.w) + dx;
  const y = Math.floor(c / m.w) + dy;
  return x < 0 || y < 0 || x >= m.w || y >= m.h ? -1 : y * m.w + x;
};
const wordAt = (s: State, c: number): number => {
  for (let i = 0; i < s.pos.length; i++) if (s.pos[i] === c) return i;
  return -1;
};

/** One press from `from`. Mirrors ruleEngine.tryMove for PUSH_RULES: word tiles push in
 *  a train, walls stop, nothing locks. Null = blocked. */
function press(m: Model, s: State, from: number, dx: number, dy: number): State | null {
  const train: number[] = [];
  let c = from;
  for (;;) {
    const n = stepCell(m, c, dx, dy);
    if (n < 0 || m.blocked[n]) return null;
    const wi = wordAt(s, n);
    if (wi >= 0) { train.push(wi); c = n; continue; }
    break;
  }
  const next: State = { player: stepCell(m, from, dx, dy), pos: Int32Array.from(s.pos) };
  for (const wi of train) next.pos[wi] = stepCell(m, next.pos[wi], dx, dy);
  return next;
}

interface Reach { from: Int32Array; dir: Int8Array; region: number }
function reachable(m: Model, s: State): Reach {
  const size = m.w * m.h;
  const from = new Int32Array(size).fill(-2);
  const dir = new Int8Array(size);
  const occupied = new Uint8Array(size);
  for (let i = 0; i < s.pos.length; i++) occupied[s.pos[i]] = 1;
  const queue = new Int32Array(size);
  let head = 0, tail = 0;
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
function walkTo(reach: Reach, cell: number): Dir[] {
  const out: Dir[] = [];
  for (let c = cell; reach.from[c] >= 0; c = reach.from[c]) out.push(DIRS[reach.dir[c]][0]);
  return out.reverse();
}
function stateKey(s: State, reach: Reach): string {
  let key = `${reach.region}`;
  for (let i = 0; i < s.pos.length; i++) key += `|${s.pos[i]}`;
  return key;
}

interface Node { state: State; reach: Reach; parent: Node | null; seg: Dir[] }
const flatten = (n: Node): Dir[] => {
  const out: Dir[] = [];
  for (let cur: Node | null = n; cur; cur = cur.parent) out.unshift(...cur.seg);
  return out;
};

/** BFS over PUSHES until `goal` holds. */
function search(
  m: Model, from: State, goal: (s: State) => boolean, budget: number, movers?: Set<number>,
): SolveResult {
  const startReach = reachable(m, from);
  const seen = new Set([stateKey(from, startReach)]);
  let frontier: Node[] = [{ state: from, reach: startReach, parent: null, seg: [] }];
  let nodes = 0;
  while (frontier.length) {
    const next: Node[] = [];
    for (const node of frontier) {
      if (++nodes > budget) return { kind: "exhausted" };
      for (let wi = 0; wi < node.state.pos.length; wi++) {
        if (movers && !movers.has(wi)) continue; // only shove the word this leg is about
        for (let d = 0; d < 4; d++) {
          const [name, dx, dy] = DIRS[d];
          const stand = stepCell(m, node.state.pos[wi], -dx, -dy);
          if (stand < 0 || node.reach.from[stand] === -2) continue;
          const s = press(m, node.state, stand, dx, dy);
          if (!s) continue;
          const reach = reachable(m, s);
          const key = stateKey(s, reach);
          if (seen.has(key)) continue;
          seen.add(key);
          const child: Node = { state: s, reach, parent: node, seg: [...walkTo(node.reach, stand), name] };
          if (goal(s)) return { kind: "solved", moves: flatten(child) };
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return { kind: "unsolvable" };
}

function buildModel(pz: Puzzle, deal: GrammarWordDef[], structure: readonly string[]): Model {
  const payload = pz.payload as GrammarBuildPayload;
  const room = pz.room!;
  const w = room.width - OX * 2;
  const h = room.height - OY * 2;
  const cell = (x: number, y: number) => y * w + x;
  const blocked = new Uint8Array(w * h);
  for (const c of wallCells(w, h, (rx, ry) => room.tiles[ry][rx] === "#", OX, OY)) {
    blocked[cell(c.x, c.y)] = 1;
  }
  const roles = [...new Set([...deal.map((word) => word.role), ...structure])];
  return {
    w, h, blocked,
    role: Int32Array.from(deal.map((word) => roles.indexOf(word.role))),
    slots: Int32Array.from(payload.structure.map((_, i) => {
      const c = slotCell(payload, i);
      return cell(c.x, c.y);
    })),
    want: Int32Array.from(structure.map((r) => roles.indexOf(r))),
    start: {
      player: cell(room.spawn!.x - OX, room.spawn!.y - OY),
      pos: Int32Array.from(deal.map((word) => cell(word.pos.x, word.pos.y))),
    },
  };
}

/** Is every slot up to and including `upTo` holding a word of the role it wants? */
function satisfied(m: Model, s: State, upTo: number): boolean {
  for (let i = 0; i <= upTo; i++) {
    const wi = wordAt(s, m.slots[i]);
    if (wi < 0 || m.role[wi] !== m.want[i]) return false;
  }
  return true;
}

/**
 * Fill the frame slot by slot, one WORD per leg — the way the levels are built to be
 * played (walk behind a word, shove it into its box) and the reason the search stays
 * small: a leg only ever shoves the word it is about, so the branching is 4, not 4 per
 * word on the board. Backtracks over WHICH word fills a slot (several may share a role)
 * and never accepts a leg that knocks an already-filled slot back out.
 */
function fillFrom(m: Model, s: State, slot: number, used: Set<number>, budget: { left: number }): SolveResult {
  if (slot >= m.slots.length) return { kind: "solved", moves: [] };
  let exhausted = false;
  for (let wi = 0; wi < m.role.length; wi++) {
    if (used.has(wi) || m.role[wi] !== m.want[slot]) continue;
    if (budget.left <= 0) return { kind: "exhausted" };
    const leg = search(
      m, s,
      (next) => next.pos[wi] === m.slots[slot] && satisfied(m, next, slot - 1),
      Math.min(LEG_BUDGET, budget.left),
      new Set([wi]),
    );
    if (leg.kind === "exhausted") { exhausted = true; budget.left -= LEG_BUDGET; continue; }
    if (leg.kind === "unsolvable") continue;
    budget.left -= leg.moves.length;
    const next = replay(m, s, leg.moves);
    const rest = fillFrom(m, next, slot + 1, new Set([...used, wi]), budget);
    if (rest.kind === "solved") return { kind: "solved", moves: [...leg.moves, ...rest.moves] };
    if (rest.kind === "exhausted") exhausted = true;
  }
  return exhausted ? { kind: "exhausted" } : { kind: "unsolvable" };
}

function solveStructure(m: Model): SolveResult {
  const perSlot = fillFrom(m, m.start, 0, new Set(), { left: TOTAL_BUDGET });
  if (perSlot.kind === "solved") return perSlot;
  // Last resort: one wider search straight at a finished sentence, in case the frame
  // genuinely has to be filled out of order (a word riding in on another's train).
  const direct = search(m, m.start, (s) => satisfied(m, s, m.slots.length - 1), DIRECT_BUDGET);
  if (direct.kind === "solved") return direct;
  return direct.kind === "exhausted" || perSlot.kind === "exhausted"
    ? { kind: "exhausted" }
    : { kind: "unsolvable" };
}

function replay(m: Model, s: State, moves: Dir[]): State {
  let cur = s;
  for (const name of moves) {
    const d = DIRS.find(([n]) => n === name)!;
    cur = press(m, cur, cur.player, d[1], d[2]) ?? cur;
  }
  return cur;
}

/** Can this deal be finished? Any ACCEPTED role order counts — a pack may declare more
 *  than one (flexible word order), and filling the frame with any of them wins. */
export function solveGrammar(pz: Puzzle, deal: GrammarWordDef[]): SolveResult {
  const payload = pz.payload as GrammarBuildPayload;
  let exhausted = false;
  for (const structure of payload.structures) {
    if (structure.length !== payload.structure.length) continue; // a frame of another size
    const result = solveStructure(buildModel(pz, deal, structure));
    if (result.kind === "solved") return result;
    if (result.kind === "exhausted") exhausted = true;
  }
  return exhausted ? { kind: "exhausted" } : { kind: "unsolvable" };
}
