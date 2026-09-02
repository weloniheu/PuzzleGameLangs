// ---------------------------------------------------------------------------
// Monsters — the roaming ALTERNATIVE to a token pile. PURE, DOM-free, tested.
//
// A pile is a token standing still; a monster is a token that runs away from you.
// Content declares WHICH monsters carry WHICH tokens (RoomLayout.monsters); this
// module owns the lifecycle every monster in every room follows:
//
//     down ──(respawn)──▶ telegraph ──(spawn delay)──▶ active ──(hp hits)──▶ down
//
//   telegraph  a marker on a floor cell. Walkable, NOT attackable — a warning only.
//   active     roams a cell at a time, is SOLID, and is the only phase `attack` hits.
//   down       defeated; its token has dropped as loot; the slot is waiting to re-arm.
//
// WHY SLOTS RESPAWN: piles are infinite (tryPickup never consumes one), so no level can
// be stranded by a lost token. Monsters have to inherit that — loot despawns and pits eat
// things — so a defeated slot always comes back. This is load-bearing, not flavor.
//
// TWO behaviors share that same phase machine (MonsterBehavior, default "carrier"):
//   carrier  the ORIGINAL monster — spawns already holding `def.token`, drops it on defeat.
//   thief    spawns EMPTY-HANDED and, once active, HUNTS something the ROOM MODULE offers
//            up (MountedPuzzle.stealTargets — e.g. a placed code token). Reaching one steals
//            it (the object leaves the board — see systems/monsters.ts + takeToken); the
//            thief then carries it for `digest_ms`, still wandering. Kill it in that window
//            and it drops what it took, same as a carrier; let the window run out and the
//            object is DIGESTED (gone — but always re-obtainable from its ORIGINAL source,
//            same load-bearing rule as respawn), and after `steal_cooldown_ms` it hunts again.
//
//     active (thief) ──reaches a target──▶ carrying ──(digest_ms)──▶ digested
//              ▲                              │  killed mid-carry            │
//              └────────(steal_cooldown_ms)───┴───────── drops loot ─────────┘
//
// The engine owns TIMING but not the clock: `advance` is fed elapsed ms by the DOM system
// (engine/systems/monsters.ts), which is what makes the whole lifecycle testable.
// ---------------------------------------------------------------------------

import type { MonsterConfig, MonsterDef } from "../../schema/types";
import { MOVE, isWalkable, type Cell, type Room } from "./room";

/** Engine defaults for every CONTENT-overridable timing (see MonsterConfig). */
export const MONSTER_DEFAULTS = {
  /** telegraph marker → attackable monster */
  spawnDelayMs: 1200,
  /** defeat → the slot's next telegraph */
  respawnMs: 5000,
  /** one wander/chase step */
  moveMs: 700,
  /** how long dropped loot lies on the floor (longer than a Q-drop: loot is earned) */
  lootTtlMs: 20000,
  /** thief only: the rescue window once it starts carrying a stolen object */
  digestMs: 6000,
  /** thief only: after a theft OR a digest, before it starts hunting again */
  stealCooldownMs: 2500,
};

export type MonsterPhase = "down" | "telegraph" | "active";

/** One monster SLOT: an authored monster plus wherever it is in its lifecycle. */
export interface MonsterSlot {
  /** Stable per-room id (the slot's index) — the DOM system keys elements off it. */
  id: number;
  def: MonsterDef;
  phase: MonsterPhase;
  /** Where it (or its telegraph marker) sits. Meaningless while `down`. */
  cell: Cell;
  /** Hits left before defeat. */
  hp: number;
  /** ms until the next phase change (telegraph→active, down→telegraph). */
  phaseLeft: number;
  /** ms until the next wander/chase/steal-retry step (`active` only). */
  moveLeft: number;
  /** THIEF ONLY: the token currently being carried (stolen from the room, not `def.token`
   *  — a thief starts empty-handed). null everywhere else, always, for a carrier. */
  carrying: string | null;
  /** THIEF ONLY: ms left in the rescue window while `carrying`. */
  digestLeft: number;
  /** THIEF ONLY: ms left before it resumes hunting, after a theft or a digest. */
  cooldownLeft: number;
}

/** Resolved timings for a room's monster table. */
export interface MonsterTimings {
  spawnDelayMs: number;
  respawnMs: number;
  moveMs: number;
  lootTtlMs: number;
  digestMs: number;
  stealCooldownMs: number;
}

