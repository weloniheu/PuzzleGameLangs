import { describe, it, expect } from "vitest";
import { describeError, runFeedback } from "./codingArea";

const termCmds = { run: "$ python main.py" };
const output = "hello, world";

// The ERROR channel. Its contract: say what the player did wrong, in the terms of what
// they actually placed — and never what to do instead. Guidance belongs to the hint
// giver, and mixing the two is what made every wrong answer read "(no output)".
describe("describeError — diagnoses, never prescribes", () => {
  it("names the token the PLAYER placed", () => {
    expect(describeError("wrong-word", { token: "prnt" })).toBe("error: unknown word 'prnt'");
  });

  it("an unfinished line is 'missing', NOT 'unknown' — every placed word was correct", () => {
    expect(describeError("wrong-word", { incomplete: true })).toBe("error: something is missing");
  });

  it("falls back to a bare unknown-word when nothing can be named", () => {
    expect(describeError("wrong-word", undefined)).toBe("error: unknown word");
  });

  it("reports order without revealing the order", () => {
    expect(describeError("wrong-order", {})).toBe("error: right words, wrong order");
  });

  it("gives the indent DIRECTION, never the depth", () => {
    expect(describeError("wrong-indent", { indent: "deep" })).toBe("error: wrong indent (too far right)");
    expect(describeError("wrong-indent", { indent: "shallow" })).toBe("error: wrong indent (too far left)");
  });

  it("adds a line number only when the level actually has several lines", () => {
    // Single-line level: the number is noise.
    expect(describeError("wrong-order", { line: 0 })).toBe("error: right words, wrong order");
    // Multi-line: 0-based detail renders as a 1-based line number.
    expect(describeError("wrong-order", { line: 1 }, { multiLine: true }))
      .toBe("error: right words, wrong order on line 2");
    expect(describeError("wrong-indent", { line: 1, indent: "shallow" }, { multiLine: true }))
      .toBe("error: wrong indent on line 2 (too far left)");
  });

  it("an empty coding area says so, rather than blaming a word", () => {
    expect(describeError("wrong-word", undefined, { empty: true })).toBe("error: no code placed");
  });

  it("not-built wins over empty — it is the gate the player actually hit", () => {
    expect(describeError("build-first", undefined, { empty: true })).toBe("error: nothing built yet");
  });

  it("extra code points at the offending line", () => {
    expect(describeError("extra-code", { line: 1 }, { multiLine: true }))
      .toBe("error: unexpected extra code on line 2");
  });
});

describe("runFeedback — doRun's reason → terminal echo + beat routing", () => {
  it("success → the pack output in green, the success beat, no first-time trigger", () => {
    const fb = runFeedback({ ok: true }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "hello, world"], state: "success" });
    expect(fb.firstTrigger).toBeNull();
    expect(fb.beatReason).toBe("success");
  });

  it("build-first → 'nothing built' error and the first_run_no_build teaching trigger", () => {
    const fb = runFeedback({ ok: false, reason: "build-first" }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "error: nothing built yet"], state: "error" });
    expect(fb.firstTrigger).toBe("first_run_no_build");
    expect(fb.beatReason).toBe("build-first");
  });

  it("wrong-order → the order error and the first_wrong_order teaching trigger", () => {
    const fb = runFeedback({ ok: false, reason: "wrong-order" }, termCmds, output);
    expect(fb.term).toEqual({
      lines: ["$ python main.py", "error: right words, wrong order"], state: "error",
    });
    expect(fb.firstTrigger).toBe("first_wrong_order");
    expect(fb.beatReason).toBe("wrong-order");
  });

  it("extra-code → its own error text, NO first-time trigger (straight to the reason beat)", () => {
    const fb = runFeedback({ ok: false, reason: "extra-code" }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "error: unexpected extra code"], state: "error" });
    expect(fb.firstTrigger).toBeNull();
    expect(fb.beatReason).toBe("extra-code");
  });

  it("wrong-word / wrong-indent → a SPECIFIC error, no first-time trigger", () => {
    const word = runFeedback({ ok: false, reason: "wrong-word", detail: { token: "prnt" } }, termCmds, output);
    expect(word.term.lines[1]).toBe("error: unknown word 'prnt'");
    expect(word.firstTrigger).toBeNull();
    expect(word.beatReason).toBe("wrong-word");

    const indent = runFeedback({ ok: false, reason: "wrong-indent", detail: { indent: "deep" } }, termCmds, output);
    expect(indent.term.lines[1]).toBe("error: wrong indent (too far right)");
    expect(indent.firstTrigger).toBeNull();
    expect(indent.beatReason).toBe("wrong-indent");
  });

  it("no failure ever renders the old catch-all '(no output)'", () => {
    const reasons = ["build-first", "wrong-order", "wrong-word", "wrong-indent", "extra-code"] as const;
    for (const reason of reasons) {
      expect(runFeedback({ ok: false, reason }, termCmds, output).term.lines[1]).not.toBe("(no output)");
    }
  });
});
