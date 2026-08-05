import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCaptureMachine, moveCursor, CAPTURE_MAX, CAPTURE_WINDOW, type Cursor } from "./settingsPanel";
import { rebind, defaultBindings, type Key } from "../core/keybindings";

// CHARACTERIZATION TEST (B5): the rebind CAPTURE state machine — the BUFFER + commit
// timing, which was untested. (keybindings.rebind/resolve are already covered.) Uses fake
// timers to drive the inter-key window; no jsdom.

describe("createCaptureMachine — buffer + commit timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function machineWithSpy() {
    const commits: Key[][] = [];
    const m = createCaptureMachine({ max: CAPTURE_MAX, window: CAPTURE_WINDOW, onCommit: (b) => commits.push(b) });
    return { m, commits };
  }

  it("a SINGLE key commits after the inter-key window (not before)", () => {
    const { m, commits } = machineWithSpy();
    m.start();
    m.key("p");
    expect(commits).toEqual([]);                 // still waiting
    vi.advanceTimersByTime(CAPTURE_WINDOW - 1);
    expect(commits).toEqual([]);                 // window not yet elapsed
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([["p"]]);            // commits the single key
  });

  it("a SEQUENCE (d then d) commits at MAX length immediately — no window wait", () => {
    const { m, commits } = machineWithSpy();
    m.start();
    m.key("d");
    expect(commits).toEqual([]);                 // first key arms the window
    m.key("d");                                  // reaches MAX (2)
    expect(commits).toEqual([["d", "d"]]);       // committed right away
    vi.advanceTimersByTime(CAPTURE_WINDOW * 5);  // any pending timer was cleared
    expect(commits).toEqual([["d", "d"]]);       // no double-commit
  });

  it("normalizes keys (e.g. 'D' → 'd') as they enter the buffer", () => {
    const { m, commits } = machineWithSpy();
    m.start();
    m.key("D");
    vi.advanceTimersByTime(CAPTURE_WINDOW);
    expect(commits).toEqual([["d"]]);
  });

  it("cancel() drops the buffer with NO commit (esc leaves the old binding)", () => {
    const { m, commits } = machineWithSpy();
    m.start();
    m.key("x");
    m.cancel();
    vi.advanceTimersByTime(CAPTURE_WINDOW * 5);
    expect(commits).toEqual([]);
    expect(m.active()).toBe(false);
  });
});

describe("capture → rebind end-to-end (commit changes binding; cancel leaves it)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("committing 'd','d' onto vim clearLine sets it to the dd sequence", () => {
    const before = defaultBindings("vim");
    let bindings = before;
    const m = createCaptureMachine({
      max: CAPTURE_MAX, window: CAPTURE_WINDOW,
      onCommit: (buf) => {
        const res = rebind(bindings, "clearLine", 0, buf);
        if (res.ok) bindings = res.bindings;
      },
    });
    m.start();
    m.key("d");
    m.key("d"); // commits at max
    expect(bindings.clearLine).toEqual([["d", "d"]]);
  });

  it("cancelling leaves the binding exactly as it was (no rebind)", () => {
    const before = defaultBindings("vim");
    let bindings = before;
    const m = createCaptureMachine({
      max: CAPTURE_MAX, window: CAPTURE_WINDOW,
      onCommit: (buf) => { const r = rebind(bindings, "clearLine", 0, buf); if (r.ok) bindings = r.bindings; },
    });
    m.start();
    m.key("z");
    m.cancel();
    vi.advanceTimersByTime(CAPTURE_WINDOW * 5);
    expect(bindings).toBe(before); // untouched reference — nothing rebound
  });
});

// --- keyboard NAVIGATION cursor (Rule 4: the panel is driven by movement keys) ---
// Widths describe the panel as rows of controls: 1 = a plain row (a menu entry, the
// reset button), >1 = an option strip (scheme tabs, room size, a binding's chips).

describe("moveCursor — panel navigation", () => {
  const at = (row: number, col = 0): Cursor => ({ row, col });

  it("up/down change row and snap back to the first control", () => {
    expect(moveCursor([1, 3, 1], at(0), "down")).toEqual({ row: 1, col: 0 });
    expect(moveCursor([1, 3, 1], { row: 1, col: 2 }, "down")).toEqual({ row: 2, col: 0 });
    expect(moveCursor([1, 3, 1], at(2), "up")).toEqual({ row: 1, col: 0 });
  });

  it("clamps at the top and bottom instead of wrapping", () => {
    expect(moveCursor([1, 2], at(0), "up")).toEqual({ row: 0, col: 0 });
    expect(moveCursor([1, 2], at(1), "down")).toEqual({ row: 1, col: 0 });
  });

  it("left/right step WITHIN a multi-control row and clamp at its ends", () => {
    expect(moveCursor([1, 3], at(1), "right")).toEqual({ row: 1, col: 1 });
    expect(moveCursor([1, 3], { row: 1, col: 2 }, "right")).toEqual({ row: 1, col: 2 });
    expect(moveCursor([1, 3], { row: 1, col: 0 }, "left")).toEqual({ row: 1, col: 0 });
  });

  it("left/right fall through to up/down on a SINGLE-control row", () => {
    expect(moveCursor([1, 1, 1], at(1), "right")).toEqual({ row: 2, col: 0 });
    expect(moveCursor([1, 1, 1], at(1), "left")).toEqual({ row: 0, col: 0 });
  });

  it("re-clamps a stale cursor after a re-render shrinks the panel", () => {
    // "none" is the paint-time no-op: keep the position, just make it legal again.
    expect(moveCursor([1, 2], { row: 9, col: 9 }, "none")).toEqual({ row: 1, col: 1 });
    expect(moveCursor([], at(3), "down")).toEqual({ row: 0, col: 0 });
  });
});
