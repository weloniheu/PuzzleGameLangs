// @vitest-environment jsdom
// Settings → Quit, end to end through the real host: the row is disabled without
// onQuit (unchanged behavior), enabled and functional with it, and cancel/back never
// fire it. Also covers the scrolling overlays added alongside Quit (§12): a long
// Controls list gets a scrollable body, the destination chooser gets a scrollable row
// list, and the cursor drags both into view.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Puzzle, RoomLayout } from "../schema/types";
import type { LadderData, LadderLevel } from "./core/ladder";
import { mountRoom, type RoomHandle } from "./roomHost";

const LAYOUT: RoomLayout = { width: 5, height: 4, tiles: ["#####", "#...#", "#...#", "#####"] };
const PUZZLE: Puzzle = {
  id: "test-quit-room", schema_version: "1.0.0", language: "test", puzzle_type: "code_build",
  validator_type: "code_match", difficulty: 1,
  prompt: "", payload: { scenario: "", goal: "", tokens: [] }, solution: { output: "" },
  hints: [], metadata: { reviewed: true },
  room: LAYOUT,
};

let c: HTMLElement;
let handle: RoomHandle | undefined;

const viewport = () => c.querySelector(".room-viewport") as HTMLElement;
const press = (key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    viewport().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};
/** The settings panel owns its OWN keydown listener (on `.room-settings-panel`, not the
 *  room viewport) — see systems/settingsPanel.ts. Keys aimed at it while it's open must
 *  target that element, same as roomHost.smoke.test.ts's pressPanel. */
const pressPanel = (key: string, times = 1) => {
  const panel = c.querySelector(".room-settings-panel") as HTMLElement;
  for (let i = 0; i < times; i++) {
    panel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
};
const menuRow = (label: string) =>
  [...c.querySelectorAll<HTMLButtonElement>(".room-menu-entry")].find((b) => b.textContent?.startsWith(label));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  c = document.createElement("div");
  document.body.appendChild(c);
});

