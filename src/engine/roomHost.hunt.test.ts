// @vitest-environment jsdom
// The HUNT levels, end to end through the real host: the shipped pack data mounts, a
// monster comes up where the level said it would, F kills it, and the token it was
// carrying is on the floor to be walked over. This is the wiring the smoke test doesn't
// walk (it takes the pile route), and it is the whole promise of the monster levels —
// if it breaks, the level's tokens are unreachable and it cannot be finished at all.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack, Puzzle } from "../schema/types";
import { mountRoom, type RoomHandle } from "./roomHost";

const ROOT = join(__dirname, "..", "..");
const pack: Pack = JSON.parse(readFileSync(join(ROOT, "content/packs/python.code.v1.json"), "utf8"));
const level = (id: string) => pack.puzzles.find((p) => p.id === id)! as Puzzle;

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

let c: HTMLElement;
let handle: RoomHandle;

const viewport = () => c.querySelector(".room-viewport") as HTMLElement;
const press = (key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    viewport().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};
const monsterEls = () =>
  [...c.querySelectorAll<HTMLElement>(".room-monster-layer .tile-monster")].filter((e) => !e.hidden);
const dropped = () => [...c.querySelectorAll<HTMLElement>(".room-dropped")];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = "";
  c = document.createElement("div");
  document.body.appendChild(c);
});

afterEach(() => {
  handle?.teardown();
  vi.useRealTimers();
});

describe("py-code-hunt-000 — the tokens are on monsters", () => {
  beforeEach(() => {
    handle = mountRoom(c, level("py-code-hunt-000"));
    press("Escape"); // skip the entry tutorial so gameplay keys are live
  });

  it("ships no piles at all — every token has to be fought for", () => {
    expect(c.querySelectorAll(".tile-pile")).toHaveLength(0);
    expect(c.querySelector(".room-monster-layer")).toBeTruthy();
  });

  it("telegraphs before anything is attackable, then materializes", () => {
    // The first slot's opening fuse is half the spawn delay (they are staggered, so a
    // six-monster den doesn't pop on one frame) — 700ms here.
    vi.advanceTimersByTime(800);
    const early = monsterEls();
    expect(early.length).toBeGreaterThan(0);
    expect(early.every((e) => e.classList.contains("telegraph"))).toBe(true);
    vi.advanceTimersByTime(1600); // past spawn_delay_ms (1400)
    expect(monsterEls().some((e) => e.classList.contains("active"))).toBe(true);
  });

  it("every token the answer needs is carried by some monster", () => {
    const carried = new Set(level("py-code-hunt-000").room!.monsters!.spawns.map((m) => m.token));
    for (const line of (level("py-code-hunt-000").solution as { lines: { content: string[] }[] }).lines) {
      for (const tok of line.content) expect(carried.has(tok)).toBe(true);
    }
  });
});

// The full loop, on a synthetic room so the wander can be frozen (move_ms far in the
// future) and the fight is deterministic: face it → F → it drops → walk on → it's yours.
describe("the fight → loot → pickup loop", () => {
  const arena: Puzzle = {
    ...level("py-code-hunt-000"),
    id: "test-hunt-arena",
    room: {
      width: 5, height: 4,
      tiles: ["#####", "#...#", "#...#", "#####"],
      spawn: { x: 2, y: 2 },
      features: ["inventory", "monsters"],
      inventory_slots: 3,
      monsters: {
        spawn_delay_ms: 100, respawn_ms: 60000, move_ms: 999999, loot_ttl_ms: 60000,
        spawns: [{ token: "print", pos: { x: 2, y: 1 }, glyph: "👾", name: "print" }],
      },
    },
  };

  beforeEach(() => {
    handle = mountRoom(c, arena);
    press("Escape");
    vi.advanceTimersByTime(400); // telegraph (50ms fuse) → active (100ms delay)
  });

  it("an active monster is SOLID — you cannot walk through the thing holding your token", () => {
    const before = (c.querySelector(".slime") as HTMLElement).style.transform;
    press("ArrowUp");
    expect((c.querySelector(".slime") as HTMLElement).style.transform).toBe(before);
  });

  it("F drops its token as loot, and walking onto the drop takes it", () => {
    press("ArrowUp");   // blocked by the monster, but the slime now FACES it
    expect(dropped()).toHaveLength(0);
    press("f");
    expect(monsterEls()).toHaveLength(0);           // defeated
    expect(dropped()).toHaveLength(1);
    expect(dropped()[0].classList.contains("room-loot")).toBe(true);
    // An undeclared behavior IS a carrier, so the drop wears the carrier accent (8a).
    expect(dropped()[0].classList.contains("room-loot-carrier")).toBe(true);
    expect(dropped()[0].textContent).toBe("print");

    press("ArrowUp");   // the cell is free now — walk on and auto-pickup fires
    expect(dropped()).toHaveLength(0);
    expect(c.querySelector(".room-inventory-slot")!.textContent).toContain("print");
  });

  it("a swing at empty air still shows the swipe (a miss must not read as a dead key)", () => {
    press("ArrowDown"); // face away from the monster
    press("f");
    expect(c.querySelector(".room-attack-swipe")).toBeTruthy();
    expect(monsterEls()).toHaveLength(1); // untouched
  });
});

