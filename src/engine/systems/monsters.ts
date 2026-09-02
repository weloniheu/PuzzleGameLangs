// ---------------------------------------------------------------------------
// Monsters (shared engine system) — the DOM + clock half of core/monsters.ts.
//
// Owns ONE interval. Every tick it hands the elapsed ms to the pure `advance` and
// then paints whatever came back: a telegraph marker, a materialized monster, a
// wander/chase step, a steal attempt, a digest. Attacks come in from the host (the
// `attack` action); a defeat is reported back out so the HOST drops the loot — this
// system never touches the inventory or the dropped-item layer, so there is exactly
// one place in the engine that puts a token on the floor.
//
// THEFT is the other half of this system (MonsterBehavior "thief" — see
// schema/types.ts and core/monsters.ts for the full lifecycle). It never learns what a
// "placed token" IS: `stealTargets`/`takeToken` are opaque cells + strings handed in by
// the ROOM MODULE (MountedPuzzle), the same boundary `occupies` already crosses.
//
// FEATURE-GATED: a room that doesn't declare "monsters" never calls this, so there
// is no layer, no interval and no teardown burden.
// ---------------------------------------------------------------------------

import type { MonsterBehavior, MonsterConfig } from "../../schema/types";
import type { Cell, Room } from "../core/room";
import {
  advance, beginCarry, createSlots, damage, defeat, isThief, lootCellFor, lootOf, resolveTimings,
  type MonsterSlot, type MonsterTimings,
} from "../core/monsters";

/** How often the lifecycle is stepped. Phase durations are CONTENT (MonsterConfig);
 *  this is only the resolution they are counted down at. */
export const MONSTER_TICK_MS = 100;
/** How long the hit flash and the attack swipe stay on screen. */
export const MONSTER_HURT_MS = 200;
export const ATTACK_SWIPE_MS = 220;
/** THIEF transients: the grab flash on the robbed cell, and the puff where a digested
 *  object was last seen. */
export const STEAL_FLASH_MS = 260;
export const DIGEST_PUFF_MS = 700;

export interface MonstersDeps {
  room: Room;
  config: MonsterConfig;
  /** The layer to draw into (host-owned, so stacking order stays the host's business). */
  layer: HTMLElement;
  /** Live tile px. */
  tile(): number;
  /** Is this cell free of everything the MONSTER system can't see (piles, doors, the
   *  menu portal, the hint giver, placed tokens, dropped loot, the player)? The host
   *  answers; monsters add their own occupancy on top. */
  isFree(cell: Cell): boolean;
  /** A monster died here carrying `token` — the host puts it on the floor. `from` is the
   *  dead monster's BEHAVIOR, so the drop can keep that role's accent (8a's loot tag). */
  onLoot(
    token: string,
    cell: Cell,
    kind: string | undefined,
    ttlMs: number,
    from: MonsterBehavior,
  ): void;
  /** THIEF ONLY: cells the room module currently offers up to steal from (e.g. every
   *  unlocked placed code token). Read fresh every tick — a token placed or removed
   *  mid-hunt shows up immediately. Omitted/empty ⇒ a thief in this room just wanders;
   *  it never invents a target. */
  stealTargets?(): Cell[];
  /** THIEF ONLY: take whatever is at `cell` RIGHT NOW, if anything still is (the room
   *  module owns that state, not this system) — returns the stolen token, or null if
   *  there was nothing there after all (the target moved/vanished since the last read;
   *  the thief just keeps hunting). */
  takeToken?(cell: Cell): string | null;
  /** THIEF ONLY: is normal gameplay input currently reaching the room (a dialogue beat,
   *  a tutorial step, the task overlay, or the destination menu all say no)? While true,
   *  every thief's hunt/steal/digest FREEZES for that tick — see core/monsters.ts's
   *  `advance` doc. Omitted ⇒ never blocked (unaffected rooms keep today's behavior). */
  inputBlocked?(): boolean;
  /** Randomness seam (fixed in tests). */
  rng?: () => number;
}

