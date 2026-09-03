import { describe, it, expect } from "vitest";
import type { MonsterConfig, RoomLayout } from "../../schema/types";
import { parseRoom } from "./room";
import {
  MONSTER_DEFAULTS, advance, beginCarry, chaseStep, createSlots, damage, defeat, digest,
  lootCellFor, lootOf, monsterHp, resolveTimings, spawnCellFor, stealableFrom, wanderStep,
} from "./monsters";

// A 5x4 room, wall-ringed, with one interior wall at (2,2):
//   #####
//   #...#
//   #.#.#
//   #####
const LAYOUT: RoomLayout = { width: 5, height: 4, tiles: ["#####", "#...#", "#.#.#", "#####"] };
const room = parseRoom(LAYOUT);
const allFree = () => true;
/** Deterministic rng: always the first option. */
const first = () => 0;

const CONFIG: MonsterConfig = {
  spawns: [{ token: "print", pos: { x: 1, y: 1 } }, { token: "5", hp: 2 }],
};
const timings = resolveTimings(CONFIG);

describe("resolveTimings", () => {
  it("falls back to the engine defaults", () => {
    expect(resolveTimings({ spawns: [] })).toEqual({
      spawnDelayMs: MONSTER_DEFAULTS.spawnDelayMs,
      respawnMs: MONSTER_DEFAULTS.respawnMs,
      moveMs: MONSTER_DEFAULTS.moveMs,
      lootTtlMs: MONSTER_DEFAULTS.lootTtlMs,
      digestMs: MONSTER_DEFAULTS.digestMs,
      stealCooldownMs: MONSTER_DEFAULTS.stealCooldownMs,
    });
  });

  it("lets CONTENT override every timing", () => {
    const t = resolveTimings({
      spawns: [], spawn_delay_ms: 1, respawn_ms: 2, move_ms: 3, loot_ttl_ms: 4,
      digest_ms: 5, steal_cooldown_ms: 6,
    });
    expect(t).toEqual({
      spawnDelayMs: 1, respawnMs: 2, moveMs: 3, lootTtlMs: 4, digestMs: 5, stealCooldownMs: 6,
    });
  });
});

describe("createSlots", () => {
  it("starts every slot down, at full hp, with a staggered opening fuse", () => {
    const slots = createSlots(CONFIG, timings);
    expect(slots.map((s) => s.phase)).toEqual(["down", "down"]);
    expect(slots.map((s) => s.hp)).toEqual([1, 2]); // hp defaults to 1
    expect(slots[0].phaseLeft).toBeLessThan(slots[1].phaseLeft); // no simultaneous pop
  });

  it("clamps a nonsense hp up to one hit", () => {
    expect(monsterHp({ token: "x", hp: 0 })).toBe(1);
    expect(monsterHp({ token: "x" })).toBe(1);
  });
});

describe("spawnCellFor", () => {
  it("uses the authored cell when it is free", () => {
    expect(spawnCellFor({ token: "print", pos: { x: 1, y: 1 } }, room, allFree, first)).toEqual({ x: 1, y: 1 });
  });

  it("falls back to a free floor cell when the authored one is taken", () => {
    const taken = (c: { x: number; y: number }) => !(c.x === 1 && c.y === 1);
    const cell = spawnCellFor({ token: "print", pos: { x: 1, y: 1 } }, room, taken, first)!;
    expect(cell).not.toEqual({ x: 1, y: 1 });
    expect(room.grid[cell.y][cell.x]).toBe("floor");
  });

  it("never spawns on a wall", () => {
    const cell = spawnCellFor({ token: "print", pos: { x: 2, y: 2 } }, room, allFree, first)!;
    expect(room.grid[cell.y][cell.x]).toBe("floor");
  });

  it("returns null when the room has nowhere free (the caller retries later)", () => {
    expect(spawnCellFor({ token: "print" }, room, () => false, first)).toBeNull();
  });
});

