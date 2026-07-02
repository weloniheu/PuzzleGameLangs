import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCaptureMachine, CAPTURE_MAX, CAPTURE_WINDOW } from "./settingsPanel";
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
