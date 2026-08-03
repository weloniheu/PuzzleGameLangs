// Push-format solver for the two board games (grammar frame-fill, vocab pair-match).
// Mirrors the modules' rules: tryMove's train push, interior '#' walls and props STOP.
//
// A full joint BFS blows up past ~4 movable tiles, so both solvers DECOMPOSE: they fix
// an order of sub-goals (which word fills which slot / which pair joins first) and solve
// each stage with only that stage's tiles movable, every other tile treated as solid.
// That never pushes a tile it isn't tracking, so the result is a REAL, replayable move
// sequence and a sound UPPER BOUND on the optimum — exactly what `par` and a playthrough
// test script need. Reported as "bound", not "optimal".
import fs from "fs";

const DIRS = [["U", 0, -1], ["D", 0, 1], ["L", -1, 0], ["R", 1, 0]];

/** BFS one stage: move `movers` (indices into `tiles`) until `goal` holds.
 *  `blocked(moverIdx, aheadCell)` — optional: reject a move that leaves a mover FACE-FIRST
 *  against that cell. A pushed tile stops one short of an obstacle rather than entering it,
 *  and vocab prices exactly that as a tested (wrong) combination, so the path has to avoid
 *  it to stay a ★★★ line. */
function stage(W, H, solid, player, tiles, movers, goal, blocked = null, cap = 400_000) {
  const wall = new Set(solid.map((c) => `${c.x},${c.y}`));
  // Tiles that are NOT this stage's movers are immovable scenery.
  tiles.forEach((t, i) => { if (!movers.includes(i)) wall.add(`${t.x},${t.y}`); });
  const key = (p, m) => `${p.x},${p.y}|${m.join(";")}`;

  const s0 = { p: player, m: movers.map((i) => `${tiles[i].x},${tiles[i].y}`), path: "" };
  const pos = (s) => s.m.map((c) => c.split(",").map(Number));
  if (goal(pos(s0))) return s0;
  let frontier = [s0];
  const seen = new Set([key(s0.p, s0.m)]);

  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      const cells = pos(s);
      for (const [name, dx, dy] of DIRS) {
        const nx = s.p.x + dx, ny = s.p.y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || wall.has(`${nx},${ny}`)) continue;
        const at = new Map(cells.map((c, i) => [`${c[0]},${c[1]}`, i]));
        const train = [];
        let cx = nx, cy = ny;
        while (at.has(`${cx},${cy}`)) { train.push(at.get(`${cx},${cy}`)); cx += dx; cy += dy; }
        if (train.length && (cx < 0 || cy < 0 || cx >= W || cy >= H || wall.has(`${cx},${cy}`))) continue;
        const m = cells.map((c) => c.slice());
        for (const i of train) { m[i][0] += dx; m[i][1] += dy; }
        if (blocked && train.some((i) => blocked(movers[i], { x: m[i][0] + dx, y: m[i][1] + dy }))) continue;
        const ns = { p: { x: nx, y: ny }, m: m.map((c) => `${c[0]},${c[1]}`), path: s.path + name };
        if (goal(m)) return ns;
        const k = key(ns.p, ns.m);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > cap) return null;
        next.push(ns);
      }
    }
    frontier = next;
  }
  return null;
}

/** Run stages back to back, threading player position + tile positions through. */
function runStages(W, H, solid, spawn, tiles, plan, blockedFor = null) {
  let player = spawn;
  let live = tiles.map((t) => ({ ...t }));
  let path = "";
  for (const { movers, goal } of plan) {
    const res = stage(W, H, solid, player, live, movers, goal, blockedFor?.(live));
    if (!res) return null;
    player = res.p;
    res.m.forEach((c, k) => {
      const [x, y] = c.split(",").map(Number);
      live[movers[k]] = { x, y };
    });
    path += res.path;
  }
  return { moves: path.length, path, tiles: live };
}

const permutations = (a) =>
  a.length <= 1 ? [a] : a.flatMap((x, i) =>
    permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));