describe("wanderStep", () => {
  it("steps onto a free floor neighbour", () => {
    const to = wanderStep({ x: 1, y: 1 }, room, allFree, first);
    expect(room.grid[to.y][to.x]).toBe("floor");
    expect(Math.abs(to.x - 1) + Math.abs(to.y - 1)).toBe(1);
  });

  it("stays put when boxed in", () => {
    expect(wanderStep({ x: 1, y: 1 }, room, () => false, first)).toEqual({ x: 1, y: 1 });
  });

  it("never steps through a wall", () => {
    // (3,2) has walls left (2,2) and below; only (3,1) is open.
    expect(wanderStep({ x: 3, y: 2 }, room, allFree, first)).toEqual({ x: 3, y: 1 });
  });
});

describe("damage / defeat", () => {
  it("takes a hit without dying while hp remains", () => {
    const slot = createSlots(CONFIG, timings)[1]; // hp 2
    const r = damage(slot);
    expect(r.defeated).toBe(false);
    expect(r.slot.hp).toBe(1);
  });

  it("reports the finishing hit", () => {
    const slot = { ...createSlots(CONFIG, timings)[0], hp: 1 };
    expect(damage(slot).defeated).toBe(true);
  });

  it("defeat arms the RESPAWN fuse — a slot always comes back, so loot can't strand a level", () => {
    const slot = defeat(createSlots(CONFIG, timings)[0], timings);
    expect(slot.phase).toBe("down");
    expect(slot.phaseLeft).toBe(timings.respawnMs);
  });
});

describe("lootCellFor", () => {
  it("drops on the monster's own cell when it is free", () => {
    expect(lootCellFor({ x: 1, y: 1 }, room, allFree)).toEqual({ x: 1, y: 1 });
  });

  it("falls back to a free neighbour when the cell is taken", () => {
    const busy = (c: { x: number; y: number }) => !(c.x === 1 && c.y === 1);
    const cell = lootCellFor({ x: 1, y: 1 }, room, busy)!;
    expect(cell).not.toEqual({ x: 1, y: 1 });
    expect(room.grid[cell.y][cell.x]).toBe("floor");
  });

  it("returns null when there is nowhere at all", () => {
    expect(lootCellFor({ x: 1, y: 1 }, room, () => false)).toBeNull();
  });
});

describe("advance — the lifecycle", () => {
  const t = resolveTimings({ spawns: [], spawn_delay_ms: 100, respawn_ms: 300, move_ms: 100 });
  const free = () => true;

  /** Run the clock forward in `dt` slices, collecting every event. */
  function run(slots: ReturnType<typeof createSlots>, ms: number, dt = 50) {
    const events = [];
    for (let elapsed = 0; elapsed < ms; elapsed += dt) {
      const r = advance(slots, dt, room, t, free, first);
      slots = r.slots;
      events.push(...r.events);
    }
    return { slots, events };
  }

  it("telegraphs BEFORE it becomes attackable (the indicator, then the delay)", () => {
    const slots = createSlots({ spawns: [{ token: "print", pos: { x: 1, y: 1 } }] }, t);
    // Straight to the telegraph, then check nothing has materialized yet.
    const a = run(slots, slots[0].phaseLeft + 50);
    expect(a.slots[0].phase).toBe("telegraph");
    expect(a.events.map((e) => e.kind)).toContain("telegraph");
    expect(a.events.map((e) => e.kind)).not.toContain("spawned");
    // ...and only after the spawn delay does it turn into a monster.
    const b = run(a.slots, t.spawnDelayMs + 50);
    expect(b.slots[0].phase).toBe("active");
    expect(b.events.map((e) => e.kind)).toContain("spawned");
  });

  it("an active monster wanders", () => {
    const slots = createSlots({ spawns: [{ token: "print", pos: { x: 1, y: 1 } }] }, t);
    const r = run(slots, 1000);
    expect(r.slots[0].phase).toBe("active");
    expect(r.events.some((e) => e.kind === "moved")).toBe(true);
  });

  it("a defeated slot re-telegraphs after the respawn delay", () => {
    let slots = createSlots({ spawns: [{ token: "print", pos: { x: 1, y: 1 } }] }, t);
    slots = run(slots, 1000).slots;               // let it come alive
    slots = [defeat(slots[0], t)];                // kill it
    const r = run(slots, t.respawnMs + 100);
    expect(r.events.map((e) => e.kind)).toContain("telegraph");
    expect(r.slots[0].hp).toBe(1);                // back to full hp
  });

  it("retries instead of giving up when the room is momentarily full", () => {
    const slots = createSlots({ spawns: [{ token: "print" }] }, t);
    let s = slots;
    for (let i = 0; i < 40; i++) s = advance(s, 50, room, t, () => false, first).slots;
    expect(s[0].phase).toBe("down");
    expect(s[0].phaseLeft).toBeGreaterThan(0); // still counting down to another attempt
  });

  it("two monsters never stand on the same cell (the caller's isFree sees the others)", () => {
    let slots = createSlots({ spawns: [{ token: "a" }, { token: "b" }] }, t);
    const busy = (c: { x: number; y: number }, id: number) =>
      !slots.some((s) => s.id !== id && s.phase !== "down" && s.cell.x === c.x && s.cell.y === c.y);
    for (let i = 0; i < 40; i++) slots = advance(slots, 50, room, t, busy, () => Math.random()).slots;
    const live = slots.filter((s) => s.phase !== "down");
    const cells = new Set(live.map((s) => `${s.cell.x},${s.cell.y}`));
    expect(cells.size).toBe(live.length);
  });
});

