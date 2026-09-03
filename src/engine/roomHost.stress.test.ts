// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// MOUNT STRESS — every level in the game, through the real manager.
//
// The completion suites prove levels can be FINISHED. This proves the cheaper, broader
// thing first: that every shipped level MOUNTS at all, survives being walked and
// interacted with, and tears down leaving nothing behind. A level nobody wrote a test
// for is exactly the level that crashes on entry, and there are ~100 of them.
//
// It also churns the manager the way a real session does — level → level → level with no
// pause — because every leak in this engine (a listener, a timer, a stacked room) shows
// up as a SECOND room quietly running underneath the first.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pack, Puzzle, PuzzleType, TutorialBlock } from "../schema/types";
import { createRoomManager, type RoomManager, type TypeLadder } from "./roomManager";
import { resolveMechanic, type LadderLevel } from "./core/ladder";
import { setTestMode } from "./core/codex";
import { solveGrammar, dealFor } from "../puzzles/grammar/simHarness";

const ROOT = join(__dirname, "..", "..");
const PACK_FILES = [
  "hub.test.v1", "python.code.v1", "logic.room.en.v1", "logic.room.haw.v1",
  "grammar.room.en.v1", "grammar.room.haw.v1", "vocab.room.haw.v1", "vocab.room.en.v1",
];
const packs = PACK_FILES.map((f) => JSON.parse(readFileSync(join(ROOT, `content/packs/${f}.json`), "utf8")) as Pack);

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

/** Every room level the game can reach, in pack order. */
const LEVELS: Puzzle[] = packs.flatMap((p) => p.puzzles.filter((z) => z.room));

let container: HTMLElement;
let manager: RoomManager;
let errors: string[];

