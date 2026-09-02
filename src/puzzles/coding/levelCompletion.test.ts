// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AUTO-SOLVER — the completability stress test.
//
// packPlaythrough.test.ts proves each level's ANSWER is consistent with its data
// (pure, no DOM). This proves the stronger thing: that a player can actually FINISH
// every authored level with the room they are given — by playing it. Each level is
// mounted through the real room host and driven with real key events:
//
//   fetch a token (walk to its pile — or fight the monster carrying it) →
//   walk it into the coding area and place it → repeat → Build → Run → solved.
//
// Nothing here is hand-authored per level: the route is pathfound from the level's own
// tiles, and the token list comes from its own solution. So a level that grows an extra
// line, moves a pile behind a wall, or drops a token nobody carries fails HERE — where
// the message is "no route" or "no source", not a player stuck in a room.
//
// It is deliberately dumb about efficiency (one token per trip): the question is
// "can this be finished at all", not "how fast".
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack, Puzzle, CodeBuildSolution, MonsterDef } from "../../schema/types";
import { mountRoom, type RoomHandle } from "../../engine/roomHost";
import { parseRoom, isWalkable, MOVE, type Cell, type Room } from "../../engine/core/room";
import { normalizeContent, requiresPunctuation, type AnswerLine } from "./codeGameLogic";

const ROOT = join(__dirname, "..", "..", "..");
const pack: Pack = JSON.parse(readFileSync(join(ROOT, "content/packs/python.code.v1.json"), "utf8"));
const codeLevels = (pack.puzzles as Puzzle[]).filter((p) => p.puzzle_type === "code_build" && p.room);

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

const KEY: Record<string, string> = {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};

let c: HTMLElement;
let handle: RoomHandle | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = "";
  c = document.createElement("div");
  document.body.appendChild(c);
});

afterEach(() => {
  handle?.teardown();
  handle = null;
  vi.useRealTimers();
});

// --- reading the live room back out of the DOM -------------------------------
// The solver never trusts its own bookkeeping: every step re-reads where things
// actually are, so a blocked move or a wandering monster can't desync it.

const press = (key: string, times = 1) => {
  const viewport = c.querySelector(".room-viewport") as HTMLElement;
  for (let i = 0; i < times; i++) {
    viewport.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};

/** Live tile px, read off any painted tile (everything positions in multiples of it). */
function tilePx(): number {
  const el = c.querySelector<HTMLElement>(".room-tile-layer .tile-room")!;
  return parseFloat(el.style.width);
}

/** The cell an absolutely-positioned room element sits on. Translates are `x*tile` (+ a
 *  sub-tile inset for the slime), so flooring recovers the cell for every one of them. */
function cellOf(el: HTMLElement): Cell {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`element has no translate: ${el.className}`);
  const tile = tilePx();
  return { x: Math.floor(parseFloat(m[1]) / tile), y: Math.floor(parseFloat(m[2]) / tile) };
}

const playerCell = () => cellOf(c.querySelector<HTMLElement>(".slime")!);

interface LiveMonster { cell: Cell; name: string }
/** Every ACTIVE monster right now (a telegraph is a warning, not a body). */
function liveMonsters(): LiveMonster[] {
  return [...c.querySelectorAll<HTMLElement>(".tile-monster.active")]
    .filter((el) => !el.hidden)
    .map((el) => ({ cell: cellOf(el), name: el.querySelector(".tile-monster-label")!.textContent ?? "" }));
}

/** Loose tokens on the floor (monster loot included), by cell. */
function droppedTokens(): { cell: Cell; token: string }[] {
  return [...c.querySelectorAll<HTMLElement>(".room-dropped")]
    .map((el) => ({ cell: cellOf(el), token: el.querySelector(".room-dropped-label")!.textContent ?? "" }));
}

/** What each inventory slot holds, by slot index ("" = empty). The slot's own text node
 *  is the token; the hotbar digit is a child span appended after it. */
const heldTokens = (): string[] =>
  [...c.querySelectorAll<HTMLElement>(".room-inventory-slot")]
    .map((s) => (s.firstChild?.nodeType === 3 ? s.firstChild.textContent ?? "" : ""));