// --- THIEF behavior: hunt → steal → carry → digest, or rescue mid-carry -------------

describe("stealableFrom", () => {
  it("finds the nearest target within one orthogonal step", () => {
    expect(stealableFrom({ x: 2, y: 2 }, [{ x: 2, y: 1 }])).toEqual({ x: 2, y: 1 });
    expect(stealableFrom({ x: 2, y: 2 }, [{ x: 2, y: 2 }])).toEqual({ x: 2, y: 2 }); // same cell counts
  });

  it("returns null when nothing is in reach", () => {
    expect(stealableFrom({ x: 2, y: 2 }, [{ x: 4, y: 4 }])).toBeNull();
    expect(stealableFrom({ x: 2, y: 2 }, [])).toBeNull();
  });

  it("picks the CLOSEST of several candidates", () => {
    const near = stealableFrom({ x: 2, y: 2 }, [{ x: 2, y: 2 }, { x: 2, y: 1 }]);
    expect(near).toEqual({ x: 2, y: 2 });
  });
});

describe("chaseStep", () => {
  it("steps toward the nearest target, biggest-gap axis first", () => {
    // From (1,1), target at (3,1): gap is all in x, one step right.
    const to = chaseStep({ x: 1, y: 1 }, [{ x: 3, y: 1 }], room, allFree, first);
    expect(to).toEqual({ x: 2, y: 1 });
  });

  it("stays put once already in reach — advance() steals instead of stepping", () => {
    const to = chaseStep({ x: 1, y: 1 }, [{ x: 2, y: 1 }], room, allFree, first);
    expect(to).toEqual({ x: 1, y: 1 });
  });

  it("falls back to wanderStep with no targets at all", () => {
    const to = chaseStep({ x: 1, y: 1 }, [], room, allFree, first);
    expect(room.grid[to.y][to.x]).toBe("floor");
  });

  it("tries the OTHER axis when the preferred one is blocked, before giving up", () => {
    // (3,2) has a wall at (2,2) — the x-move toward a target further left is blocked;
    // it should still make progress on y instead of freezing or wandering at random.
    const to = chaseStep({ x: 3, y: 2 }, [{ x: 1, y: 2 }], room, allFree, first);
    expect(to).toEqual({ x: 3, y: 1 }); // the only open neighbour of (3,2)
  });
});