export function resolveTimings(config: MonsterConfig): MonsterTimings {
  return {
    spawnDelayMs: config.spawn_delay_ms ?? MONSTER_DEFAULTS.spawnDelayMs,
    respawnMs: config.respawn_ms ?? MONSTER_DEFAULTS.respawnMs,
    moveMs: config.move_ms ?? MONSTER_DEFAULTS.moveMs,
    lootTtlMs: config.loot_ttl_ms ?? MONSTER_DEFAULTS.lootTtlMs,
    digestMs: config.digest_ms ?? MONSTER_DEFAULTS.digestMs,
    stealCooldownMs: config.steal_cooldown_ms ?? MONSTER_DEFAULTS.stealCooldownMs,
  };
}

export const monsterHp = (def: MonsterDef): number => Math.max(1, Math.floor(def.hp ?? 1));
export const isThief = (def: MonsterDef): boolean => def.behavior === "thief";

/** A room's slots at mount: every monster starts `down` with a SHORT fuse, so the room
 *  opens quiet and the first telegraphs appear a moment later instead of all at once. */
export function createSlots(config: MonsterConfig, timings: MonsterTimings): MonsterSlot[] {
  return config.spawns.map((def, id) => ({
    id,
    def,
    phase: "down",
    cell: def.pos ? { ...def.pos } : { x: 0, y: 0 },
    hp: monsterHp(def),
    // Stagger the openers so a six-monster room doesn't pop all six markers on one frame.
    phaseLeft: Math.round((timings.spawnDelayMs * (id + 1)) / 2),
    moveLeft: timings.moveMs,
    carrying: null,
    digestLeft: 0,
    cooldownLeft: 0,
  }));
}

/** Is a cell a candidate for a monster (or its telegraph)? Floor the OCCUPANCY layer
 *  hasn't already claimed — `isFree` is injected because piles, doors, placed tokens,
 *  dropped loot and the player are all things this module cannot see. */
function canOccupy(room: Room, cell: Cell, isFree: (c: Cell) => boolean): boolean {
  return isWalkable(room, cell.x, cell.y) && isFree(cell);
}

/** Where a slot's next telegraph appears: its authored cell when that is free, otherwise
 *  any free floor cell (chosen with the injected rng). null ⇒ the room is full right now,
 *  and the caller should simply try again on a later tick. */
export function spawnCellFor(
  def: MonsterDef,
  room: Room,
  isFree: (c: Cell) => boolean,
  rng: () => number,
): Cell | null {
  if (def.pos && canOccupy(room, def.pos, isFree)) return { ...def.pos };
  const open: Cell[] = [];
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      const c = { x, y };
      if (canOccupy(room, c, isFree)) open.push(c);
    }
  }
  if (!open.length) return null;
  return open[Math.min(open.length - 1, Math.floor(rng() * open.length))];
}

/** One wander step: a random free orthogonal neighbour, or the same cell when boxed in.
 *  Deliberately dumb — a monster is an obstacle with loot, not an adversary. */