const placedCount = () => c.querySelectorAll(".tile-placed").length;
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

// --- walking ------------------------------------------------------------------

/** BFS over the room's own walkable tiles: the FIRST step from `from` toward `to`,
 *  routing around `avoid` (active monsters) when it can. Null when there is no route. */
function firstStep(room: Room, from: Cell, to: Cell, avoid: Cell[]): Cell | null {
  const blocked = new Set(avoid.map((m) => `${m.x},${m.y}`));
  const seen = new Set([`${from.x},${from.y}`]);
  // Each frontier entry remembers the first step that led to it.
  let frontier: { cell: Cell; first: Cell | null }[] = [{ cell: from, first: null }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const dir of Object.values(MOVE)) {
        const cell = { x: node.cell.x + dir.dx, y: node.cell.y + dir.dy };
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key) || !isWalkable(room, cell.x, cell.y)) continue;
        // The destination is always enterable — a monster standing ON it is the thing
        // we came to fight, not a reason to declare the level unfinishable.
        if (blocked.has(key) && !same(cell, to)) continue;
        seen.add(key);
        const first = node.first ?? cell;
        if (same(cell, to)) return first;
        next.push({ cell, first });
      }
    }
    frontier = next;
  }
  return null;
}

const dirKeyTo = (from: Cell, to: Cell): string =>
  KEY[Object.keys(MOVE).find((k) => MOVE[k].dx === to.x - from.x && MOVE[k].dy === to.y - from.y)!];

/**
 * Walk to `target`, re-pathing after every single step. A step that doesn't land means
 * something solid is there: the slime is now FACING it (the engine turns even on a
 * bump), so a swing clears the way. Anything still standing after that is terrain, and
 * the level genuinely has no route — which is exactly what this test exists to catch.
 */
function goTo(room: Room, target: Cell, what: string) {
  for (let guard = 0; guard < 600; guard++) {
    const at = playerCell();
    if (same(at, target)) return;
    const avoid = liveMonsters().map((m) => m.cell);
    const step = firstStep(room, at, target, avoid) ?? firstStep(room, at, target, []);
    if (!step) throw new Error(`no route from (${at.x},${at.y}) to ${what} (${target.x},${target.y})`);
    const key = dirKeyTo(at, step);
    press(key);
    if (same(playerCell(), at)) {
      // Blocked by a body, and the bump already turned us to face it: cut it down. A
      // tough carrier (♥♥) takes more than one swing, so keep swinging while it stands.
      for (let swing = 0; swing < 8 && liveMonsters().some((m) => same(m.cell, step)); swing++) {
        press("f");
      }
      press(key);
      if (same(playerCell(), at)) {
        throw new Error(`blocked walking to ${what}: (${at.x},${at.y}) → (${step.x},${step.y})`);
      }
    }
  }
  throw new Error(`gave up walking to ${what}`);
}

/** Stand beside `cell`, face it, and swing until whatever is there is gone. */
function killMonsterAt(room: Room, cell: Cell) {
  const beside = Object.values(MOVE)
    .map((d) => ({ x: cell.x + d.dx, y: cell.y + d.dy }))
    .filter((n) => isWalkable(room, n.x, n.y));
  if (!beside.length) throw new Error(`monster at (${cell.x},${cell.y}) can't be reached to fight`);
  // Pick whichever flank we can actually get to (a den can wall one side off).
  const at = playerCell();
  beside.sort((a, b) => Math.abs(a.x - at.x) + Math.abs(a.y - at.y) - (Math.abs(b.x - at.x) + Math.abs(b.y - at.y)));
  goTo(room, beside[0], `the flank of the monster at (${cell.x},${cell.y})`);
  press(dirKeyTo(beside[0], cell)); // blocked, but now facing it
  for (let hit = 0; hit < 8 && liveMonsters().some((m) => same(m.cell, cell)); hit++) press("f");
  expect(liveMonsters().some((m) => same(m.cell, cell))).toBe(false);
}

// --- the solve ----------------------------------------------------------------