describe("beginCarry / digest / lootOf", () => {
  const thiefDef = { behavior: "thief" as const };
  const carrierDef = { token: "print" };

  it("beginCarry arms the digest window and clears nothing else", () => {
    const slot = { ...createSlots({ spawns: [thiefDef] }, timings)[0], phase: "active" as const };
    const carrying = beginCarry(slot, "hello", timings);
    expect(carrying.carrying).toBe("hello");
    expect(carrying.digestLeft).toBe(timings.digestMs);
  });

  it("digest clears carrying and arms the cooldown", () => {
    const slot = beginCarry({ ...createSlots({ spawns: [thiefDef] }, timings)[0] }, "hello", timings);
    const after = digest(slot, timings);
    expect(after.carrying).toBeNull();
    expect(after.cooldownLeft).toBe(timings.stealCooldownMs);
  });

  it("lootOf: a carrier drops its authored token", () => {
    const slot = createSlots({ spawns: [carrierDef] }, timings)[0];
    expect(lootOf(slot)).toBe("print");
  });

  it("lootOf: an empty-handed thief drops NOTHING — killing one must never pay out", () => {
    const slot = createSlots({ spawns: [thiefDef] }, timings)[0];
    expect(lootOf(slot)).toBeNull();
  });

  it("lootOf: a carrying thief drops what it STOLE, not def.token", () => {
    const slot = beginCarry(createSlots({ spawns: [thiefDef] }, timings)[0], "x", timings);
    expect(lootOf(slot)).toBe("x");
  });

  it("defeat wipes a carrying thief's hand clean — a respawned slot starts fresh", () => {
    const carrying = beginCarry(createSlots({ spawns: [thiefDef] }, timings)[0], "x", timings);
    const dead = defeat(carrying, timings);
    expect(dead.carrying).toBeNull();
    expect(dead.digestLeft).toBe(0);
    expect(dead.cooldownLeft).toBe(0);
  });
});

