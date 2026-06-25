import { describe, it, expect } from "vitest";
import {
  checkLine,
  run,
  normalizeContent,
  createBuildState,
  markBuilt,
  markDirty,
  type AnswerLine,
} from "./codeGameLogic";

// The answer for puzzle 001: print("hello") → content order ["print", "hello"], indent 0.
const ANSWER: AnswerLine[] = [{ content: ["print", "hello"], indent: 0 }];
const LINE = ANSWER[0];

describe("checkLine (order-checker)", () => {
  it("accepts the correct content order at the expected indent", () => {
    expect(checkLine(["print", "hello"], 0, LINE)).toEqual({ ok: true });
  });

  it("flags reversed / wrong order", () => {
    expect(checkLine(["hello", "print"], 0, LINE)).toEqual({ ok: false, reason: "wrong-order" });
  });

  it("flags the correct tokens placed at the wrong indent", () => {
    expect(checkLine(["print", "hello"], 1, LINE)).toEqual({ ok: false, reason: "wrong-indent" });
  });

  it("flags a valid-but-wrong word", () => {
    expect(checkLine(["print", "goodbye"], 0, LINE)).toEqual({ ok: false, reason: "wrong-word" });
    expect(checkLine(["write", "hello"], 0, LINE)).toEqual({ ok: false, reason: "wrong-word" });
  });

  it("ignores punctuation, quotes and parens (difficulty 1 = content order only)", () => {
    expect(checkLine(["print", "(", '"hello"', ")"], 0, LINE)).toEqual({ ok: true });
  });
});

describe("run (build/run state machine)", () => {
  it("refuses to run an unbuilt line → build-first", () => {
    const fresh = createBuildState();
    expect(run(fresh, ["print", "hello"], 0, ANSWER)).toEqual({ ok: false, reason: "build-first" });
  });

  it("runs once built and reports success for the correct line", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, ["print", "hello"], 0, ANSWER)).toEqual({ ok: true });
  });

  it("once built, still reports the specific reason for a wrong line", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, ["hello", "print"], 0, ANSWER)).toEqual({ ok: false, reason: "wrong-order" });
  });

  it("editing a built line re-dirties it → run fails build-first again", () => {
    let state = markBuilt(createBuildState());
    expect(run(state, ["print", "hello"], 0, ANSWER)).toEqual({ ok: true });
    state = markDirty(state); // simulate placing/removing a token after Build
    expect(run(state, ["print", "hello"], 0, ANSWER)).toEqual({ ok: false, reason: "build-first" });
  });
});

describe("normalizeContent", () => {
  it("drops punctuation tokens and strips surrounding quotes", () => {
    expect(normalizeContent(["print", "(", '"hello"', ")"])).toEqual(["print", "hello"]);
    expect(normalizeContent(["  print  ", "'x'"])).toEqual(["print", "x"]);
  });
});