/** The answer this level is checked against (first accepted variant; `lines` is sugar). */
function answerOf(p: Puzzle): AnswerLine[] {
  const sol = p.solution as CodeBuildSolution;
  const variants = sol.accepted ?? (sol.lines ? [sol.lines] : []);
  expect(variants.length).toBeGreaterThan(0);
  return variants[0];
}

/** Every token the answer needs, paired with the cell it has to end up on: line i sits
 *  on the coding area's row i, its indent counted from the area's left edge. Cells that
 *  already hold a scaffolded (prefilled) token are dropped — those are provided. */
function placements(p: Puzzle, answer: AnswerLine[]): { token: string; cell: Cell }[] {
  const area = p.room!.coding_area!;
  const prefilled = new Set((area.prefilled ?? []).map((t) => `${t.x},${t.y}`));
  const punct = requiresPunctuation(p.mechanics);
  const out: { token: string; cell: Cell }[] = [];
  answer.forEach((line, row) => {
    // The checker reads content the same way it compares it, so the solver places
    // exactly the tokens the checker will look for — no more, no fewer.
    normalizeContent(line.content, punct).forEach((token, i) => {
      const cell = { x: area.x + line.indent + i, y: area.y + row };
      expect(cell.x).toBeLessThan(area.x + area.width);   // the line has to FIT the room
      expect(cell.y).toBeLessThan(area.y + area.height);
      if (!prefilled.has(`${cell.x},${cell.y}`)) out.push({ token, cell });
    });
  });
  return out;
}

/** How long until every monster in this room has materialized: the LAST slot's staggered
 *  opening fuse (core/monsters.ts createSlots) plus the telegraph it then sits through,
 *  plus a tick of slack. */
function allSpawnedMs(p: Puzzle): number {
  const cfg = p.room!.monsters!;
  const delay = cfg.spawn_delay_ms ?? 1200;
  return Math.round((delay * cfg.spawns.length) / 2) + delay + 300;
}

/** Wait (advance the room's clock) until one of `carriers` is standing there again,
 *  bounded by a couple of full respawn cycles. Null if none ever shows up. */
function waitForCarrier(p: Puzzle, carriers: MonsterDef[]): LiveMonster | null {
  const cfg = p.room!.monsters!;
  const patience = ((cfg.respawn_ms ?? 8000) + allSpawnedMs(p)) * 2;
  for (let waited = 0; waited <= patience; waited += 400) {
    const found = liveMonsters().find((m) => carriers.some((def) => def.name === m.name));
    if (found) return found;
    vi.advanceTimersByTime(400);
  }
  return null;
}

/**
 * Put one copy of `token` in hand and return the slot it landed in. Sources, in the order
 * a player would use them: already carrying it (walking over loose loot picks it up, so
 * this happens by itself), lying on the floor, a pile, or a monster that has to be fought.
 */
function fetch(room: Room, p: Puzzle, token: string, punct: boolean): number {
  const norm = (t: string) => normalizeContent([t], punct)[0] ?? t;
  const slotOf = () => heldTokens().findIndex((t) => t !== "" && norm(t) === token);

  const held = slotOf();
  if (held >= 0) return held;

  // Loose on the floor (loot from an earlier fight) → walk over it to pick it up.
  const loose = droppedTokens().find((d) => norm(d.token) === token);
  if (loose) {
    goTo(room, loose.cell, `the dropped "${token}"`);
  } else {
    const pile = (p.room!.piles ?? []).find((pl) => norm(pl.token) === token);
    if (pile) {
      goTo(room, pile.pos, `the "${token}" pile`);
      press("i");
    } else {
      // Nothing on the floor: something is carrying it. Monsters wander, so find the one
      // wearing this name RIGHT NOW rather than trusting its authored spawn cell.
      const carriers = (p.room!.monsters?.spawns ?? [])
        .filter((m: MonsterDef) => m.token && norm(m.token) === token);
      if (!carriers.length) throw new Error(`no source for "${token}" — no pile has it, and no monster carries it`);
      // A token the answer needs TWICE is fetched twice: the second trip waits for the
      // carrier to come back (that respawn is what makes a repeated token gettable at
      // all — see MonsterConfig.respawn_ms). Waiting is a real move, so the solver makes
      // it: advance the clock until it is standing there again.
      const carrier = waitForCarrier(p, carriers);
      if (!carrier) throw new Error(`"${token}"'s carrier never came back — the level can't supply it again`);
      killMonsterAt(room, carrier.cell);
      const drop = droppedTokens().find((d) => norm(d.token) === token);
      if (!drop) throw new Error(`killing the carrier of "${token}" dropped nothing`);
      goTo(room, drop.cell, `the "${token}" it dropped`);
    }
  }
  const slot = slotOf();
  if (slot < 0) throw new Error(`fetched "${token}" but it never reached the inventory`);
  return slot;
}