describe("advance — the thief lifecycle", () => {
  const t = resolveTimings({
    spawns: [], spawn_delay_ms: 50, respawn_ms: 300, move_ms: 50, digest_ms: 200, steal_cooldown_ms: 150,
  });
  const free = () => true;

  function run(slots: ReturnType<typeof createSlots>, ms: number, targets: { x: number; y: number }[], dt = 25) {
    const events = [];
    for (let elapsed = 0; elapsed < ms; elapsed += dt) {
      const r = advance(slots, dt, room, t, free, first, targets);
      slots = r.slots;
      events.push(...r.events);
    }
    return { slots, events };
  }

  /** Bring a lone thief up (skip past telegraph → active). */
  function activeThief() {
    const slots = createSlots({ spawns: [{ behavior: "thief" as const, pos: { x: 1, y: 1 } }] }, t);
    return run(slots, slots[0].phaseLeft + t.spawnDelayMs + 25, []).slots;
  }

  it("a carrier IGNORES stealTargets entirely — old rooms behave exactly as before", () => {
    const slots = createSlots({ spawns: [{ token: "print", pos: { x: 1, y: 1 } }] }, t);
    const r = run(slots, 300, [{ x: 1, y: 1 }]); // a "target" sitting right where it spawns
    // No steal-attempt ever fires for a carrier — it just wanders like it always did.
    expect(r.events.some((e) => e.kind === "steal-attempt")).toBe(false);
  });

  it("a thief with no targets just wanders (an ordinary monster until there's something to take)", () => {
    const slots = activeThief();
    const r = run(slots, 300, []);
    expect(r.events.some((e) => e.kind === "moved")).toBe(true);
    expect(r.events.some((e) => e.kind === "steal-attempt")).toBe(false);
  });

  it("HUNTS a target, then attempts a steal once in reach — never walking onto the target's own cell", () => {
    let slots = activeThief(); // starts at (1,1)
    const target = { x: 3, y: 1 };
    const r = run(slots, 1000, [target]);
    expect(r.events.some((e) => e.kind === "steal-attempt")).toBe(true);
    const attempt = r.events.find((e) => e.kind === "steal-attempt")!;
    expect(attempt).toMatchObject({ cell: target });
    // The thief itself never occupies the target's cell — it robs from next door.
    expect(r.slots[0].cell).not.toEqual(target);
  });

  it("does not re-attempt a steal on every tick — it is rate-limited to move_ms, not the clock resolution", () => {
    // A hand-built slot (not activeThief()'s helper) so moveLeft starts at a KNOWN fresh
    // value — the helper's phase-transition timing consumes an unpredictable slice of
    // moveLeft before the first hunting tick even runs.
    const fresh = { ...createSlots({ spawns: [{ behavior: "thief" as const }] }, t)[0], phase: "active" as const, moveLeft: t.moveMs };
    const target = { x: 0, y: 0 }; // adjacent-or-equal to (0,0), wherever it spawned
    const dt = 10; // much finer than move_ms — if attempts fired every TICK, this would spam
    const r = run([fresh], t.moveMs * 3, [target], dt);
    const attempts = r.events.filter((e) => e.kind === "steal-attempt").length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThan((t.moveMs * 3) / dt); // far fewer than one per tick
  });

  it("carrying counts down and, left alone, digests — the object is gone, the slot cools down", () => {
    let slots = activeThief();
    slots = [beginCarry(slots[0], "hello", t)]; // simulate the DOM layer's successful takeToken
    const r = run(slots, t.digestMs + 50, []);
    const dig = r.events.find((e) => e.kind === "digested");
    expect(dig).toMatchObject({ token: "hello" });
    expect(r.slots[0].carrying).toBeNull();
    expect(r.slots[0].cooldownLeft).toBeGreaterThan(0);
    expect(r.slots[0].phase).toBe("active"); // still solid — not defeated, just empty-handed
  });

  it("a carrying thief still wanders — it is fleeing with your token, not hiding", () => {
    let slots = activeThief();
    slots = [beginCarry(slots[0], "hello", t)];
    const r = run(slots, t.digestMs - 25, []); // stay inside the rescue window
    expect(r.events.some((e) => e.kind === "moved")).toBe(true);
    expect(r.slots[0].carrying).toBe("hello"); // never digested during this run
  });

  it("after a cooldown, a thief resumes hunting rather than stealing immediately", () => {
    let slots = activeThief();
    slots = [{ ...slots[0], cooldownLeft: t.stealCooldownMs }];
    const target = { x: 1, y: 1 }; // adjacent-or-equal to the spawn cell
    const early = advance(slots, 25, room, t, free, first, [target]);
    expect(early.events.some((e) => e.kind === "steal-attempt")).toBe(false); // still cooling down
    const later = run(early.slots, t.stealCooldownMs + 100, [target]);
    expect(later.events.some((e) => e.kind === "steal-attempt")).toBe(true);
  });

  describe("inputBlocked — no unanswerable theft/digest while the player can't respond", () => {
    it("a hunting thief neither moves nor steals while blocked", () => {
      const slots = activeThief(); // at (1,1)
      const target = { x: 3, y: 1 };
      const r = advance(slots, 1000, room, t, free, first, [target], true);
      expect(r.events).toEqual([]);
      expect(r.slots[0].cell).toEqual(slots[0].cell); // hasn't moved an inch
    });

    it("a CARRYING thief's digest clock also freezes — the rescue window can't run out unanswerably", () => {
      let slots = activeThief();
      slots = [beginCarry(slots[0], "hello", t)];
      const before = slots[0].digestLeft;
      const r = advance(slots, t.digestMs + 500, room, t, free, first, [], true);
      expect(r.slots[0].digestLeft).toBe(before); // frozen, not ticking down
      expect(r.slots[0].carrying).toBe("hello");  // never digested
      expect(r.events.some((e) => e.kind === "digested")).toBe(false);
    });

    it("unblocking resumes exactly where it left off (no time is 'lost' or double-counted)", () => {
      let slots = activeThief();
      slots = [beginCarry(slots[0], "hello", t)];
      const blocked = advance(slots, 1000, room, t, free, first, [], true).slots;
      const resumed = advance(blocked, t.digestMs, room, t, free, first, [], false);
      expect(resumed.events.some((e) => e.kind === "digested")).toBe(true); // the ORIGINAL window, not a fresh one
    });

    it("carriers and the telegraph/spawn phases are UNAFFECTED — this is thief-only fairness", () => {
      const slots = createSlots({ spawns: [{ token: "print", pos: { x: 1, y: 1 } }] }, t);
      const r = run(slots, 1000, [], 50); // a plain carrier, run() defaults inputBlocked away
      expect(r.slots[0].phase).toBe("active");
      expect(r.events.some((e) => e.kind === "moved")).toBe(true);
    });
  });
});
