import { describe, it, expect, beforeEach } from "vitest";
import {
  getUnlocks, hasUnlock, addUnlock, resetCodex, discover, getCodex,
  hasCompletedTutorial, completeTutorial, resetTutorials,
} from "./codex";

// codex.ts reads/writes localStorage lazily inside its functions, so a tiny in-memory
// stub installed before each test gives us a real round-trip in the node environment.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => { installLocalStorage(); });

describe("Codex unlocks — persistence round-trip", () => {
  it("starts empty", () => {
    expect(getUnlocks()).toEqual([]);
    expect(hasUnlock("puzzle1.cleared")).toBe(false);
  });

  it("addUnlock persists and survives a re-read (round-trip through storage)", () => {
    expect(addUnlock("puzzle1.cleared")).toBe(true);
    expect(hasUnlock("puzzle1.cleared")).toBe(true);
    expect(getUnlocks()).toEqual(["puzzle1.cleared"]); // re-read from storage
  });

  it("addUnlock is idempotent (no duplicates, returns false when already earned)", () => {
    expect(addUnlock("a")).toBe(true);
    expect(addUnlock("a")).toBe(false);
    expect(getUnlocks()).toEqual(["a"]);
  });

  it("addUnlock ignores an empty key", () => {
    expect(addUnlock("")).toBe(false);
    expect(getUnlocks()).toEqual([]);
  });
});

describe("tutorial seen-flags — whole-unit, keyed by any id (room or shared tutorial)", () => {
  it("starts unseen, then persists a seen tutorial id", () => {
    expect(hasCompletedTutorial("tier:mixed")).toBe(false);
    completeTutorial("tier:mixed");
    expect(hasCompletedTutorial("tier:mixed")).toBe(true);
  });

  it("is idempotent and tracks ids independently", () => {
    completeTutorial("py-code-tutorial-000");
    completeTutorial("py-code-tutorial-000");
    expect(hasCompletedTutorial("py-code-tutorial-000")).toBe(true);
    expect(hasCompletedTutorial("concept:loops")).toBe(false);
  });

  it("resetTutorials clears every seen flag", () => {
    completeTutorial("concept:loops");
    resetTutorials();
    expect(hasCompletedTutorial("concept:loops")).toBe(false);
  });
});

describe("resetCodex — wipes ALL progress (commands AND unlocks)", () => {
  it("clears both the discovered commands and the earned unlocks", () => {
    discover([{ name: "print", note: "shows text" }]);
    addUnlock("puzzle1.cleared");
    expect(getCodex().length).toBe(1);
    expect(getUnlocks()).toEqual(["puzzle1.cleared"]);

    resetCodex();

    expect(getCodex()).toEqual([]);
    expect(getUnlocks()).toEqual([]);
  });
});
