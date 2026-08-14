import { describe, it, expect, beforeEach } from "vitest";
import {
  getUnlocks, hasUnlock, addUnlock, resetCodex, discover, getCodex,
  hasSeenTutorial, markTutorialSeen, resetSeenTutorials,
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

describe("seen tutorials — persistence round-trip", () => {
  it("starts unseen", () => {
    expect(hasSeenTutorial("tier:mixed")).toBe(false);
  });

  it("markTutorialSeen persists and survives a re-read", () => {
    markTutorialSeen("tier:mixed");
    expect(hasSeenTutorial("tier:mixed")).toBe(true);
    expect(hasSeenTutorial("concept:loops")).toBe(false); // independent ids
  });

  it("markTutorialSeen is idempotent and ignores an empty id", () => {
    markTutorialSeen("tier:mixed");
    markTutorialSeen("tier:mixed");
    markTutorialSeen("");
    expect(hasSeenTutorial("tier:mixed")).toBe(true);
    expect(hasSeenTutorial("")).toBe(false);
  });

  it("resetSeenTutorials clears seen state WITHOUT touching earned progress", () => {
    markTutorialSeen("tier:mixed");
    addUnlock("puzzle1.cleared");
    resetSeenTutorials();
    expect(hasSeenTutorial("tier:mixed")).toBe(false);
    expect(getUnlocks()).toEqual(["puzzle1.cleared"]); // untouched
  });
});

describe("resetCodex — wipes ALL progress (commands, unlocks, AND seen tutorials)", () => {
  it("clears discovered commands, earned unlocks, and seen-tutorial state", () => {
    discover([{ name: "print", note: "shows text" }]);
    addUnlock("puzzle1.cleared");
    markTutorialSeen("tier:mixed");
    expect(getCodex().length).toBe(1);
    expect(getUnlocks()).toEqual(["puzzle1.cleared"]);
    expect(hasSeenTutorial("tier:mixed")).toBe(true);

    resetCodex();

    expect(getCodex()).toEqual([]);
    expect(getUnlocks()).toEqual([]);
    expect(hasSeenTutorial("tier:mixed")).toBe(false);
  });
});
