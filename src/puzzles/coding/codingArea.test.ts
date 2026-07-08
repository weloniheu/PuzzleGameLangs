import { describe, it, expect } from "vitest";
import { runFeedback } from "./codingArea";

const termCmds = { run: "$ python main.py" };
const output = "hello, world";

describe("runFeedback — doRun's reason → terminal echo + beat routing", () => {
  it("success → the pack output in green, the success beat, no first-time trigger", () => {
    const fb = runFeedback({ ok: true }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "hello, world"], state: "success" });
    expect(fb.firstTrigger).toBeNull();
    expect(fb.beatReason).toBe("success");
  });

  it("build-first → 'nothing built' error and the first_run_no_build teaching trigger", () => {
    const fb = runFeedback({ ok: false, reason: "build-first" }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "error: nothing built"], state: "error" });
    expect(fb.firstTrigger).toBe("first_run_no_build");
    expect(fb.beatReason).toBe("build-first");
  });

  it("wrong-order → generic no-output error and the first_wrong_order teaching trigger", () => {
    const fb = runFeedback({ ok: false, reason: "wrong-order" }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "(no output)"], state: "error" });
    expect(fb.firstTrigger).toBe("first_wrong_order");
    expect(fb.beatReason).toBe("wrong-order");
  });

  it("extra-code → its own error text, NO first-time trigger (straight to the reason beat)", () => {
    const fb = runFeedback({ ok: false, reason: "extra-code" }, termCmds, output);
    expect(fb.term).toEqual({ lines: ["$ python main.py", "error: unexpected extra code"], state: "error" });
    expect(fb.firstTrigger).toBeNull();
    expect(fb.beatReason).toBe("extra-code");
  });

  it("wrong-word / wrong-indent → generic no-output error, no first-time trigger", () => {
    for (const reason of ["wrong-word", "wrong-indent"] as const) {
      const fb = runFeedback({ ok: false, reason }, termCmds, output);
      expect(fb.term.lines[1]).toBe("(no output)");
      expect(fb.firstTrigger).toBeNull();
      expect(fb.beatReason).toBe(reason);
    }
  });
});
