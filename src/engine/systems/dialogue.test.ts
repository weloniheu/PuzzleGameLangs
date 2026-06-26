import { describe, it, expect } from "vitest";
import {
  startQueue, advanceQueue, currentBeat, queueActive,
  isAutoAdvance, narratorDwell, AUTO_LEN, AUTO_PAUSE,
} from "./dialogue";
import type { DialogueBeat } from "../../schema/types";

// CHARACTERIZATION TEST (B4): locks the dialogue beat-queue advance + the auto-advance /
// dwell decisions, plus the "dialogue active ⇒ gameplay suppressed" rule. Pure (no jsdom);
// the DOM presenter is a 1:1 of the old inline code and uses exactly these helpers.

const beat = (id: string, over: Partial<DialogueBeat> = {}): DialogueBeat => ({
  id, speaker: "snake", text: "hello", trigger: "x", ...over,
});

describe("beat queue — sequencing / end-of-queue", () => {
  it("starts at the first beat and steps through in order", () => {
    const a = beat("a"), b = beat("b"), c = beat("c");
    let s = startQueue([a, b, c]);
    expect(s.idx).toBe(0);
    expect(currentBeat(s)).toBe(a);
    s = advanceQueue(s);
    expect(s.idx).toBe(1);
    expect(currentBeat(s)).toBe(b);
    s = advanceQueue(s);
    expect(currentBeat(s)).toBe(c);
  });

  it("goes INACTIVE (idx -1) when advanced past the last beat", () => {
    let s = startQueue([beat("only")]);
    expect(queueActive(s)).toBe(true);
    s = advanceQueue(s); // past the end
    expect(s.idx).toBe(-1);
    expect(queueActive(s)).toBe(false);
    expect(currentBeat(s)).toBeNull();
  });

  it("an empty sequence stays inactive (no-op, matching playSequence)", () => {
    const s = startQueue([]);
    expect(queueActive(s)).toBe(false);
  });
});

describe("auto-advance vs wait-for-key", () => {
  it("explicit autoAdvance:true wins even for long text", () => {
    expect(isAutoAdvance(beat("x", { autoAdvance: true, text: "x".repeat(100) }), AUTO_LEN)).toBe(true);
  });
  it("explicit autoAdvance:false waits even for short text", () => {
    expect(isAutoAdvance(beat("x", { autoAdvance: false, text: "hi" }), AUTO_LEN)).toBe(false);
  });
  it("no flag: short text (< AUTO_LEN) auto-advances; long text waits", () => {
    expect(isAutoAdvance(beat("x", { text: "short" }), AUTO_LEN)).toBe(true);          // len 5 < 48
    expect(isAutoAdvance(beat("x", { text: "x".repeat(48) }), AUTO_LEN)).toBe(false);  // len 48, not < 48
    expect(isAutoAdvance(beat("x", { text: "x".repeat(60) }), AUTO_LEN)).toBe(false);
  });
});

describe("narratorDwell — readable, length-scaled, capped", () => {
  it("never below AUTO_PAUSE, scales with length, caps at 4000", () => {
    expect(narratorDwell("", AUTO_PAUSE)).toBe(AUTO_PAUSE);                 // max(1700, 0)
    expect(narratorDwell("x".repeat(10), AUTO_PAUSE)).toBe(AUTO_PAUSE);     // max(1700, 450)
    expect(narratorDwell("x".repeat(50), AUTO_PAUSE)).toBe(2250);          // 50*45
    expect(narratorDwell("x".repeat(200), AUTO_PAUSE)).toBe(4000);         // min(4000, 9000)
  });
});

describe("dialogue active ⇒ gameplay suppressed (engine gates on queueActive)", () => {
  it("movement input does NOT fire while a sequence is active, fires once it ends", () => {
    let s = startQueue([beat("a"), beat("b")]);
    const moves: string[] = [];
    // The engine's rule: only dispatch gameplay when no dialogue is active.
    const tryMove = () => { if (!queueActive(s)) moves.push("moved"); };

    tryMove();             // beat a showing → suppressed
    s = advanceQueue(s);   // beat b showing → still active
    tryMove();             // suppressed
    expect(moves).toEqual([]);

    s = advanceQueue(s);   // past end → inactive
    tryMove();             // now allowed
    expect(moves).toEqual(["moved"]);
  });
});