function playLevel(p: Puzzle) {
  const room = parseRoom(p.room!);
  const answer = answerOf(p);
  const punct = requiresPunctuation(p.mechanics);
  let solved = false;

  handle = mountRoom(c, p, { onSolved: () => { solved = true; }, menuLadder: () => null });
  press("Escape"); // one Escape ends the greeting + any teaching, exactly as a player would

  if (p.room!.monsters?.spawns.length) vi.advanceTimersByTime(allSpawnedMs(p));

  for (const { token, cell } of placements(p, answer)) {
    const slot = fetch(room, p, token, punct);
    const before = placedCount();
    goTo(room, cell, `the spot for "${token}" (${cell.x},${cell.y})`);
    press(String(slot + 1)); // the hotbar picks WHICH token place puts down
    press("p");
    expect(placedCount()).toBe(before + 1); // the cell was free and the token went down
  }

  const control = (action: string) => {
    const ctrl = (p.room!.controls ?? []).find((x) => x.action === action);
    if (!ctrl) throw new Error(`level has no "${action}" control`);
    return ctrl.pos;
  };
  goTo(room, control("build"), "Build");
  press("Enter");
  goTo(room, control("run"), "Run");
  press("Enter");

  return solved;
}

describe("every authored coding level can actually be PLAYED to completion", () => {
  for (const p of codeLevels) {
    it(`${p.id} — fetch, place, Build, Run → solved`, () => {
      expect(playLevel(p)).toBe(true);
      expect(c.querySelector(".room-terminal-body")?.classList.contains("term-success")).toBe(true);
    });
  }
});

describe("finishing a level hands the player the next one", () => {
  // The same auto-solve, but mounted the way the MANAGER mounts a level (with a ladder),
  // so the level-complete card is live: clearing the tutorial has to offer Variables.
  it("the tutorial's score card leads with the next rung of the ladder", () => {
    const tutorial = codeLevels[0];
    const levels = (pack.progression ?? []).find((x) => x.puzzle_type === "code_build")!.levels;
    const p = tutorial;
    const room = parseRoom(p.room!);
    handle = mountRoom(c, p, {
      // A stand-in for the real manager's ladder: every level unlocked, current = this one.
      menuLadder: () => ({
        levels: levels.map((lv) => ({ ...lv, language: "python", mechanic: lv.mechanic ?? "base" })),
        lockedLanguages: [],
        unlocks: new Set(levels.map((lv) => lv.unlock).filter((u): u is string => !!u)),
        currentId: p.id,
      }),
    });
    press("Escape");
    for (const { token, cell } of placements(p, answerOf(p))) {
      const slot = fetch(room, p, token, requiresPunctuation(p.mechanics));
      goTo(room, cell, `the spot for "${token}"`);
      press(String(slot + 1));
      press("p");
    }
    goTo(room, (p.room!.controls ?? []).find((x) => x.action === "build")!.pos, "Build");
    press("Enter");
    goTo(room, (p.room!.controls ?? []).find((x) => x.action === "run")!.pos, "Run");
    press("Enter");

    expect((c.querySelector(".room-summary") as HTMLElement).hidden).toBe(false);
    expect(c.querySelector(".room-summary-letter")!.textContent).toMatch(/^[SABCD]$/);
    // The button that moves you on is the level right after this one in the pack's ladder.
    expect(c.querySelector(".room-summary-btn")!.textContent).toBe(`${levels[1].label} →`);
  });
});