export function wanderStep(
  from: Cell,
  room: Room,
  isFree: (c: Cell) => boolean,
  rng: () => number,
): Cell {
  const options = Object.values(MOVE)
    .map((d) => ({ x: from.x + d.dx, y: from.y + d.dy }))
    .filter((c) => canOccupy(room, c, isFree));
  if (!options.length) return { ...from };
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

/** Manhattan distance — the chase step's only notion of "closer". */
function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Is `cell` close enough to REACH a target — orthogonally adjacent to one, or standing
 *  on it? Reaching one never requires walking ONTO it: a steal target's cell belongs to
 *  the ROOM MODULE (e.g. a placed code token — see MountedPuzzle.stealTargets), not to
 *  the monster system, so a thief robs it from next door — the same way `attack` hits the
 *  faced cell without ever moving onto it. Returns the nearest reachable target, or null. */
export function stealableFrom(cell: Cell, targets: Cell[]): Cell | null {
  let nearest: Cell | null = null;
  let best = Infinity;
  for (const t of targets) {
    const d = manhattan(cell, t);
    if (d <= 1 && d < best) { nearest = t; best = d; }
  }
  return nearest;
}

/** One step toward the NEAREST target (Manhattan distance), greedy on whichever axis has
 *  the bigger gap, then the other if that one's blocked — never diagonal, same as every
 *  other move in this room. Already in reach → returns `from` unchanged (the caller checks
 *  `stealableFrom` first and steals instead of stepping). No targets, or walled off on
 *  both preferred axes → falls back to `wanderStep`: a thief with nothing to chase, or
 *  nowhere to chase it TO, is just another monster. */
export function chaseStep(
  from: Cell,
  targets: Cell[],
  room: Room,
  isFree: (c: Cell) => boolean,
  rng: () => number,
): Cell {
  if (!targets.length) return wanderStep(from, room, isFree, rng);
  let nearest = targets[0];
  let best = Infinity;
  for (const t of targets) {
    const d = manhattan(from, t);
    if (d < best) { nearest = t; best = d; }
  }
  if (best <= 1) return { ...from };

  const dx = Math.sign(nearest.x - from.x);
  const dy = Math.sign(nearest.y - from.y);
  const biggerGapIsX = Math.abs(nearest.x - from.x) >= Math.abs(nearest.y - from.y);
  const candidates: Cell[] = [];
  for (const preferX of biggerGapIsX ? [true, false] : [false, true]) {
    if (preferX && dx) candidates.push({ x: from.x + dx, y: from.y });
    if (!preferX && dy) candidates.push({ x: from.x, y: from.y + dy });
  }
  for (const c of candidates) if (canOccupy(room, c, isFree)) return c;
  return wanderStep(from, room, isFree, rng);
}

/** Land a hit. Returns the slot's new state and whether that hit finished it. Defeat
 *  itself (dropping loot, arming the respawn fuse) is the caller's job — see `defeat`. */
export function damage(slot: MonsterSlot): { slot: MonsterSlot; defeated: boolean } {
  const hp = Math.max(0, slot.hp - 1);
  return { slot: { ...slot, hp }, defeated: hp === 0 };
}

/** What a slot drops on defeat: a carrier's fixed `def.token`; a thief's STOLEN object,
 *  if it happened to be carrying one — empty-handed, a thief drops nothing (killing one
 *  must never be the cheap way to farm tokens; only a genuine rescue pays out). */
export function lootOf(slot: MonsterSlot): string | null {
  return isThief(slot.def) ? slot.carrying : (slot.def.token ?? null);
}

/** Begin carrying a stolen object: arms the digest window, clears the hunt. The actual
 *  theft (removing the object from the room module's own state) already happened by the
 *  time this is called — see systems/monsters.ts, which calls MountedPuzzle.takeToken
 *  BEFORE this, and only calls this if that returned a real token. */
export function beginCarry(slot: MonsterSlot, token: string, timings: MonsterTimings): MonsterSlot {
  return { ...slot, carrying: token, digestLeft: timings.digestMs, moveLeft: timings.moveMs };
}

/** The rescue window ran out: the object is gone (re-obtainable from its ORIGINAL source
 *  — same load-bearing guarantee as monster respawn; see validateRepair's softlock guard),
 *  and the slot cools down before it starts hunting again. */
export function digest(slot: MonsterSlot, timings: MonsterTimings): MonsterSlot {
  return { ...slot, carrying: null, digestLeft: 0, cooldownLeft: timings.stealCooldownMs };
}

/** Where a defeated monster's loot lands: its own cell when free, else a free neighbour.
 *  null ⇒ nowhere at all (the slot respawns, so nothing is permanently lost). */
export function lootCellFor(from: Cell, room: Room, isFree: (c: Cell) => boolean): Cell | null {
  if (canOccupy(room, from, isFree)) return { ...from };
  for (const d of Object.values(MOVE)) {
    const c = { x: from.x + d.dx, y: from.y + d.dy };
    if (canOccupy(room, c, isFree)) return c;
  }
  return null;
}

/** What one `advance` tick asks the caller to do (the DOM system draws/loots/steals on
 *  these — see systems/monsters.ts). */
export type MonsterEvent =
  | { kind: "telegraph"; slot: MonsterSlot }
  | { kind: "spawned"; slot: MonsterSlot }
  | { kind: "moved"; slot: MonsterSlot }
  /** A thief is in reach of `cell` and is attempting to take whatever is there RIGHT
   *  NOW — pure code can't know if anything still is (that's the room module's state,
   *  not this module's); the DOM layer calls takeToken and decides what happens next. */
  | { kind: "steal-attempt"; slot: MonsterSlot; cell: Cell }
  /** A thief's rescue window ran out — `token` is gone (re-obtainable from its ORIGINAL
   *  source; nothing here is ever permanently lost — see the respawn/softlock rules). */
  | { kind: "digested"; slot: MonsterSlot; token: string };

/**
 * Advance every slot by `dt` ms. PURE: returns fresh slots plus the events that fired.
 * A slot that cannot find a cell (room momentarily full) simply retries next tick.
 *
 * `stealTargets` is read ONLY by thief-behavior slots (a carrier ignores it entirely) —
 * the live list of cells the room module currently offers up to steal from (e.g. every
 * unlocked placed code token), recomputed by the caller each tick so a token placed or
 * removed mid-hunt is reflected immediately.
 *
 * `inputBlocked` FREEZES thief-specific progression (hunting, stealing, and the digest
 * countdown) for exactly this tick — the player cannot respond while a dialogue beat, a
 * tutorial step, or the task overlay has taken over input, so a theft or a digest must
 * never land unanswerably behind one. Telegraphs, spawns, and CARRIER wandering are
 * unaffected (unchanged from before thieves existed) — this is thief fairness, not a
 * general room freeze.
 */
export function advance(
  slots: MonsterSlot[],
  dt: number,
  room: Room,
  timings: MonsterTimings,
  isFree: (c: Cell, slotId: number) => boolean,
  rng: () => number,
  stealTargets: Cell[] = [],
  inputBlocked = false,
): { slots: MonsterSlot[]; events: MonsterEvent[] } {
  const events: MonsterEvent[] = [];
  const next = slots.map((s) => {
    const slot = { ...s };
    // A slot never blocks itself: it is allowed to "occupy" the cell it already stands on.
    const free = (c: Cell) => isFree(c, slot.id);

    if (slot.phase === "down") {
      slot.phaseLeft -= dt;
      if (slot.phaseLeft > 0) return slot;
      const cell = spawnCellFor(slot.def, room, free, rng);
      if (!cell) { slot.phaseLeft = timings.moveMs; return slot; } // room full — retry soon
      slot.cell = cell;
      slot.phase = "telegraph";
      slot.hp = monsterHp(slot.def);
      slot.phaseLeft = timings.spawnDelayMs;
      events.push({ kind: "telegraph", slot });
      return slot;
    }

    if (slot.phase === "telegraph") {
      slot.phaseLeft -= dt;
      if (slot.phaseLeft > 0) return slot;
      slot.phase = "active";
      slot.phaseLeft = 0;
      slot.moveLeft = timings.moveMs;
      events.push({ kind: "spawned", slot });
      return slot;
    }

    // --- active: a carrier just wanders; a thief runs its own extra sub-state ---
    if (isThief(slot.def)) {
      if (inputBlocked) return slot; // frozen — see the `inputBlocked` doc above
      if (slot.carrying !== null) {
        // CARRYING: the rescue window counts down regardless of movement — it still
        // wanders (it is fleeing with your token, not hiding), so catching it is the
        // same chase as catching any active monster, on a clock.
        slot.digestLeft -= dt;
        if (slot.digestLeft <= 0) {
          const token = slot.carrying;
          const digested = digest(slot, timings);
          events.push({ kind: "digested", slot: digested, token });
          return digested;
        }
        slot.moveLeft -= dt;
        if (slot.moveLeft > 0) return slot;
        slot.moveLeft = timings.moveMs;
        const to = wanderStep(slot.cell, room, free, rng);
        if (to.x !== slot.cell.x || to.y !== slot.cell.y) { slot.cell = to; events.push({ kind: "moved", slot }); }
        return slot;
      }
      if (slot.cooldownLeft > 0) {
        // COOLDOWN: not hunting yet — wanders like an ordinary monster.
        slot.cooldownLeft -= dt;
        slot.moveLeft -= dt;
        if (slot.moveLeft > 0) return slot;
        slot.moveLeft = timings.moveMs;
        const to = wanderStep(slot.cell, room, free, rng);
        if (to.x !== slot.cell.x || to.y !== slot.cell.y) { slot.cell = to; events.push({ kind: "moved", slot }); }
        return slot;
      }
      // HUNTING: chase the nearest steal target, or steal once in reach.
      slot.moveLeft -= dt;
      if (slot.moveLeft > 0) return slot;
      slot.moveLeft = timings.moveMs;
      const inReach = stealableFrom(slot.cell, stealTargets);
      if (inReach) { events.push({ kind: "steal-attempt", slot, cell: inReach }); return slot; }
      const to = chaseStep(slot.cell, stealTargets, room, free, rng);
      if (to.x !== slot.cell.x || to.y !== slot.cell.y) { slot.cell = to; events.push({ kind: "moved", slot }); }
      return slot;
    }

    slot.moveLeft -= dt;
    if (slot.moveLeft > 0) return slot;
    slot.moveLeft = timings.moveMs;
    const to = wanderStep(slot.cell, room, free, rng);
    if (to.x !== slot.cell.x || to.y !== slot.cell.y) {
      slot.cell = to;
      events.push({ kind: "moved", slot });
    }
    return slot;
  });
  return { slots: next, events };
}

/** Mark a slot defeated and start its respawn fuse (the caller drops the loot — see
 *  `lootOf`, read BEFORE calling this, since it clears `carrying`). A fresh telegraph
 *  must never remember a hunt or a carry from its previous life. */
export function defeat(slot: MonsterSlot, timings: MonsterTimings): MonsterSlot {
  return {
    ...slot, phase: "down", hp: 0, phaseLeft: timings.respawnMs,
    carrying: null, digestLeft: 0, cooldownLeft: 0,
  };
}