afterEach(() => {
  handle?.teardown();
  handle = undefined;
  // Undo the prototype stub the scroll test installs (jsdom has no scrollIntoView of
  // its own — see that test) so it doesn't leak into unrelated tests in this run.
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("Quit — disabled without a handler (unchanged default)", () => {
  it("stays a disabled 'coming soon' stub when the room supplies no onQuit", () => {
    handle = mountRoom(c, PUZZLE, {});
    press("Escape"); // opens settings (esc ladder, nothing else claims it on a plain room)
    const quit = menuRow("Quit")!;
    expect(quit.disabled).toBe(true);
    expect(quit.textContent).toContain("coming soon");
  });
});

describe("Quit — wired", () => {
  it("clicking Quit opens a confirm screen, not an immediate quit", () => {
    let quit = 0;
    handle = mountRoom(c, PUZZLE, { onQuit: () => quit++ });
    press("Escape");
    menuRow("Quit")!.click();
    expect(quit).toBe(0); // no callback yet — this is a confirm, not the action
    expect(c.querySelector(".room-settings-title")?.textContent).toBe("Quit?");
  });

  it("Cancel returns to the menu without ever calling onQuit", () => {
    let quit = 0;
    handle = mountRoom(c, PUZZLE, { onQuit: () => quit++ });
    press("Escape");
    menuRow("Quit")!.click();
    const cancel = [...c.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Cancel")!;
    cancel.click();
    expect(quit).toBe(0);
    expect(c.querySelector(".room-settings-title")?.textContent).toBe("Settings");
  });

  it("Escape from the confirm screen also backs out without quitting", () => {
    let quit = 0;
    handle = mountRoom(c, PUZZLE, { onQuit: () => quit++ });
    press("Escape");
    menuRow("Quit")!.click();
    pressPanel("Escape"); // esc ladder INSIDE settings: sub-view → menu (see escBack)
    expect(quit).toBe(0);
    expect(c.querySelector(".room-settings-title")?.textContent).toBe("Settings");
  });

  it("confirming 'Quit to title' calls onQuit exactly once", () => {
    let quit = 0;
    handle = mountRoom(c, PUZZLE, { onQuit: () => quit++ });
    press("Escape");
    menuRow("Quit")!.click();
    const confirm = [...c.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Quit to title")!;
    confirm.click();
    expect(quit).toBe(1);
  });
});

describe("§12 — the Controls list scrolls instead of running off-screen", () => {
  it("the body wrap is the scrollable region, not the whole card", () => {
    handle = mountRoom(c, PUZZLE, {});
    press("Escape");
    menuRow("Controls")!.click();
    const body = c.querySelector<HTMLElement>(".room-settings-body");
    expect(body).toBeTruthy();
    // Every bindable action (14 in standard, no vim-only extras) is a row here — plenty
    // to overflow any reasonable card height once rendered with real layout.
    expect(c.querySelectorAll(".room-control-row").length).toBeGreaterThan(10);
  });

  it("moving the cursor onto an off-screen row calls scrollIntoView", () => {
    handle = mountRoom(c, PUZZLE, {});
    press("Escape");
    menuRow("Controls")!.click();
    const rows = [...c.querySelectorAll<HTMLButtonElement>(".room-bind-chip")];
    expect(rows.length).toBeGreaterThan(5);
    let called = 0;
    for (const r of rows) r.scrollIntoView = () => { called++; };
    // Move down through several rows — each landing calls scrollIntoView (paintNav).
    pressPanel("ArrowDown", 5);
    expect(called).toBeGreaterThan(0);
  });
});

describe("§12 — the destination chooser's row list scrolls too", () => {
  // A big level rung (20 available, unlock-gated levels omitted) — enough to force
  // overflow regardless of the test viewport's assumed height.
  function bigLadder(): LadderData {
    const levels: LadderLevel[] = Array.from({ length: 20 }, (_, i) => ({
      id: `lvl-${i}`, label: `Level ${i}`, language: "test", mechanic: "base",
    }));
    return { levels, lockedLanguages: [], unlocks: new Set(), currentId: null };
  }

  it("wraps rows in a scrollable list, separate from the pinned title/hint", () => {
    handle = mountRoom(c, PUZZLE, { menuLadder: bigLadder });
    press("Enter"); // stand on spawn = the menu portal → opens the chooser
    press("Enter"); // language rung has one entry ("test") → drill into the mechanic rung
    press("Enter"); // one mechanic ("Base") → drill into the level rung (20 rows)
    const list = c.querySelector(".room-destmenu-list");
    expect(list).toBeTruthy();
    expect(c.querySelectorAll(".room-destmenu-option").length).toBeGreaterThanOrEqual(20);
    // Title and hint are OUTSIDE the scrolling list, not swept up in it.
    expect(list!.querySelector(".room-destmenu-title")).toBeNull();
    expect(c.querySelector(".room-destmenu-title")).toBeTruthy();
  });

  it("moving the selection onto an off-screen row calls scrollIntoView", () => {
    // Unlike the settings panel (which reuses its row elements across a cursor move —
    // see paintNav), the chooser rebuilds its row list from scratch on EVERY selection
    // change (renderDestMenu is the whole render, called from moveDestSel too), so a
    // per-element stub would be discarded before the next press. jsdom itself has no
    // scrollIntoView at all (the app code guards every call with `?.()` for exactly this
    // reason) — stub the prototype so freshly-created rows inherit it too.
    let called = 0;
    HTMLElement.prototype.scrollIntoView = function () { called++; };
    handle = mountRoom(c, PUZZLE, { menuLadder: bigLadder });
    press("Enter");
    press("Enter");
    press("Enter");
    called = 0; // ignore the drill-down renders themselves — only the level rung matters
    press("ArrowDown", 10);
    expect(called).toBeGreaterThan(0);
  });
});
