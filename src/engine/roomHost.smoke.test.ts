// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Room host SMOKE test (the one jsdom test — everything else stays node/pure).
// Mounts the REAL packs through the REAL manager (the same wiring main.bootHub
// uses), drives the game with actual keyboard events, and walks the full loop:
//
//   hub (guided tutorial) → walk → Coding door → level 001 → pick up / place
//   print hello world → Build → Run (success + unlock) → menu portal → back
//   to the hub → clean teardown.
//
// This locks the mount/teardown ordering, the input→action routing, the
// module registry dispatch, and the transition sequence end-to-end.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LevelEntry, Pack, Puzzle, PuzzleType } from "../schema/types";
import { createRoomManager, type RoomManager } from "./roomManager";

const ROOT = join(__dirname, "..", "..");
const loadPack = (rel: string): Pack => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

// jsdom has no rAF unless "pretending to be visual" — the dialogue slide-in uses it.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

function bootWorld() {
  const hub = loadPack("content/packs/hub.test.v1.json");
  const code = loadPack("content/packs/python.code.v1.json");
  const registry = new Map<string, Puzzle>();
  for (const p of [...hub.puzzles, ...code.puzzles]) registry.set(p.id, p);
  const levelsByType = new Map<PuzzleType, LevelEntry[]>();
  for (const pack of [hub, code]) {
    for (const prog of pack.progression ?? []) {
      levelsByType.set(prog.puzzle_type, [...(levelsByType.get(prog.puzzle_type) ?? []), ...prog.levels]);
    }
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const manager = createRoomManager(
    container,
    (id) => registry.get(id) ?? null,
    (t) => levelsByType.get(t) ?? [],
  );
  return { container, manager };
}

const viewport = (c: HTMLElement) => c.querySelector(".room-viewport") as HTMLElement;
const press = (c: HTMLElement, key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    viewport(c).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};
const text = (c: HTMLElement, sel: string) =>
  (c.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const slimeAt = (c: HTMLElement) =>
  (c.querySelector(".slime") as HTMLElement).style.transform;

let world: { container: HTMLElement; manager: RoomManager };

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  world = bootWorld();
});

