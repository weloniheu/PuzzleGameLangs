// @vitest-environment jsdom
// The DOM + clock half of the monster system: the telegraph→active gate (what you may
// hit and when), solidity, the hit→loot handoff, and a clean teardown. The lifecycle
// arithmetic itself is tested pure in core/monsters.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MonsterConfig, RoomLayout } from "../../schema/types";
import { parseRoom } from "../core/room";
import { createMonsters, type Monsters } from "./monsters";

const LAYOUT: RoomLayout = { width: 5, height: 4, tiles: ["#####", "#...#", "#...#", "#####"] };
const room = parseRoom(LAYOUT);
const CONFIG: MonsterConfig = {
  spawn_delay_ms: 1000,
  respawn_ms: 3000,
  move_ms: 500,
  loot_ttl_ms: 9000,
  spawns: [{ token: "print", pos: { x: 1, y: 1 }, glyph: "👾", name: "print" }],
};

let layer: HTMLElement;
let monsters: Monsters;
let loot: { token: string; cell: { x: number; y: number }; ttl: number }[];

beforeEach(() => {
  vi.useFakeTimers();
  loot = [];
  layer = document.createElement("div");
  document.body.appendChild(layer);
  monsters = createMonsters({
    room,
    config: CONFIG,
    layer,
    tile: () => 40,
    isFree: () => true,
    onLoot: (token, cell, _kind, ttl) => loot.push({ token, cell, ttl }),
    rng: () => 0,
  });
});

afterEach(() => {
  monsters.teardown();
  layer.remove();
  vi.useRealTimers();
});

const el = () => layer.querySelector<HTMLElement>(".tile-monster")!;

describe("the telegraph gate", () => {
  it("shows the indicator FIRST, and it is neither solid nor attackable", () => {
    vi.advanceTimersByTime(700); // past the staggered opening fuse, before the spawn delay
    expect(el().classList.contains("telegraph")).toBe(true);
    expect(el().hidden).toBe(false);
    expect(monsters.occupies({ x: 1, y: 1 })).toBe(false); // walk right through it
    expect(monsters.attackAt({ x: 1, y: 1 })).toBe(false); // nothing to hit yet
  });

  it("becomes solid and attackable only after the spawn delay", () => {
    vi.advanceTimersByTime(700 + 1100);
    expect(el().classList.contains("active")).toBe(true);
    expect(monsters.occupies({ x: 1, y: 1 })).toBe(true);
    expect(el().textContent).toContain("print"); // it carries a visible name/token
  });
});