describe("py-code-hunt-001 — tougher carriers", () => {
  it("authors two-hit monsters and shows their hearts", () => {
    handle = mountRoom(c, level("py-code-hunt-001"));
    press("Escape");
    vi.advanceTimersByTime(3000);
    const hearts = [...c.querySelectorAll(".tile-monster-hp")].map((e) => e.textContent);
    expect(hearts.some((h) => h === "♥♥")).toBe(true);
  });
});

describe("py-code-bugs-000 — the debut THIEF level", () => {
  it("ships piles (not monster-carried tokens) and a thief with no fixed cargo", () => {
    const lvl = level("py-code-bugs-000");
    expect((lvl.room?.piles ?? []).length).toBeGreaterThan(0);
    const spawns = lvl.room?.monsters?.spawns ?? [];
    expect(spawns.some((m) => m.behavior === "thief")).toBe(true);
    expect(spawns.every((m) => m.behavior !== "thief" || m.token === undefined)).toBe(true);
    expect(lvl.tutorial_refs).toContain("mechanic:thieves");
  });

  it("is winnable from its own authored piles — the thief is a hazard, not the only source", () => {
    // No vi.advanceTimersByTime calls here at all: the monster clock is a setInterval,
    // so with fake timers never advanced the thief never even telegraphs. This proves
    // the level solves on its PILES alone, independent of whatever the thief does.
    let solved = false;
    handle = mountRoom(c, level("py-code-bugs-000"), { onSolved: () => { solved = true; } });
    press("Escape");

    // Fetch, in an order that lines up with FIFO placement (piles are infinite — the
    // room's one "msg" pile is visited twice): msg, =, "bug", print, msg.
    press("ArrowRight", 4); press("ArrowUp", 2); press("i");   // (5,3) → (9,1) msg
    press("ArrowLeft"); press("ArrowDown"); press("i");        // → (8,2) =
    press("ArrowRight"); press("i");                           // → (9,2) "bug"
    press("ArrowLeft"); press("ArrowUp"); press("i");          // → (8,1) print
    press("ArrowRight"); press("i");                           // → (9,1) msg again
    expect(c.querySelectorAll(".room-inventory-slot.empty")).toHaveLength(0); // all 5 slots full

    // Place: msg = "bug" on row 1, print msg on row 2 (indent 0 both lines).
    press("ArrowLeft", 8); press("p");  // (1,1) msg
    press("ArrowRight"); press("p");    // (2,1) =
    press("ArrowRight"); press("p");    // (3,1) "bug"
    press("ArrowLeft", 2); press("ArrowDown"); press("p"); // (1,2) print
    press("ArrowRight"); press("p");    // (2,2) msg
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(5);

    press("ArrowLeft"); press("ArrowDown", 2); press("Enter"); // (1,4) Build
    press("ArrowRight", 2); press("Enter");                    // (3,4) Run

    expect(solved).toBe(true);
  });

  it("telegraphs, then becomes an active, solid thief once its spawn delay elapses", () => {
    handle = mountRoom(c, level("py-code-bugs-000"));
    press("Escape");
    vi.advanceTimersByTime(2400); // past the opening fuse (750) + spawn_delay_ms (1500)
    const el = c.querySelector<HTMLElement>(".tile-monster-thief")!;
    expect(el).toBeTruthy();
    expect(el.classList.contains("active")).toBe(true);
    expect(el.hidden).toBe(false);
  });
});