describe("roomHost smoke — hub → level → solve → back, through the real manager", () => {
  it("plays the whole loop with real packs and real key events", () => {
    const { container: c, manager } = world;

    // --- HUB: mounts with world, four door portals, the slime, the tutorial ---
    manager.enter("hub");
    expect(c.querySelector(".room-world")).toBeTruthy();
    expect(c.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(c.querySelector(".slime")).toBeTruthy();
    expect(text(c, ".room-narrator")).toContain("Welcome to Puzzle Patch");

    // Tutorial: Enter past beat 1; beat 2 waits for an ACTUAL move.
    press(c, "Enter");
    expect(text(c, ".room-narrator")).toContain("Move around");
    const before = slimeAt(c);
    press(c, "ArrowLeft"); // (6,4) → (5,4): satisfies waitFor "move"
    expect(slimeAt(c)).not.toBe(before);
    expect(text(c, ".room-narrator")).toContain("Settings");
    press(c, "Enter"); // → final step: waits for enter_door

    // PROBE a blocked door: the coming_soon Logic portal interjects, tutorial resumes after.
    press(c, "ArrowUp", 2); // (5,4) → (5,2) Logic door
    press(c, "Enter");
    expect(text(c, ".room-narrator")).toContain("coming soon");
    press(c, "Enter"); // dismiss the interjection → the stashed tutorial RESUMES
    expect(text(c, ".room-narrator")).toContain("Coding door");

    // Walk to the OPEN Coding door and go through → the manager swaps rooms.
    press(c, "ArrowLeft", 3); // (5,2) → (2,2)
    press(c, "Enter");

    // --- LEVEL 001: terminal + piles + menu portal; snake on_enter plays ---
    expect(c.querySelector(".room-terminal")).toBeTruthy();
    expect(c.querySelectorAll(".tile-pile")).toHaveLength(5);
    expect(text(c, ".room-dialogue")).toContain("Welcome to the play house");
    press(c, "Enter", 4); // through the on_enter beats → tutorial step 1
    expect(text(c, ".room-narrator")).toContain("code puzzle");
    press(c, "Enter");    // → waits for pickup

    // Pick up print / hello / world (FIFO), from spawn (6,7).
    press(c, "ArrowUp");           // (6,6)
    press(c, "ArrowRight", 3);     // (9,6) print pile
    press(c, "i");
    expect(text(c, ".room-inventory")).toContain("print");
    expect(text(c, ".room-narrator")).toContain("press P"); // tutorial advanced to "place"
    press(c, "ArrowRight");        // (10,6) hello
    press(c, "i");
    press(c, "ArrowRight");        // (11,6) world
    press(c, "i");

    // Place the line at indent 0: (1,1) (2,1) (3,1).
    press(c, "ArrowUp", 5);        // (11,1)
    press(c, "ArrowLeft", 10);     // (1,1) — the coding area's left edge
    press(c, "p");
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(1);
    expect(text(c, ".room-narrator")).toContain("Build"); // tutorial advanced to "build"
    press(c, "ArrowRight");
    press(c, "p");
    press(c, "ArrowRight");
    press(c, "p");
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(3);

    // PROBE the debug readout (position-dependent, module-owned).
    press(c, "`");
    expect(text(c, ".room-debug")).toContain("[print, hello, world]");
    expect(text(c, ".room-debug")).toContain("indent=0");
    press(c, "`");

    // Build, then Run → success beat + terminal output + earned unlock.
    press(c, "ArrowDown", 6);      // (3,7)
    press(c, "ArrowLeft");         // (2,7) Build
    press(c, "Enter");
    expect(text(c, ".room-terminal-body")).toContain("compiled");
    expect(text(c, ".room-narrator")).toContain("Run"); // tutorial advanced to "run"
    press(c, "ArrowRight", 3);     // (5,7) Run
    press(c, "Enter");
    expect(text(c, ".room-terminal-body")).toContain("hello world");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(true);
    expect(text(c, ".room-dialogue").length).toBeGreaterThan(0); // snake success beat
    press(c, "Enter"); // dismiss it

    // PROBE the esc ladder: settings opens from the plain room, esc backs out.
    press(c, "Escape");
    expect(text(c, ".room-settings-card")).toContain("Settings");
    press(c, "Escape");
    expect((c.querySelector(".room-settings-panel") as HTMLElement).hidden).toBe(true);

    // Menu portal at spawn → chooser lists Hub + level 1 + the JUST-UNLOCKED level 2.
    press(c, "ArrowRight");        // (6,7) spawn / menu portal
    press(c, "Enter");
    const options = [...c.querySelectorAll(".room-destmenu-option")].map((b) => b.textContent);
    expect(options).toHaveLength(3);
    expect(options[0]).toContain("Hub");
    press(c, "Enter");             // select Hub → teleport away

    // --- BACK IN THE HUB: fresh mount, tutorial done (completed → no beats) ---
    expect(c.querySelectorAll(".room-world")).toHaveLength(1); // no stacked rooms
    expect(c.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(c.querySelector(".room-terminal")).toBeNull(); // hub declares no terminal
    expect((c.querySelector(".room-narrator") as HTMLElement).hidden).toBe(true);

    // Movement still single-fires after two transitions (no leaked listeners).
    const back = slimeAt(c);
    press(c, "ArrowRight");
    expect(slimeAt(c)).not.toBe(back);

    // --- TEARDOWN: everything the room created is gone; a second run is safe ---
    manager.teardown();
    expect(c.innerHTML).toBe("");
    manager.teardown(); // idempotent
  });

  it("inventory focus toggles with i and esc returns to the room (not settings)", () => {
    const { container: c, manager } = world;
    manager.enter("hub");
    press(c, "Enter");      // tut-1
    press(c, "ArrowLeft");  // tut-2 (move)
    press(c, "Enter");      // tut-3 → tut-4 waits enter_door (input passes through)

    press(c, "i"); // empty floor → inventory focus
    expect(c.querySelector(".room-inventory")!.classList.contains("focused")).toBe(true);
    press(c, "Escape"); // esc ladder: exit inventory, do NOT open settings
    expect(c.querySelector(".room-inventory")!.classList.contains("focused")).toBe(false);
    expect((c.querySelector(".room-settings-panel") as HTMLElement).hidden).toBe(true);
  });
});