function bootWorld() {
  const registry = new Map<string, Puzzle>();
  for (const p of packs) for (const z of p.puzzles) registry.set(z.id, z);
  const ladders = new Map<PuzzleType, TypeLadder>();
  const tutorials = new Map<string, TutorialBlock>();
  for (const pack of packs) {
    for (const prog of pack.progression ?? []) {
      const ladder = ladders.get(prog.puzzle_type) ?? { levels: [], lockedLanguages: [] };
      const stamped: LadderLevel[] = prog.levels.map((lv) => ({
        ...lv, language: lv.language ?? pack.language, languageLabel: pack.language_label,
        mechanic: lv.mechanic ?? resolveMechanic(registry.get(lv.id)),
      }));
      ladder.levels.push(...stamped);
      ladder.lockedLanguages.push(...(prog.locked_languages ?? []));
      ladders.set(prog.puzzle_type, ladder);
    }
    for (const [id, block] of Object.entries(pack.tutorials ?? {})) tutorials.set(id, block);
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  manager = createRoomManager(
    container,
    (id) => registry.get(id) ?? null,
    (t) => ladders.get(t) ?? { levels: [], lockedLanguages: [] },
    { tutorialFor: (id) => tutorials.get(id) ?? null },
  );
}

const press = (key: string, times = 1) => {
  const vp = container.querySelector(".room-viewport") as HTMLElement | null;
  if (!vp) return;
  for (let i = 0; i < times; i++) {
    vp.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setTestMode(true); // every portal and level reachable, the way a QA pass sees it
  document.body.innerHTML = "";
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
  bootWorld();
});
afterEach(() => {
  manager.teardown();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("every level mounts, plays a little, and tears down clean", () => {
  it.each(LEVELS.map((p): [string, Puzzle] => [p.id, p]))("%s", (_id, level) => {
    manager.enter(level.id);
    // It exists, exactly once, with a player in it.
    expect(container.querySelectorAll(".room-world")).toHaveLength(1);
    expect(container.querySelectorAll(".slime")).toHaveLength(1);
    expect(container.querySelectorAll(".room-viewport")).toHaveLength(1);

    // Survive the keys a confused player mashes: teaching, movement, every bound verb,
    // the overlays, and the hotbar. None of it may throw or stack a second room.
    press("Escape");
    for (const k of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) press(k, 3);
    for (const k of ["i", "p", "q", "e", "f", "u", "r", "t", "?", "`", "1", "9"]) press(k);
    press("t"); // close the task overlay again if T opened it
    press("Escape");
    vi.advanceTimersByTime(12_000); // let every timer this room owns fire at least once
    expect(container.querySelectorAll(".room-world")).toHaveLength(1);

    manager.teardown();
    expect(container.innerHTML).toBe("");
    // Nothing may still be running: 60s of clock after teardown adds nothing back.
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe("");
    expect(errors).toEqual([]);
  });
});

describe("churn", () => {
  it("walks the whole game level to level with no teardown in between", () => {
    for (const level of LEVELS) {
      manager.enter(level.id);
      press("Escape");
      press("ArrowRight", 2);
      // ONE room at a time, always — a missed teardown shows up here as a second world.
      expect(container.querySelectorAll(".room-world"), level.id).toHaveLength(1);
      expect(container.querySelectorAll(".slime"), level.id).toHaveLength(1);
    }
    vi.advanceTimersByTime(30_000);
    expect(container.querySelectorAll(".room-world")).toHaveLength(1);
    manager.teardown();
    expect(container.innerHTML).toBe("");
    expect(errors).toEqual([]);
  }, 120_000);

  it("re-entering the SAME level 40 times leaves one room and one clock", () => {
    const level = LEVELS.find((p) => p.room?.monsters?.spawns?.length)!; // the busiest kind
    for (let i = 0; i < 40; i++) {
      manager.enter(level.id);
      vi.advanceTimersByTime(1500); // long enough to telegraph and spawn
      expect(container.querySelectorAll(".room-world")).toHaveLength(1);
    }
    const monsterLayers = container.querySelectorAll(".room-monster-layer");
    expect(monsterLayers).toHaveLength(1);
    manager.teardown();
    vi.advanceTimersByTime(60_000);
    expect(container.innerHTML).toBe("");
    expect(errors).toEqual([]);
  }, 120_000);
});

// --- the LEVEL COMPLETE chain, driven for real --------------------------------
// The card's whole promise is "you never have to go back to the portal". These play
// levels to a win with a SOLVED route (puzzles/grammar/simHarness), then take the card's
// own offer — which is the only way to find out whether the chain actually chains.

const ARROW: Record<string, string> = { U: "ArrowUp", D: "ArrowDown", L: "ArrowLeft", R: "ArrowRight" };
/** The grammar ladder as the MANAGER sees it: every pack's entries for the type, merged
 *  in load order — which is why its last rung is Hawaiian, not English. */
const grammarLadder = () =>
  packs.flatMap((p) => (p.progression ?? [])
    .filter((x) => x.puzzle_type === "grammar_build")
    .flatMap((x) => x.levels));

/** Play `pz` to its win with a freshly solved route. */
function solveInRoom(pz: Puzzle) {
  const result = solveGrammar(pz, dealFor(pz, 1));
  expect(result.kind, `${pz.id} could not be solved`).toBe("solved");
  if (result.kind !== "solved") return;
  press("Escape"); // past the greeting / teaching
  for (const m of result.moves) press(ARROW[m]);
}

describe("the level-complete chain", () => {
  it("solve → Next → solve → Next walks the ladder without touching a portal", () => {
    const ladder = grammarLadder();
    const levels = packs.flatMap((p) => p.puzzles);
    let at = ladder[0].id;

    for (let hop = 0; hop < 3; hop++) {
      manager.enter(at);
      solveInRoom(levels.find((p) => p.id === at)!);

      const card = container.querySelector(".room-summary") as HTMLElement;
      expect(card, `${at} did not open a card`).toBeTruthy();
      expect(card.hidden).toBe(false);
      // The card names where it is sending you, and it is the ladder's next rung.
      const expected = ladder[ladder.findIndex((l) => l.id === at) + 1];
      expect(container.querySelector(".room-summary-btn")!.textContent).toBe(`${expected.label} →`);

      press("Enter"); // take the offer
      expect(container.querySelectorAll(".room-world")).toHaveLength(1);
      expect((container.querySelector(".room-summary") as HTMLElement | null)?.hidden ?? true).toBe(true);
      at = expected.id;
    }
    expect(errors).toEqual([]);
  }, 120_000);

  it("at the END of a ladder the card offers the hub, and the hub is where you land", () => {
    const ladder = grammarLadder();
    const lastId = ladder[ladder.length - 1].id;
    const last = packs.flatMap((p) => p.puzzles).find((p) => p.id === lastId)!;
    // A randomized rung re-deals at mount, so a pre-solved route would not match the board
    // it actually built — the end of this ladder is a fixed level, which is what we want.
    expect(last.modifiers ?? []).toEqual([]);
    manager.enter(last.id);
    solveInRoom(last);

    // Nothing left in this track: the hub takes the lead slot instead of a next level.
    const buttons = [...container.querySelectorAll(".room-summary-btn")].map((b) => b.textContent);
    expect(buttons[0]).toBe("⌂ Return to hub");
    expect(buttons).not.toContain(undefined);
    press("Enter");
    expect(container.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4); // the hub
    expect(errors).toEqual([]);
  }, 120_000);
});

// --- hostile saves -------------------------------------------------------------
// Progress lives in localStorage (or a JSON file in the desktop build), which means it can
// arrive corrupt, half-written, or from an older schema. None of that may stop the game
// from opening.
describe("a corrupt save never stops the game", () => {
  const JUNK = ["", "not json", "null", "{}", "[1,2,3]", '["ok",42,null]', '{"a":1}', "[".repeat(500)];

  it.each(JUNK)("boots and mounts with garbage in every key: %j", (junk) => {
    for (const key of [
      "codex.entries.v1", "codex.unlocks.v1", "codex.testMode.v1", "codex.tutorialsSeen.v1",
      "logic.best.logic-rules-001", "vocab.best.vocab-match-000", "grammar.best.grammar-build-000",
    ]) localStorage.setItem(key, junk);

    bootWorld(); // a fresh manager reading that store
    manager.enter("hub");
    expect(container.querySelectorAll(".room-world")).toHaveLength(1);
    manager.enter("py-code-tutorial-000");
    press("Escape");
    press("ArrowUp");
    expect(container.querySelectorAll(".room-world")).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