export interface Monsters {
  /** Is an ACTIVE monster standing on this cell? (Telegraph markers are not solid.) */
  occupies(cell: Cell): boolean;
  /** Swing at a cell. Returns true when a hit LANDED on an active monster — the host
   *  uses that both for the tutorial's "attack" step and to decide the feedback. */
  attackAt(cell: Cell): boolean;
  /** Redraw at the current tile size (called from the host's relayout). */
  relayout(): void;
  /** Stop the clock and drop the DOM (the host also clears the room wholesale). */
  teardown(): void;
}

export function createMonsters(deps: MonstersDeps): Monsters {
  const { room, layer } = deps;
  const rng = deps.rng ?? Math.random;
  const timings: MonsterTimings = resolveTimings(deps.config);
  let slots: MonsterSlot[] = createSlots(deps.config, timings);
  // No thief in this room's table → never bother reading stealTargets (cheap, but the
  // room module may not even implement it — see MonstersDeps.stealTargets).
  const hasThief = deps.config.spawns.some((s) => s.behavior === "thief");
  // One element per slot, reused across its whole lifecycle (hidden while `down`).
  const els = new Map<number, HTMLElement>();
  const hurtTimers = new Map<number, number>();
  // THIEF ONLY: markers over cells CURRENTLY at risk (see drawTargets) — a separate
  // small layer since these belong to the room MODULE's cells, not to any one monster.
  const targetEls: HTMLElement[] = [];

  /** A cell is free for a monster when the host says so AND no OTHER live slot is there. */
  function free(cell: Cell, selfId: number): boolean {
    if (!deps.isFree(cell)) return false;
    return !slots.some(
      (s) => s.id !== selfId && s.phase !== "down" && s.cell.x === cell.x && s.cell.y === cell.y,
    );
  }

  function elFor(slot: MonsterSlot): HTMLElement {
    let el = els.get(slot.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "tile-room tile-monster";
      const glyph = document.createElement("span");
      glyph.className = "tile-monster-glyph";
      const name = document.createElement("span");
      name.className = "tile-monster-label";
      const hp = document.createElement("span");
      hp.className = "tile-monster-hp";
      // THIEF ONLY: the digest ring — a fill bar that drains over digest_ms while
      // carrying. Present on every monster's DOM (cheap, empty div) but only ever
      // shown for a carrying thief; see drawSlot.
      const digest = document.createElement("span");
      digest.className = "tile-monster-digest";
      const digestFill = document.createElement("span");
      digestFill.className = "tile-monster-digest-fill";
      digest.appendChild(digestFill);
      el.append(glyph, name, hp, digest);
      layer.appendChild(el);
      els.set(slot.id, el);
    }
    return el;
  }

  /** Paint one slot: phase/behavior classes, position, and the readouts scaled to the
   *  live tile. Queried by class rather than positional destructuring — the digest bar
   *  is nested one level deeper than glyph/name/hp, and this stays correct regardless
   *  of what order elFor() appends things in. */
  function drawSlot(slot: MonsterSlot) {
    const el = elFor(slot);
    const tile = deps.tile();
    const thief = isThief(slot.def);
    const carrying = thief && slot.carrying !== null;
    // HUNTING: a thief actively chasing (cooldown elapsed, nothing in hand yet). The
    // tell has to land BEFORE the steal — see core/monsters.ts's "announces before it
    // takes" rule — so this is true for the whole chase, not just the final approach.
    const hunting = thief && !carrying && slot.phase === "active" && slot.cooldownLeft <= 0;

    el.hidden = slot.phase === "down";
    el.classList.toggle("telegraph", slot.phase === "telegraph");
    el.classList.toggle("active", slot.phase === "active");
    el.classList.toggle("tile-monster-thief", thief);
    el.classList.toggle("hunting", hunting);
    el.classList.toggle("carrying", carrying);
    el.style.width = `${tile}px`;
    el.style.height = `${tile}px`;
    el.style.transform = `translate(${slot.cell.x * tile}px, ${slot.cell.y * tile}px)`;

    const glyph = el.querySelector<HTMLElement>(".tile-monster-glyph")!;
    const name = el.querySelector<HTMLElement>(".tile-monster-label")!;
    const hp = el.querySelector<HTMLElement>(".tile-monster-hp")!;
    const digestFill = el.querySelector<HTMLElement>(".tile-monster-digest-fill")!;

    // A telegraph shows only the warning mark — what is coming is deliberately unnamed.
    glyph.textContent = slot.phase === "telegraph" ? "!" : (slot.def.glyph ?? (thief ? "🦝" : "👾"));
    glyph.style.fontSize = `${Math.round(tile * (slot.phase === "telegraph" ? 0.4 : 0.5))}px`;
    // What to call it: a CARRYING thief shows the stolen token (that IS the point — you
    // need to know what you're rescuing); otherwise its authored name, if it has one.
    // An empty-handed hunting thief showing nothing is correct, not a gap — it hasn't
    // taken anything yet.
    name.textContent = slot.phase === "active" ? (slot.carrying ?? slot.def.name ?? "") : "";
    name.style.fontSize = `${Math.round(tile * 0.2)}px`;
    // Only worth showing when a monster takes more than one hit.
    hp.textContent = slot.phase === "active" && slot.hp > 1 ? "♥".repeat(slot.hp) : "";
    hp.style.fontSize = `${Math.round(tile * 0.18)}px`;

    if (carrying) {
      const frac = Math.max(0, Math.min(1, slot.digestLeft / timings.digestMs));
      digestFill.style.width = `${Math.round(frac * 100)}%`;
    }
  }

  function drawAll() {
    for (const slot of slots) drawSlot(slot);
  }

  /** Mark every cell CURRENTLY offered up to steal from, whenever at least one thief is
   *  actively hunting (cooldown elapsed, empty-handed) — "which token is about to go,
   *  before it goes" (see VISUAL_CATALOG §2c). Cheap and simple over "only the ONE cell
   *  the nearest thief is beelining for": with several thieves and several targets in
   *  the same room, several are genuinely at risk at once, not just one. */
  function drawTargets(targets: Cell[]) {
    const anyHunting = slots.some(
      (s) => isThief(s.def) && s.phase === "active" && s.carrying === null && s.cooldownLeft <= 0,
    );
    const show = anyHunting ? targets : [];
    while (targetEls.length < show.length) {
      const el = document.createElement("div");
      el.className = "room-steal-target";
      layer.appendChild(el);
      targetEls.push(el);
    }
    const tile = deps.tile();
    targetEls.forEach((el, i) => {
      const cell = show[i];
      el.hidden = !cell;
      if (!cell) return;
      el.style.width = `${tile}px`;
      el.style.height = `${tile}px`;
      el.style.transform = `translate(${cell.x * tile}px, ${cell.y * tile}px)`;
    });
  }

  /** A one-shot mark on the ROBBED cell — "something was taken from HERE" — fired the
   *  instant a steal actually lands (not on every attempt; a target that turned out to
   *  be gone already isn't a grab). Self-removing, same pattern as roomHost's own
   *  transients (room-dust, room-sparkle, …). */
  function stealFlash(cell: Cell) {
    const tile = deps.tile();
    const el = document.createElement("div");
    el.className = "room-steal-flash";
    el.style.left = `${(cell.x + 0.5) * tile}px`;
    el.style.top = `${(cell.y + 0.5) * tile}px`;
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), STEAL_FLASH_MS);
  }

  /** Where a digested object was last seen — the "it's gone" tell, at the thief's OWN
   *  cell (that's where the carried object visually was). */
  function digestPuff(cell: Cell) {
    const tile = deps.tile();
    const el = document.createElement("div");
    el.className = "room-digest-puff";
    el.textContent = "···";
    el.style.left = `${(cell.x + 0.5) * tile}px`;
    el.style.top = `${(cell.y + 0.5) * tile}px`;
    el.style.fontSize = `${Math.round(tile * 0.4)}px`;
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), DIGEST_PUFF_MS);
  }

  /** A thief just reached a target cell — ask the room module what's actually there
   *  RIGHT NOW (it may have changed since the last tick's stealTargets() read: the
   *  player could have picked it up first). Nothing there → the thief just keeps
   *  hunting; something there → it starts carrying, on the clock. */
  function handleSteal(slotId: number, cell: Cell) {
    const token = deps.takeToken?.(cell) ?? null;
    if (!token) return;
    const i = slots.findIndex((s) => s.id === slotId);
    if (i < 0) return; // the slot respawned/vanished between the event firing and now
    slots[i] = beginCarry(slots[i], token, timings);
    drawSlot(slots[i]);
    stealFlash(cell);
  }

  const timer = window.setInterval(() => {
    const targets = hasThief ? (deps.stealTargets?.() ?? []) : [];
    const blocked = hasThief && (deps.inputBlocked?.() ?? false);
    const r = advance(slots, MONSTER_TICK_MS, room, timings, free, rng, targets, blocked);
    slots = r.slots;
    for (const ev of r.events) {
      drawSlot(ev.slot);
      if (ev.kind === "steal-attempt") handleSteal(ev.slot.id, ev.cell);
      if (ev.kind === "digested") digestPuff(ev.slot.cell);
    }
    if (hasThief) drawTargets(targets);
  }, MONSTER_TICK_MS);

  drawAll();

  return {
    occupies(cell) {
      return slots.some((s) => s.phase === "active" && s.cell.x === cell.x && s.cell.y === cell.y);
    },

    attackAt(cell) {
      const i = slots.findIndex(
        (s) => s.phase === "active" && s.cell.x === cell.x && s.cell.y === cell.y,
      );
      if (i < 0) return false; // empty air, or a telegraph — not yet a fight
      const hit = damage(slots[i]);
      slots[i] = hit.slot;
      const el = elFor(slots[i]);
      el.classList.add("hurt");
      clearTimeout(hurtTimers.get(slots[i].id));
      hurtTimers.set(
        slots[i].id,
        window.setTimeout(() => el.classList.remove("hurt"), MONSTER_HURT_MS),
      );
      if (!hit.defeated) { drawSlot(slots[i]); return true; }

      // Defeated: what it drops (lootOf) depends on behavior — a carrier's fixed cargo,
      // or whatever a thief happened to be carrying (nothing, if it was only hunting —
      // killing an empty-handed thief must never pay out). Read BEFORE defeat(), which
      // clears `carrying`. The loot lands where it fell (the corpse's own cell is free
      // the moment the monster stops occupying it), and the slot re-arms so the token
      // can be earned again — losing loot to a pit or a despawn must never strand the level.
      const dead = slots[i];
      const token = lootOf(dead);
      slots[i] = defeat(dead, timings);
      drawSlot(slots[i]);
      if (token) {
        const where = lootCellFor(dead.cell, room, (c) => free(c, dead.id));
        const from: MonsterBehavior = isThief(dead.def) ? "thief" : "carrier";
        if (where) deps.onLoot(token, where, dead.def.kind, timings.lootTtlMs, from);
      }
      return true;
    },

    relayout() {
      drawAll();
      // Re-size the target markers at the new tile too — same live-tile contract as
      // everything else in the room (see roomHost's own layers).
      if (hasThief) drawTargets(deps.stealTargets?.() ?? []);
    },

    teardown() {
      clearInterval(timer);
      for (const t of hurtTimers.values()) clearTimeout(t);
      hurtTimers.clear();
      for (const el of els.values()) el.remove();
      els.clear();
      for (const el of targetEls) el.remove();
      targetEls.length = 0;
    },
  };
}
