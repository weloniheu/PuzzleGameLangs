// @vitest-environment jsdom
// The THIEF loop, end to end through the real host: place a token → a thief hunts it
// down and steals it off the board (the build re-dirties) → kill it in time and it
// drops what it took → re-place, Build, Run, solved. This is the mechanic's whole
// promise — CLAUDE.md Rule 2 (mechanics are engine, everything specific is content) and
// Rule 3 (validate by order, never execute) both stay intact: the thief just changes
// WHICH tokens are on the board, never how Build/Run checks them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Puzzle, RoomLayout } from "../schema/types";
import { mountRoom, type RoomHandle } from "./roomHost";

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

// A long, straight, obstruction-free corridor along y=1: the thief spawns at the far end
// from the coding area, so its chase is a deterministic straight-line walk (no wander
// fallback needed — chaseStep never has to guess) regardless of the rng seam.
//
//   #######
//   #.....#   row 1: coding area at x=1..2, thief spawns at x=5
//   #.....#   row 2: Build at x=1, Run at x=2
//   #.....#   row 3: player spawns x=3, pile "print" at x=5
//   #######
const LAYOUT: RoomLayout = {
  width: 7, height: 5,
  tiles: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
  spawn: { x: 3, y: 3 },
  features: ["coding_area", "inventory", "monsters"],
  inventory_slots: 3,
  coding_area: { x: 1, y: 1, width: 2, height: 1 },
  piles: [{ token: "print", pos: { x: 5, y: 3 }, kind: "function" }],
  controls: [
    { action: "build", label: "Build", pos: { x: 1, y: 2 } },
    { action: "run", label: "Run", pos: { x: 2, y: 2 } },
  ],
  monsters: {
    spawn_delay_ms: 100, respawn_ms: 60000, move_ms: 100,
    digest_ms: 100000, steal_cooldown_ms: 100000, loot_ttl_ms: 60000,
    spawns: [{ behavior: "thief", pos: { x: 5, y: 1 }, glyph: "🦝" }],
  },
};

const ARENA: Puzzle = {
  id: "test-thief-arena", schema_version: "1.0.0", language: "test", puzzle_type: "code_build",
  validator_type: "code_match", difficulty: 1,
  prompt: "", payload: { scenario: "", goal: "", tokens: [{ text: "print", kind: "function" }] },
  solution: { output: "hi", lines: [{ content: ["print"], indent: 0 }] },
  hints: [], metadata: { reviewed: true },
  room: LAYOUT,
};

let c: HTMLElement;
let handle: RoomHandle;
let solved = false;

const viewport = () => c.querySelector(".room-viewport") as HTMLElement;
const press = (key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    viewport().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};
const placedCount = () => c.querySelectorAll(".tile-placed").length;
const thiefEl = () => c.querySelector<HTMLElement>(".tile-monster-thief")!;
const dropped = () => [...c.querySelectorAll<HTMLElement>(".room-dropped")];
const debugText = () => (c.querySelector(".room-debug") as HTMLElement).textContent ?? "";
/** Advance the fake clock in MONSTER_TICK_MS-sized steps, stopping the INSTANT `cond`
 *  is true — so an assertion right after sees the state at exactly that tick, not
 *  several more ticks of chasing/wandering past it. */
function advanceUntil(cond: () => boolean, stepMs = 100, maxMs = 5000) {
  for (let t = 0; t < maxMs; t += stepMs) {
    vi.advanceTimersByTime(stepMs);
    if (cond()) return;
  }
  throw new Error("advanceUntil: condition never became true");
}
/** Fetch "print" from its pile and place it at (1,1), the coding area's near cell. */
function fetchAndPlace() {
  press("ArrowRight", 2); // (3,3) → (5,3), the pile
  press("i");             // pick up
  press("ArrowLeft", 4);  // → (1,3)
  press("ArrowUp", 2);    // → (1,2) → (1,1), inside the coding area
  press("p");             // place at (1,1), indent 0
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = "";
  c = document.createElement("div");
  document.body.appendChild(c);
  solved = false;
  handle = mountRoom(c, ARENA, { onSolved: () => { solved = true; } });
  press("Escape"); // no guided tutorial on this synthetic room, but harmless if idle
});

afterEach(() => {
  handle?.teardown();
  vi.useRealTimers();
});

describe("a thief hunts down a PLACED token and steals it", () => {
  it("removes the token from the board and re-dirties an already-built line", () => {
    fetchAndPlace();
    expect(placedCount()).toBe(1);

    // Build it, and confirm the debug readout agrees it's built (not dirty).
    press("ArrowDown"); // (1,1) → (1,2), the Build control
    press("Enter");
    press("`"); // debug on
    expect(debugText()).toContain("built");

    // Let the (already-active) thief chase down the corridor and steal it. It spawned
    // at (5,1); the token sits at (1,1) — a straight, unobstructed walk along row 1.
    advanceUntil(() => placedCount() === 0);

    expect(placedCount()).toBe(0); // the token is OFF the board
    expect(debugText()).toContain("dirty"); // theft undoes Build — must Build again
    expect(thiefEl().classList.contains("carrying")).toBe(true);
    expect(thiefEl().textContent).toContain("print"); // it carries what it took, not a fixed name
  });

  it("killing it mid-carry drops the stolen token; re-placing and running SOLVES the level", () => {
    fetchAndPlace();
    // advanceUntil stops on the EXACT tick the steal fires, so the thief hasn't taken a
    // wander step since — it's still sitting one cell short of where it stole from
    // (chaseStep never walks onto the target's own cell; see core/monsters.ts).
    advanceUntil(() => placedCount() === 0);
    // Player is at (1,1) (fetchAndPlace's last move); the thief is at (2,1) — adjacent,
    // to the right.
    press("ArrowRight"); // blocked by the solid thief, but the slime now FACES it
    press("f");
    expect(dropped()).toHaveLength(1);
    expect(dropped()[0].classList.contains("room-loot")).toBe(true);
    // 8a's loot tag: the drop keeps the THIEF accent, so it still reads as "that
    // thing's" once the body is gone.
    expect(dropped()[0].classList.contains("room-loot-thief")).toBe(true);
    expect(dropped()[0].textContent).toBe("print");

    // The cell is free now — walk onto the drop (auto-pickup), carry it back to (1,1),
    // and place it there (indent 0, matching the answer).
    press("ArrowRight"); // (1,1) → (2,1): picks the loot back up
    expect(c.querySelector(".room-inventory-slot")!.textContent).toContain("print");
    press("ArrowLeft");  // (2,1) → (1,1)
    press("p");
    expect(placedCount()).toBe(1);

    press("ArrowDown");  // (1,1) → (1,2), Build
    press("Enter");
    press("ArrowRight"); // (1,2) → (2,2), Run
    press("Enter");

    expect(solved).toBe(true);
  });
});