describe("fighting", () => {
  const bringUp = () => vi.advanceTimersByTime(1800);

  it("a landed hit reports true and flashes", () => {
    bringUp();
    expect(monsters.attackAt({ x: 1, y: 1 })).toBe(true);
    expect(el().classList.contains("hurt")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(el().classList.contains("hurt")).toBe(false);
  });

  it("a swing at empty air reports false", () => {
    bringUp();
    expect(monsters.attackAt({ x: 2, y: 2 })).toBe(false);
  });

  it("defeat hands the LOOT to the host, on the cell it fell on", () => {
    bringUp();
    monsters.attackAt({ x: 1, y: 1 });
    expect(loot).toEqual([{ token: "print", cell: { x: 1, y: 1 }, ttl: 9000 }]);
    expect(monsters.occupies({ x: 1, y: 1 })).toBe(false); // the body is gone
    expect(el().hidden).toBe(true);
  });

  it("takes as many hits as the level authored", () => {
    const tough = createMonsters({
      room, layer, tile: () => 40, isFree: () => true, rng: () => 0,
      config: { ...CONFIG, spawns: [{ token: "5", pos: { x: 2, y: 1 }, hp: 2 }] },
      onLoot: (token, cell, _k, ttl) => loot.push({ token, cell, ttl }),
    });
    vi.advanceTimersByTime(1800);
    expect(tough.attackAt({ x: 2, y: 1 })).toBe(true);
    expect(loot).toHaveLength(0); // still standing after one hit
    expect(tough.attackAt({ x: 2, y: 1 })).toBe(true);
    expect(loot.map((l) => l.token)).toEqual(["5"]);
    tough.teardown();
  });

  it("a defeated slot comes back — loot lost to a pit can never strand a level", () => {
    bringUp();
    monsters.attackAt({ x: 1, y: 1 });
    vi.advanceTimersByTime(3200); // past respawn_ms
    expect(el().hidden).toBe(false);
    expect(el().classList.contains("telegraph")).toBe(true);
  });
});

describe("thief behavior", () => {
  // Fast, round numbers so "well past setup" is a single generous advance, same style
  // as the carrier tests' bringUp(). Thief spawns at (1,1); a steal target at (2,1) is
  // already IN REACH the instant it goes active — no chase needed to exercise the steal.
  const THIEF_CONFIG: MonsterConfig = {
    spawn_delay_ms: 200, respawn_ms: 1000, move_ms: 100, loot_ttl_ms: 9000,
    digest_ms: 400, steal_cooldown_ms: 200,
    spawns: [{ behavior: "thief", pos: { x: 1, y: 1 }, glyph: "🦝" }],
  };
  const bringUp = () => vi.advanceTimersByTime(600); // past down+telegraph+one move tick

  // A layer OF ITS OWN — the outer beforeEach already fills the shared `layer` with a
  // CARRIER monster (module-level CONFIG), and thiefEl() would otherwise pick that one up
  // instead of the thief this block is actually testing.
  let thiefLayer: HTMLElement;
  const thiefEl = () => thiefLayer.querySelector<HTMLElement>(".tile-monster")!;
  /** Wherever it actually is — deterministic (rng: () => 0) but not worth hand-tracing
   *  through every wander/chase step by hand; read it back off the drawn transform. */
  function cellOf(el: HTMLElement): { x: number; y: number } {
    const m = /translate\((\d+)px, (\d+)px\)/.exec(el.style.transform)!;
    return { x: Number(m[1]) / 40, y: Number(m[2]) / 40 };
  }

  beforeEach(() => {
    thiefLayer = document.createElement("div");
    document.body.appendChild(thiefLayer);
  });
  afterEach(() => thiefLayer.remove());

  function makeThief(opts: {
    stealTargets?: () => { x: number; y: number }[];
    takeToken?: (cell: { x: number; y: number }) => string | null;
    inputBlocked?: () => boolean;
  } = {}) {
    return createMonsters({
      room, layer: thiefLayer, tile: () => 40, isFree: () => true, rng: () => 0,
      config: THIEF_CONFIG,
      onLoot: (token, cell, _k, ttl) => loot.push({ token, cell, ttl }),
      stealTargets: opts.stealTargets ?? (() => [{ x: 2, y: 1 }]),
      takeToken: opts.takeToken ?? ((c) => (c.x === 2 && c.y === 1 ? "hello" : null)),
      inputBlocked: opts.inputBlocked,
    });
  }

  it("hunts once active — the .hunting tell appears before anything is taken", () => {
    // Nothing to steal yet: still correctly "hunting" (cooldown elapsed, empty-handed,
    // actively prowling) — the tell is about READINESS, not about a target existing.
    const thief = makeThief({ stealTargets: () => [] });
    bringUp();
    expect(thiefEl().classList.contains("tile-monster-thief")).toBe(true);
    expect(thiefEl().classList.contains("hunting")).toBe(true);
    expect(thiefEl().classList.contains("carrying")).toBe(false);
    thief.teardown();
  });

  it("reaching a target calls takeToken and starts carrying what it returns", () => {
    const thief = makeThief();
    bringUp();
    expect(thiefEl().classList.contains("carrying")).toBe(true);
    expect(thiefEl().classList.contains("hunting")).toBe(false);
    expect(thiefEl().textContent).toContain("hello"); // the STOLEN token, not an authored name
    thief.teardown();
  });

  it("a target that vanished before it was reached (takeToken → null) leaves the thief hunting", () => {
    const thief = makeThief({ takeToken: () => null });
    bringUp();
    expect(thiefEl().classList.contains("carrying")).toBe(false);
    expect(thiefEl().classList.contains("hunting")).toBe(true);
    thief.teardown();
  });

  it("killing it WHILE CARRYING drops the stolen token, not an authored one", () => {
    const thief = makeThief();
    bringUp(); // now carrying "hello" (it may have wandered a step or two since)
    const cell = cellOf(thiefEl());
    expect(thief.attackAt(cell)).toBe(true);
    expect(loot).toEqual([{ token: "hello", cell, ttl: 9000 }]);
    thief.teardown();
  });

  it("killing an EMPTY-HANDED (merely hunting) thief drops NOTHING", () => {
    const thief = makeThief({ stealTargets: () => [] }); // nothing to steal at all
    bringUp();
    expect(thiefEl().classList.contains("carrying")).toBe(false);
    expect(thief.attackAt(cellOf(thiefEl()))).toBe(true); // still a landed hit, wherever it wandered to
    expect(loot).toEqual([]); // but nothing paid out
    thief.teardown();
  });

  it("letting the rescue window run out digests the object — gone, no loot, thief survives", () => {
    const thief = makeThief();
    bringUp(); // carrying
    vi.advanceTimersByTime(500); // past digest_ms
    expect(thiefEl().classList.contains("carrying")).toBe(false);
    expect(loot).toEqual([]); // digested, not dropped
    expect(thiefEl().hidden).toBe(false); // the thief itself is untouched — still active
    thief.teardown();
  });

  it("marks the at-risk cell while hunting, clears once it starts carrying", () => {
    const thief = makeThief({ stealTargets: () => [{ x: 2, y: 1 }] });
    vi.advanceTimersByTime(300); // active, hunting, not yet in reach
    const marker = thiefLayer.querySelector<HTMLElement>(".room-steal-target");
    expect(marker).toBeTruthy();
    expect(marker!.hidden).toBe(false);
    bringUp(); // now carrying — nothing is "about to go" anymore
    expect(marker!.hidden).toBe(true);
    thief.teardown();
  });

  it("flashes the ROBBED cell the instant a steal lands", () => {
    const thief = makeThief();
    bringUp(); // the steal already landed by here
    const flash = thiefLayer.querySelector<HTMLElement>(".room-steal-flash");
    expect(flash).toBeTruthy();
    vi.advanceTimersByTime(400); // past STEAL_FLASH_MS
    expect(thiefLayer.querySelector(".room-steal-flash")).toBeNull(); // self-removed
    thief.teardown();
  });

  it("puffs where the object was last seen when it digests", () => {
    // A ONE-SHOT takeToken (realistic: once taken, that cell is truly empty) — the
    // default stub would let the thief steal the SAME "target" again after its
    // cooldown, digest a second time, and create a second puff mid-window.
    let taken = false;
    const thief = makeThief({ takeToken: () => (taken ? null : ((taken = true), "hello")) });
    bringUp(); // carrying
    vi.advanceTimersByTime(500); // past digest_ms
    const puff = thiefLayer.querySelector<HTMLElement>(".room-digest-puff");
    expect(puff).toBeTruthy();
    vi.advanceTimersByTime(800); // past DIGEST_PUFF_MS
    expect(thiefLayer.querySelector(".room-digest-puff")).toBeNull();
    thief.teardown();
  });

  it("inputBlocked freezes the hunt — no steal fires while the player can't respond", () => {
    let blocked = true;
    const takeToken = vi.fn(() => "hello");
    const thief = makeThief({ inputBlocked: () => blocked, takeToken });
    bringUp();
    expect(takeToken).not.toHaveBeenCalled();
    expect(thiefEl().classList.contains("carrying")).toBe(false);
    blocked = false;
    vi.advanceTimersByTime(300);
    expect(takeToken).toHaveBeenCalled();
    expect(thiefEl().classList.contains("carrying")).toBe(true);
    thief.teardown();
  });
});

describe("teardown", () => {
  it("stops the clock and drops the DOM", () => {
    vi.advanceTimersByTime(1800);
    monsters.teardown();
    expect(layer.querySelector(".tile-monster")).toBeNull();
    const before = loot.length;
    vi.advanceTimersByTime(10000); // nothing should still be running
    expect(loot.length).toBe(before);
    expect(layer.querySelector(".tile-monster")).toBeNull();
  });
});