const roomWalls = (room, W, H, ox = 1, oy = 1) => {
  const cells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (room.tiles[y + oy][x + ox] === "#") cells.push({ x, y });
  }
  return cells;
};

/** Grammar: choose which word fills each slot, then deliver them one slot at a time. */
export function solveGrammar(puzzle) {
  const room = puzzle.room, pl = puzzle.payload;
  const W = room.width - 2, H = room.height - 2;
  const solid = roomWalls(room, W, H);
  const spawn = { x: room.spawn.x - 1, y: room.spawn.y - 1 };
  const tiles = pl.words.map((w) => ({ x: w.pos.x, y: w.pos.y }));
  const slots = pl.structure.map((_, i) => ({ x: pl.frame.x + i, y: pl.frame.y }));

  let best = null;
  for (const struct of pl.structures) {
    // Candidate words per slot, by role.
    const cands = struct.map((role) => pl.words.map((w, i) => [w, i]).filter(([w]) => w.role === role).map(([, i]) => i));
    const assign = (k, used, acc) => {
      if (k === slots.length) return [acc.slice()];
      const out = [];
      for (const i of cands[k]) {
        if (used.has(i)) continue;
        used.add(i); acc.push(i);
        out.push(...assign(k + 1, used, acc));
        acc.pop(); used.delete(i);
      }
      return out;
    };
    for (const words of assign(0, new Set(), [])) {
      // Deliver in every slot order — filling the near slot first can wall off the far one.
      for (const order of permutations(words.map((_, i) => i))) {
        const plan = order.map((si) => ({
          movers: [words[si]],
          goal: (m) => m[0][0] === slots[si].x && m[0][1] === slots[si].y,
        }));
        const r = runStages(W, H, solid, spawn, tiles, plan);
        if (r && (!best || r.moves < best.moves)) best = r;
      }
    }
  }
  return best ?? { moves: null, path: null };
}

/** Vocab: join one pair at a time; try every pair order. */
export function solveVocab(puzzle) {
  const room = puzzle.room, pl = puzzle.payload;
  const W = room.width - 2, H = room.height - 2;
  const solid = roomWalls(room, W, H).concat((pl.props ?? []).map((p) => ({ x: p.pos.x, y: p.pos.y })));
  const spawn = { x: room.spawn.x - 1, y: room.spawn.y - 1 };
  const tiles = pl.tiles.map((t) => ({ x: t.pos.x, y: t.pos.y }));
  const idx = Object.fromEntries(pl.tiles.map((t, i) => [t.id, i]));

  const isPair = (a, b) => pl.pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  const props = pl.props ?? [];
  // Reject any move that parks a pushed tile face-first against a non-partner tile or a
  // sign that does not accept it — both are PRICED as a tested combination in play, and a
  // ★★★ line has to test none. (Already-matched tiles are exempt: they read as scenery.)
  const blockedFor = (live) => (moverIdx, ahead) => {
    const t = live.findIndex((c, i) => c.x === ahead.x && c.y === ahead.y && i !== moverIdx);
    if (t !== -1 && !isPair(pl.tiles[moverIdx].id, pl.tiles[t].id)) return true;
    const sign = props.find((q) => q.pos.x === ahead.x && q.pos.y === ahead.y);
    return !!sign && sign.accepts !== pl.tiles[moverIdx].id;
  };

  let best = null;
  for (const order of permutations(pl.pairs.map((_, i) => i))) {
    const plan = order.map((pi) => {
      const [a, b] = pl.pairs[pi];
      return {
        movers: [idx[a], idx[b]],
        goal: (m) => Math.abs(m[0][0] - m[1][0]) + Math.abs(m[0][1] - m[1][1]) === 1,
      };
    });
    const r = runStages(W, H, solid, spawn, tiles, plan, blockedFor);
    if (r && (!best || r.moves < best.moves)) best = r;
  }
  return best ?? { moves: null, path: null };
}

export const loadPack = (rel) => JSON.parse(fs.readFileSync(rel, "utf8"));
/** House rule for ★★★: the solved route plus ~15% slack, rounded up. */
export const parFor = (bound) => Math.ceil(bound * 1.15);
