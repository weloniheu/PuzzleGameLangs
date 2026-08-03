// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Room host SMOKE test (the one jsdom test — everything else stays node/pure).
// Mounts the REAL packs through the REAL manager (the same wiring main.bootHub
// uses), drives the game with actual keyboard events, and walks the full loop:
//
//   hub (guided tutorial) → walk → Coding door → the coding TUTORIAL room →
//   pick up / place print hi → Build → Run (success + unlock) → menu portal →
//   back to the hub → clean teardown.
//
// This locks the mount/teardown ordering, the input→action routing, the
// module registry dispatch, and the transition sequence end-to-end.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack, Puzzle, PuzzleType, TutorialBlock } from "../schema/types";
import { createRoomManager, type RoomManager, type TypeLadder } from "./roomManager";
import { resolveMechanic, type LadderLevel } from "./core/ladder";
import { addUnlock, completeTutorial } from "./core/codex";
import { roomSettings } from "./systems/settingsPanel";

const ROOT = join(__dirname, "..", "..");
const loadPack = (rel: string): Pack => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

// jsdom has no rAF unless "pretending to be visual" — the dialogue slide-in uses it.
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}
// Serve runtime fetches (the logic module loads its LOGIC pack by URL) from disk.
globalThis.fetch = (async (url: unknown) =>
  new Response(readFileSync(join(ROOT, String(url)), "utf8"), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

function bootWorld() {
  const hub = loadPack("content/packs/hub.test.v1.json");
  const code = loadPack("content/packs/python.code.v1.json");
  const logic = loadPack("content/packs/logic.room.en.v1.json");
  const logicHaw = loadPack("content/packs/logic.room.haw.v1.json");
  const grammar = loadPack("content/packs/grammar.room.en.v1.json");
  const vocab = loadPack("content/packs/vocab.room.haw.v1.json");
  const vocabEn = loadPack("content/packs/vocab.room.en.v1.json");
  const registry = new Map<string, Puzzle>();
  for (const p of [...hub.puzzles, ...code.puzzles, ...logic.puzzles, ...logicHaw.puzzles, ...grammar.puzzles, ...vocab.puzzles, ...vocabEn.puzzles]) {
    registry.set(p.id, p);
  }
  const laddersByType = new Map<PuzzleType, TypeLadder>();
  const tutorialsById = new Map<string, TutorialBlock>();
  for (const pack of [hub, code, logic, logicHaw, grammar, vocab, vocabEn]) {
    for (const prog of pack.progression ?? []) {
      const ladder = laddersByType.get(prog.puzzle_type) ?? { levels: [], lockedLanguages: [] };
      const stamped: LadderLevel[] = prog.levels.map((lv) => ({
        ...lv,
        language: lv.language ?? pack.language,
        languageLabel: pack.language_label,
        mechanic: lv.mechanic ?? resolveMechanic(registry.get(lv.id)),
      }));
      ladder.levels.push(...stamped);
      ladder.lockedLanguages.push(...(prog.locked_languages ?? []));
      laddersByType.set(prog.puzzle_type, ladder);
    }
    for (const [id, block] of Object.entries(pack.tutorials ?? {})) tutorialsById.set(id, block);
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const manager = createRoomManager(
    container,
    (id) => registry.get(id) ?? null,
    (t) => laddersByType.get(t) ?? { levels: [], lockedLanguages: [] },
    { tutorialFor: (id) => tutorialsById.get(id) ?? null },
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
/** The speech currently ON SCREEN, whichever surface owns it: the narrator strip, the
 *  portrait box, or the GUIDED TUTORIAL card (dialogue.ts routes guided_tutorial beats
 *  to the card). Hidden surfaces keep their stale text, so visibility is checked — the
 *  card is removed from the DOM outright when it isn't showing. */
const speech = (c: HTMLElement) => {
  const parts: string[] = [];
  const narrator = c.querySelector(".room-narrator") as HTMLElement | null;
  if (narrator && !narrator.hidden) parts.push(narrator.textContent ?? "");
  const portrait = c.querySelector(".room-dialogue") as HTMLElement | null;
  if (portrait && !portrait.hidden) {
    parts.push(portrait.querySelector(".room-dialogue-text")?.textContent ?? "");
  }
  const card = c.querySelector(".tutorial-card");
  if (card) parts.push(card.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
};
// The ladder chooser's row labels (excluding the cursor-independent CURRENT tag).
const ladderLabels = (c: HTMLElement) =>
  [...c.querySelectorAll(".room-destmenu-option > span:first-child")].map((s) => s.textContent);
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
    expect(speech(c)).toContain("Welcome to Puzzle Patch");

    // Tutorial: Enter past beat 1; beat 2 waits for an ACTUAL move.
    press(c, "Enter");
    expect(speech(c)).toContain("Move around");
    const before = slimeAt(c);
    press(c, "ArrowLeft"); // (6,4) → (5,4): satisfies waitFor "move"
    expect(slimeAt(c)).not.toBe(before);
    expect(speech(c)).toContain("Settings");
    press(c, "Enter"); // → final step: waits for enter_door

    // (Every hub portal is open now, so the old coming_soon interjection probe is
    //  gone with the last blocked door.)
    // Walk to the OPEN Coding door: the portal opens the LADDER (5a) at the LANGUAGE
    // rung — Python + the coming-soon siblings, framed by ← Back / ⌂ Return to hub.
    press(c, "ArrowLeft", 4); // (5,4) → (1,4)
    press(c, "ArrowUp", 2);   // (1,4) → (1,2) Coding door
    press(c, "Enter");
    expect(text(c, ".room-destmenu-title")).toBe("Coding portal");
    expect(ladderLabels(c)).toEqual(["Python", "JavaScript", "SQL", "← Back", "⌂ Return to hub"]);
    press(c, "Enter"); // the cursor starts on Python → the MECHANIC rung
    expect(text(c, ".room-destmenu-title")).toBe("Python — mechanic");
    // Only Base has anything unlocked yet — Mixed/Explicit grey out (locked).
    expect(ladderLabels(c)).toEqual(["Base", "Mixed", "Explicit", "← Back", "⌂ Return to hub"]);
    expect([...c.querySelectorAll(".room-destmenu-option")].filter((b) => b.classList.contains("locked")))
      .toHaveLength(2);
    press(c, "Enter"); // Base → the LEVEL rung
    expect(text(c, ".room-destmenu-title")).toBe("Base — level");
    expect(ladderLabels(c)).toEqual(["Tutorial", "← Back", "⌂ Return to hub"]); // no skip-ahead
    press(c, "Enter"); // select Tutorial → the actual door transition (satisfies enter_door)

    // --- CODING TUTORIAL: terminal + piles + menu portal; snake on_enter plays ---
    expect(c.querySelector(".room-terminal")).toBeTruthy();
    expect(c.querySelectorAll(".tile-pile")).toHaveLength(3); // print, hello, world
    expect(text(c, ".room-dialogue")).toContain("Welcome to the practice pod");
    press(c, "Enter", 2); // through the on_enter beats → tutorial step 1
    expect(speech(c)).toContain("code puzzle");
    press(c, "Enter");    // → waits for pickup

    // Pick up print / hello / world (FIFO), from spawn (6,7).
    press(c, "ArrowUp");           // (6,6)
    press(c, "ArrowRight", 3);     // (9,6) print pile
    press(c, "i");
    expect(text(c, ".room-inventory")).toContain("print");
    expect(speech(c)).toContain("press P"); // tutorial advanced to "place"
    press(c, "ArrowRight");        // (10,6) hello
    press(c, "i");
    press(c, "ArrowRight");        // (11,6) world
    press(c, "i");

    // Place the line at indent 0: (1,1) (2,1) (3,1).
    press(c, "ArrowUp", 5);        // (11,1)
    press(c, "ArrowLeft", 10);     // (1,1) — the coding area's left edge
    press(c, "p");
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(1);
    expect(speech(c)).toContain("Build"); // tutorial advanced to "build"
    press(c, "ArrowRight");        // (2,1)
    press(c, "p");
    press(c, "ArrowRight");        // (3,1)
    press(c, "p");
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(3);

    // PROBE the debug readout (position-dependent, module-owned).
    press(c, "`");
    expect(text(c, ".room-debug")).toContain("[print, hello, world]");
    expect(text(c, ".room-debug")).toContain("indent=0");
    press(c, "`");

    // Build, then Run → success beat + terminal output + earned unlock.
    press(c, "ArrowDown", 6);      // (3,1) → (3,7)
    press(c, "ArrowLeft");         // (2,7) Build
    press(c, "Enter");
    expect(text(c, ".room-terminal-body")).toContain("compiled");
    expect(speech(c)).toContain("Run"); // tutorial advanced to "run"
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

    // Menu portal at spawn → the SAME ladder scoped to this type, opened ON THE RUNG
    // THE PLAYER IS IN (Python → Base → the level list) with this level highlighted,
    // and the JUST-UNLOCKED siblings showing.
    press(c, "ArrowRight");        // (5,7) → (6,7) spawn / menu portal
    press(c, "Enter");
    expect(text(c, ".room-destmenu-title")).toBe("Base — level");
    expect(ladderLabels(c)).toEqual(["Tutorial", "Variables", "← Back", "⌂ Return to hub"]);
    expect(text(c, ".room-destmenu-tag")).toBe("CURRENT"); // Tutorial is where we are
    expect([...c.querySelectorAll(".room-destmenu-option")][0].classList.contains("selected")).toBe(true);
    // ← Back climbs one rung at a time, landing on the group we came from.
    press(c, "Escape");            // → mechanic rung: Explicit just unlocked, Mixed still locked
    expect(text(c, ".room-destmenu-title")).toBe("Python — mechanic");
    const mechRows = [...c.querySelectorAll(".room-destmenu-option")];
    expect(mechRows.find((b) => b.textContent!.includes("Explicit"))!.classList.contains("locked")).toBe(false);
    expect(mechRows.find((b) => b.textContent!.includes("Mixed"))!.classList.contains("locked")).toBe(true);
    press(c, "Escape");            // → language rung
    expect(text(c, ".room-destmenu-title")).toBe("Where to?");
    expect(ladderLabels(c)).toEqual(["Python", "JavaScript", "SQL", "← Back", "⌂ Return to hub"]);
    expect(text(c, ".room-destmenu-tag")).toBe("CURRENT"); // Python holds the current level
    press(c, "ArrowDown", 4);      // Python → … → ⌂ Return to hub (always the last row)
    press(c, "Enter");             // select ⌂ → teleport away

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

  it("logic room: the hub's Logic portal mounts the TUTORIAL board; ENGINE input drives it", async () => {
    const { container: c, manager } = world;
    manager.enter("hub");
    press(c, "Enter");      // tut-1
    press(c, "ArrowLeft");  // tut-2 (move) → (5,4)
    press(c, "Enter");      // tut-3 → tut-4 waits enter_door (input passes through)
    press(c, "ArrowLeft");  // (5,4) → (4,4)
    press(c, "ArrowUp", 3); // (4,4) → (4,1) — the now-OPEN Logic door
    press(c, "Enter");      // the portal's ladder: English / ʻŌlelo Hawaiʻi (locked)
    press(c, "Enter");      // English → mechanic rung (Base)
    press(c, "Enter");      // Base → level rung (only the Tutorial unlocked)
    press(c, "Enter");      // select it → the logic tutorial (module fetches its pack)

    // The board IS the room: the ENGINE's tile grid is the board floor (13×9 =
    // an 11×7 board plus the wall ring) — no floating panel, no nested room.
    // 7 entity boxes = 6 word tiles + the flag; the SLIME entity has NO glyph
    // because the engine's slime IS it ("SLIME IS YOU" controls the player).
    await vi.waitFor(() =>
      expect(c.querySelectorAll(".logic-board-layer .logic-cell-box")).toHaveLength(7),
    );
    expect(c.querySelector(".logic-game")).toBeNull(); // the standalone panel never mounts in-room
    expect(c.querySelectorAll(".room-tile-layer .tile-room")).toHaveLength(13 * 9);
    expect(c.querySelectorAll(".room-world")).toHaveLength(1); // ONE room
    expect(c.querySelectorAll(".slime")).toHaveLength(1);      // ONE player
    expect(c.querySelector(".room-inventory")).toBeNull();     // no HUD (feature not declared)
    expect(c.querySelector(".room-terminal")).toBeNull();      // no coding furniture

    // The room's own guided tutorial: step 1 waits for Enter; step 2 waits for a
    // REAL move (the module reports it — arrows pass through while it shows).
    expect(speech(c)).toContain("RULES");
    press(c, "Enter");
    expect(speech(c)).toContain("arrow key");
    const slime0 = slimeAt(c);
    const board0 = c.querySelector(".logic-board-layer")!.innerHTML;
    press(c, "ArrowRight");              // the you-entity moves → advances the tutorial
    expect(slimeAt(c)).not.toBe(slime0); // the slime IS the controlled entity
    expect(speech(c)).toContain("FLAG IS WIN");
    press(c, "Enter"); // → the undo/reset step
    press(c, "Enter"); // tutorial done

    press(c, "u"); // the shared undo binding routes to the module
    expect(c.querySelector(".logic-board-layer")!.innerHTML).toBe(board0);
    expect(slimeAt(c)).toBe(slime0); // undo pulls the player back too

    // Enter while NOT won falls through to the engine's menu portal (under the
    // slime's start cell) → the ladder opens on THIS level's rung; two Escapes climb
    // to the LANGUAGE rung. The Hawaiian track's first level needs logic1.cleared →
    // its language row greys out.
    press(c, "Enter");
    expect(text(c, ".room-destmenu-title")).toBe("Base — level");
    press(c, "Escape"); // → mechanic rung
    press(c, "Escape"); // → language rung
    expect(ladderLabels(c)).toEqual(["English", "ʻŌlelo Hawaiʻi", "← Back", "⌂ Return to hub"]);
    expect([...c.querySelectorAll(".room-destmenu-option")]
      .find((b) => b.textContent!.includes("Hawai"))!.classList.contains("locked")).toBe(true);
    press(c, "Escape"); // esc at the top rung closes the chooser
    expect((c.querySelector(".room-destmenu") as HTMLElement).hidden).toBe(true);

    // Walk the slime onto the flag → won → the unlock is granted and the frozen
    // board RELEASES movement, so the engine walks the slime back to the portal.
    press(c, "ArrowRight", 4);
    expect(text(c, ".logic-room-banner")).toContain("Solved");
    press(c, "ArrowLeft", 4); // engine movement now (board frozen)
    press(c, "Enter");        // on the menu portal → the ladder, on THIS level's rung
    expect(ladderLabels(c)).toEqual(["Tutorial", "Logic I", "← Back", "⌂ Return to hub"]);
    press(c, "ArrowDown", 3); // Tutorial → Logic I → ← Back → ⌂ Return to hub
    press(c, "Enter"); // select ⌂ → back through the portal system
    expect(c.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(c.querySelector(".logic-board-layer")).toBeNull(); // board fully torn down

    manager.teardown();
    expect(c.innerHTML).toBe("");
  });

  it("grammar room: shared push slides word-tiles into the frame; auto-wins", () => {
    const { container: c, manager } = world;
    manager.enter("hub");
    press(c, "Enter");      // tut-1
    press(c, "ArrowLeft");  // tut-2 (move) → (5,4)
    press(c, "Enter");      // tut-3 → tut-4 waits enter_door
    press(c, "ArrowRight", 3); // (8,4)
    press(c, "ArrowUp", 3);    // (8,4) → (8,1) — the now-OPEN Grammar door
    press(c, "Enter");         // the portal's ladder (language rung: English)
    press(c, "Enter");         // English → mechanic rung (Base)
    press(c, "Enter");         // Base → level rung (only the Tutorial unlocked)
    press(c, "Enter");         // select it → the grammar tutorial

    // SAME FORMAT as logic/vocab: frame slots + pushable word tiles on the grid,
    // one slime, NO inventory HUD / terminal / controls.
    expect(c.classList.contains("room-theme-library")).toBe(true); // pack-declared skin
    expect(c.querySelectorAll(".grammar-slot")).toHaveLength(2); // who? / does what?
    expect(c.querySelectorAll(".grammar-word")).toHaveLength(2); // 2 pushable word tiles
    expect(c.querySelector(".room-inventory")).toBeNull();       // no pickup HUD
    expect(c.querySelector(".room-terminal")).toBeNull();
    expect(c.querySelectorAll(".slime")).toHaveLength(1);
    expect(c.querySelectorAll(".room-world")).toHaveLength(1);
    expect(c.querySelector(".logic-board-layer")).toBeNull();

    // The room's own guided tutorial: step 2 waits for a REAL push (a plain step
    // doesn't count; the module reports the shove).
    expect(speech(c)).toContain("sentence frame");
    press(c, "Enter");
    expect(speech(c)).toContain("PUSH");
    press(c, "ArrowLeft");    // board (5,5) → (4,5): a step, no push — the beat stays
    expect(speech(c)).toContain("PUSH");
    press(c, "ArrowUp");      // shoves "the slime" up → advances the tutorial
    expect(speech(c)).toContain("checks itself");
    press(c, "Enter"); // → the undo/reset step
    press(c, "Enter"); // tutorial done

    // Finish the sentence: "the slime" into slot 1, then "hops" into slot 2 →
    // valid sentence → AUTO-win (no submit). Full push path: L U UU DDD R UUU.
    const solution = [
      "ArrowUp", "ArrowUp",
      "ArrowDown", "ArrowDown", "ArrowDown",
      "ArrowRight", "ArrowUp", "ArrowUp", "ArrowUp",
    ];
    for (const k of solution) press(c, k);
    expect(text(c, ".grammar-banner")).toContain("sentence");

    // The solved board releases movement; walk to the menu portal (spawn) → exit.
    // grammar.tutorial.cleared is earned, so the chooser now offers Grammar I.
    press(c, "ArrowDown", 3); // board (5,2) → (5,5) = the spawn / menu portal
    press(c, "Enter");        // the ladder, opened on THIS level's rung
    expect(ladderLabels(c)).toEqual(["Tutorial", "Grammar I", "← Back", "⌂ Return to hub"]);
    press(c, "ArrowDown", 3); // Tutorial → Grammar I → ← Back → ⌂ Return to hub
    press(c, "Enter"); // ⌂ → hub
    expect(c.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(c.querySelector(".grammar-slot-layer")).toBeNull(); // torn down clean

    manager.teardown();
    expect(c.innerHTML).toBe("");
  });

  it("entering a level NEVER auto-opens the menu (even one already cleared)", () => {
    const { container: c, manager } = world;
    addUnlock("grammar1.cleared"); // Grammar I is already completed
    // Entry plays the puzzle regardless of completion — the old on-arrival skip is gone.
    manager.enter("grammar-build-001");
    expect((c.querySelector(".room-destmenu") as HTMLElement).hidden).toBe(true);
    expect(c.querySelectorAll(".grammar-slot").length).toBeGreaterThan(0); // the puzzle is playable
    manager.teardown();
  });

  it("solving a level auto-opens its chooser only when the toggle is on", () => {
    const { container: c, manager } = world;
    // grammar-build-001's ★★★ line: the subject rides straight up, then the verb goes
    // up the next column and is shoved LEFT into the walled slot (see its playthrough test).
    const solution = "LUUUDDDRRUUURUL".split("").map((c2) =>
      ({ L: "ArrowLeft", R: "ArrowRight", U: "ArrowUp", D: "ArrowDown" }[c2]!));

    // Toggle ON → the winning move opens the chooser immediately (no walk to the portal).
    // try/finally: a failure in here must not leak the toggle into the tests that follow.
    try {
      roomSettings.autoMenuOnSolve = true;
      manager.enter("grammar-build-001");
      press(c, "Enter"); // dismiss the on_enter greeting
      for (const k of solution) press(c, k);
      expect((c.querySelector(".room-destmenu") as HTMLElement).hidden).toBe(false);
      expect(text(c, ".room-destmenu-title")).toBe("Base — level"); // opens on this level's rung
      manager.teardown();
    } finally {
      roomSettings.autoMenuOnSolve = false; // restore the default
    }
  });

  it("vocab room: shared Sokoban push locks pairs; ? reveals a meaning", () => {
    const { container: c, manager } = world;
    manager.enter("hub");
    press(c, "Enter");      // tut-1
    press(c, "ArrowLeft");  // tut-2 (move) → (5,4)
    press(c, "Enter");      // tut-3 → tut-4 waits enter_door
    press(c, "ArrowRight", 6); // (11,4)
    press(c, "ArrowUp", 2);    // (11,2) — the now-OPEN Language door
    press(c, "Enter");         // the portal's ladder (ʻŌlelo Hawaiʻi first; English locked)
    press(c, "Enter");         // ʻŌlelo Hawaiʻi → mechanic rung (Base)
    press(c, "Enter");         // Base → level rung (only the Tutorial unlocked)
    press(c, "Enter");         // select it → the vocab tutorial

    // The game IS the room: tiles on the engine grid, one slime, no HUD/terminal.
    // The pack declares its skin as DATA → the host stamps the theme token class.
    expect(c.classList.contains("room-theme-tropical")).toBe(true);
    expect(c.querySelectorAll(".vocab-tile")).toHaveLength(2); // aloha / hello
    expect(c.querySelector(".room-inventory")).toBeNull();     // pushing needs no inventory
    expect(c.querySelector(".room-terminal")).toBeNull();
    expect(c.querySelectorAll(".room-world")).toHaveLength(1);
    expect(c.querySelectorAll(".slime")).toHaveLength(1);

    // The room's own guided tutorial: step 2 waits for a REAL push.
    expect(speech(c)).toContain("SAME thing");
    press(c, "Enter");
    expect(speech(c)).toContain("PUSH");

    // PROBE help with nothing nearby → the pack's hint line INTERJECTS over the
    // tutorial, then the tutorial resumes at the same step.
    press(c, "?");
    expect(speech(c)).toContain("beside a tile");
    press(c, "Enter"); // dismiss the interjection
    expect(speech(c)).toContain("PUSH"); // resumed where it left off

    // Walk left of aloha and shove it once → the tutorial advances.
    press(c, "ArrowLeft", 3); // board (4,5) → (1,5)
    press(c, "ArrowUp", 2);   // (1,3), left of aloha at (2,3)
    press(c, "ArrowRight");   // pushes aloha (2,3) → (3,3)
    expect(speech(c)).toContain("lock together");
    press(c, "Enter"); // → the ?/undo/reset step
    press(c, "Enter"); // tutorial done

    // Stand beside aloha and reveal its meaning; ? again dismisses.
    press(c, "?");
    expect(text(c, ".vocab-help")).toContain("hello"); // aloha = hello (pack data)
    press(c, "?");
    expect(c.querySelector(".vocab-help")).toBeNull();

    // PROBE undo: the shared U binding rewinds the push (player and tile).
    press(c, "u"); // aloha back to (2,3), player back to (1,3)
    expect(c.querySelectorAll(".vocab-tile.matched")).toHaveLength(0);

    // Push aloha all the way beside hello (6,3) → LOCK + WIN (the only pair).
    press(c, "ArrowRight", 3); // aloha (2,3) → (5,3)
    expect(c.querySelectorAll(".vocab-tile.matched")).toHaveLength(2);
    expect(text(c, ".vocab-banner")).toContain("Maika");
    press(c, "u"); // a finished board freezes undo
    expect(c.querySelectorAll(".vocab-tile.matched")).toHaveLength(2);

    // The finished board releases movement; the earned unlock shows in the chooser.
    press(c, "ArrowDown", 2);  // engine movement now — board (4,3) → (4,5) the portal
    press(c, "Enter");         // the ladder, opened on THIS level's rung
    expect(ladderLabels(c)).toEqual(["Tutorial", "Vocab I", "← Back", "⌂ Return to hub"]);
    press(c, "ArrowDown", 3);  // Tutorial → Vocab I → ← Back → ⌂ Return to hub
    press(c, "Enter"); // ⌂ → hub
    expect(c.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(c.querySelector(".vocab-tile-layer")).toBeNull(); // torn down clean

    manager.teardown();
    expect(c.innerHTML).toBe("");
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

  // The punctuation TIER, driven through the real mount (proves the module threads
  // requirePunctuation into doRun — not just the pure checker). The guided tutorial is
  // pre-satisfied (every concept marked taught) so these drive the mechanic directly.
  // Mark tutorials seen so these tests drive the mechanic directly (whole-unit model: a tutorial
  // is skipped by marking its id — the room id for a guided_tutorial, or the shared tutorial id).
  const skipTutorial = (...ids: string[]) => { for (const id of ids) completeTutorial(id); };

  it("punctuation level: collecting and placing the parens yourself solves it", () => {
    const { container: c, manager } = world;
    skipTutorial("py-code-explicit-000");
    manager.enter("py-code-explicit-000");
    press(c, "Enter"); // dismiss the snake on_enter greeting (guided tutorial is skipped)

    // Collect print / ( / "hello world" / ) — in the order they'll be placed (FIFO).
    press(c, "ArrowUp");           // (6,6)
    press(c, "ArrowRight", 3);     // (9,6) print
    press(c, "i");
    press(c, "ArrowRight");        // (10,6) (
    press(c, "i");
    press(c, "ArrowUp", 2);        // (10,4)
    press(c, "ArrowLeft");         // (9,4) "hello world"
    press(c, "i");
    press(c, "ArrowRight", 2);     // (11,4)
    press(c, "ArrowDown", 2);      // (11,6) )
    press(c, "i");

    // Place print ( "hello world" ) at indent 0: (1,1) (2,1) (3,1) (4,1).
    press(c, "ArrowUp", 5);        // (11,1)
    press(c, "ArrowLeft", 10);     // (1,1)
    press(c, "p");
    press(c, "ArrowRight"); press(c, "p"); // (2,1)
    press(c, "ArrowRight"); press(c, "p"); // (3,1)
    press(c, "ArrowRight"); press(c, "p"); // (4,1)
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(4);

    // Build, then Run → success.
    press(c, "ArrowDown", 6);      // (4,1) → (4,7)
    press(c, "ArrowLeft", 2);      // (2,7) Build
    press(c, "Enter");
    press(c, "ArrowRight", 3);     // (5,7) Run
    press(c, "Enter");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(true);
    expect(text(c, ".room-terminal-body")).toContain("hello world");
    manager.teardown();
  });

  it("punctuation level: omitting the parens does NOT solve it (the tier is enforced in-mount)", () => {
    const { container: c, manager } = world;
    skipTutorial("py-code-explicit-000");
    manager.enter("py-code-explicit-000");
    press(c, "Enter"); // dismiss on_enter

    // Collect only print and "hello world" — skip the parens.
    press(c, "ArrowUp");           // (6,6)
    press(c, "ArrowRight", 3);     // (9,6) print
    press(c, "i");
    press(c, "ArrowUp", 2);        // (9,4) "hello world"
    press(c, "i");

    // Place print "hello world" (no parens) at (1,1) (2,1).
    press(c, "ArrowUp", 3);        // (9,1)
    press(c, "ArrowLeft", 8);      // (1,1)
    press(c, "p");
    press(c, "ArrowRight"); press(c, "p"); // (2,1)
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(2);

    // Build + Run → rejected (guided mode would have accepted this; the tier does not).
    press(c, "ArrowDown", 6);      // (2,1) → (2,7) Build
    press(c, "Enter");
    press(c, "ArrowRight", 3);     // (5,7) Run
    press(c, "Enter");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(false);
    expect(text(c, ".room-terminal-body")).toContain("no output");
    manager.teardown();
  });

  it("base 'Variables' level: a two-line program (define x, then print it) solves it", () => {
    const { container: c, manager } = world;
    skipTutorial("py-code-base-001");
    manager.enter("py-code-base-001");
    press(c, "Enter"); // dismiss on_enter (guided tutorial skipped)

    // The goal chip shows the desired output/description — never the target code.
    expect(text(c, ".room-hud-goal")).toContain("Store 5 in x");

    // Batch 1: collect x, =, 5 and lay line 0 "x = 5" at row 1.
    press(c, "ArrowRight", 5);  // (6,7) → (11,7)
    press(c, "ArrowUp", 4);     // (11,3) x pile
    press(c, "i");
    press(c, "ArrowDown");      // (11,4)
    press(c, "ArrowLeft", 2);   // (9,4) = pile
    press(c, "i");
    press(c, "ArrowRight", 2);  // (11,4)
    press(c, "ArrowDown", 2);   // (11,6) 5 pile
    press(c, "i");
    press(c, "ArrowUp", 5);     // (11,1)
    press(c, "ArrowLeft", 10);  // (1,1)
    press(c, "p");                          // x
    press(c, "ArrowRight"); press(c, "p");  // (2,1) =
    press(c, "ArrowRight"); press(c, "p");  // (3,1) 5
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(3);

    // Batch 2: collect print, x and lay line 1 "print x" at row 2.
    press(c, "ArrowDown", 6);   // (3,1) → (3,7)
    press(c, "ArrowRight", 6);  // (9,7)
    press(c, "ArrowUp");        // (9,6) print pile
    press(c, "i");
    press(c, "ArrowRight", 2);  // (11,6)
    press(c, "ArrowUp", 3);     // (11,3) x pile
    press(c, "i");
    press(c, "ArrowUp");        // (11,2) — climb above the row-3 wall block before going left
    press(c, "ArrowLeft", 10);  // (1,2) — row 2 is clear of the walls
    press(c, "p");                          // print at (1,2)
    press(c, "ArrowRight"); press(c, "p");  // (2,2) x
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(5);

    // Build + Run → success, output 5.
    press(c, "ArrowDown", 5);   // (2,2) → (2,7) Build
    press(c, "Enter");
    press(c, "ArrowRight", 3);  // (5,7) Run
    press(c, "Enter");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(true);
    expect(text(c, ".room-terminal-body")).toContain("5");
    manager.teardown();
  });

  it("mixed 'Assisted parens': the scaffolded ) is prefilled and locked; you build the rest", () => {
    const { container: c, manager } = world;
    skipTutorial("py-code-mixed-000", "tier:mixed");
    manager.enter("py-code-mixed-000");
    press(c, "Enter"); // dismiss on_enter (guided tutorial skipped)

    // The closing paren is already on the board (scaffolded) — one placed tile at mount.
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(1);
    expect(c.querySelector(".tile-placed")!.classList.contains("tile-prefilled")).toBe(true);

    // It's LOCKED: standing on it (4,1) and pressing pickup does nothing.
    press(c, "ArrowLeft", 2);  // (6,7) → (4,7)
    press(c, "ArrowUp", 6);    // (4,1) the prefilled )
    press(c, "i");
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(1); // still there — not pickable

    // Collect print, (, "hello world".
    press(c, "ArrowDown", 6);  // (4,7)
    press(c, "ArrowRight", 5); // (9,7)
    press(c, "ArrowUp");       // (9,6) print
    press(c, "i");
    press(c, "ArrowRight");    // (10,6) (
    press(c, "i");
    press(c, "ArrowUp", 2);    // (10,4)
    press(c, "ArrowLeft");     // (9,4) "hello world"
    press(c, "i");

    // Place print ( "hello world" at (1,1)(2,1)(3,1); the locked ) already sits at (4,1).
    press(c, "ArrowUp", 3);    // (9,1)
    press(c, "ArrowLeft", 8);  // (1,1)
    press(c, "p");
    press(c, "ArrowRight"); press(c, "p"); // (2,1)
    press(c, "ArrowRight"); press(c, "p"); // (3,1)
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(4); // 3 placed + 1 scaffolded

    // Build + Run → success (the scaffolded ) completes the line).
    press(c, "ArrowDown", 6);  // (3,1) → (3,7)
    press(c, "ArrowLeft");     // (2,7) Build
    press(c, "Enter");
    press(c, "ArrowRight", 3); // (5,7) Run
    press(c, "Enter");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(true);
    expect(text(c, ".room-terminal-body")).toContain("hello world");
    manager.teardown();
  });

  it("base 'Loops II': a for-loop with an INDENTED body prints the counter (indent-as-placement)", () => {
    const { container: c, manager } = world;
    skipTutorial("concept:loops");
    manager.enter("py-code-loops-002");
    press(c, "Enter"); // dismiss on_enter

    // Header batch: collect for i in range 3 (row 6), then lay it at row 1, indent 0.
    press(c, "ArrowUp");           // (6,6)
    press(c, "ArrowRight"); press(c, "i"); // (7,6) for
    press(c, "ArrowRight"); press(c, "i"); // (8,6) i
    press(c, "ArrowRight"); press(c, "i"); // (9,6) in
    press(c, "ArrowRight"); press(c, "i"); // (10,6) range
    press(c, "ArrowRight"); press(c, "i"); // (11,6) 3
    press(c, "ArrowUp", 5);        // (11,1)
    press(c, "ArrowLeft", 10);     // (1,1)
    press(c, "p");                          // for
    press(c, "ArrowRight"); press(c, "p");  // (2,1) i
    press(c, "ArrowRight"); press(c, "p");  // (3,1) in
    press(c, "ArrowRight"); press(c, "p");  // (4,1) range
    press(c, "ArrowRight"); press(c, "p");  // (5,1) 3
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(5);

    // Body batch: collect print, i and lay it at row 2, INDENT 1 (cols 2,3 — one tile in).
    press(c, "ArrowDown", 3);      // (5,4)
    press(c, "ArrowRight", 2);     // (7,4) print
    press(c, "i");
    press(c, "ArrowRight");        // (8,4)
    press(c, "ArrowDown", 2);      // (8,6) i
    press(c, "i");
    press(c, "ArrowUp", 4);        // (8,2)
    press(c, "ArrowLeft", 6);      // (2,2) — indent 1
    press(c, "p");                          // print
    press(c, "ArrowRight"); press(c, "p");  // (3,2) i
    expect(c.querySelectorAll(".tile-placed")).toHaveLength(7);

    // PROBE the indent: the body row reads indent=1 (it sits inside the loop).
    press(c, "`");
    expect(text(c, ".room-debug")).toContain("[print, i]");
    expect(text(c, ".room-debug")).toContain("indent=1");
    press(c, "`");

    // Build + Run → success, counter output.
    press(c, "ArrowDown", 5);      // (3,2) → (3,7)
    press(c, "ArrowLeft");         // (2,7) Build
    press(c, "Enter");
    press(c, "ArrowRight", 3);     // (5,7) Run
    press(c, "Enter");
    expect(c.querySelector(".room-terminal-body")!.classList.contains("term-success")).toBe(true);
    expect(text(c, ".room-terminal-body")).toContain("0");
    manager.teardown();
  });

  it("modifiers: a shrouded level mounts the low-light overlay pinned to the player; base does not", () => {
    const { container: c, manager } = world;
    manager.enter("grammar-build-001"); // base: fixed layout, full vision
    expect(c.querySelector(".room-lowlight")).toBeNull();

    manager.enter("grammar-build-001-shrouded"); // ["randomized","lowlight"]
    const overlay = c.querySelector(".room-lowlight") as HTMLElement;
    expect(overlay).toBeTruthy();
    // draw() feeds the falloff center/radii as CSS vars (screen-cell tracking).
    expect(overlay.style.getPropertyValue("--lowlight-x")).toMatch(/px$/);
    expect(overlay.style.getPropertyValue("--lowlight-clear")).toMatch(/px$/);
    manager.teardown();
  });

  it("modifiers: a shuffled level permutes word spawns WITHIN the authored cell set", () => {
    const { container: c, manager } = world;
    const cells = () =>
      [...c.querySelectorAll(".grammar-cell")].map((el) => (el as HTMLElement).style.transform).sort();

    manager.enter("grammar-build-001"); // the authored arrangement
    const authored = cells();
    expect(authored.length).toBeGreaterThan(0);

    manager.enter("grammar-build-001-shuffled"); // ["randomized"]
    // A permutation NEVER invents a cell: whatever the runtime seed, the multiset of
    // occupied cells is exactly the authored one (only the assignment may differ).
    expect(cells()).toEqual(authored);
    manager.teardown();
  });

  it("shared tutorial: a level's tutorial_refs play in full on first entry, not on the next", () => {
    const { container: c, manager } = world;
    // First visit: the shared "tier:mixed" tutorial plays after the snake greeting.
    manager.enter("py-code-mixed-000");
    press(c, "Enter"); // past the snake on_enter greeting → into the shared tier tutorial
    expect(speech(c)).toContain("New tier");
    press(c, "Enter"); // finish the tutorial → the whole sequence completes → marked seen
    manager.teardown();

    // Second visit: tier:mixed already seen → greeting only, the tutorial does not replay.
    manager.enter("py-code-mixed-000");
    press(c, "Enter"); // greeting; nothing follows
    expect(speech(c)).not.toContain("New tier");
    manager.teardown();
  });

  // BOARD rooms (logic/grammar/vocab) declare no terminal and no inventory, so the HUD
  // goal line and the hint-giver marker are the only framing they get. Both render
  // through generic roomHost paths — this pins that a board room actually gets them
  // (packFraming.test.ts pins that every level supplies the content).
  it.each(["logic-rules-003", "grammar-build-002", "vocab-match-005", "vocab-en-001"])(
    "%s: renders its goal line and its hint-giver marker",
    async (id) => {
      const { container: c, manager } = world;
      manager.enter(id);
      await vi.waitFor(() => expect(c.querySelector(".room-hud-goal")).toBeTruthy());
      expect(text(c, ".room-hud-goal").length).toBeGreaterThan(10);
      expect(text(c, ".room-hud-title").length).toBeGreaterThan(0);
      expect(c.querySelectorAll(".room-marker-layer .tile-hint-marker")).toHaveLength(1);
      manager.teardown();
    },
  );
});
