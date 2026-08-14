import { describe, it, expect } from "vitest";
import {
  checkLine,
  checkProgram,
  checkProgramAny,
  run,
  runAny,
  normalizeContent,
  requiresPunctuation,
  createBuildState,
  markBuilt,
  markDirty,
  tokensOnRow,
  tokenAtCell,
  evaluatedLine,
  evaluatedLines,
  type AnswerLine,
  type CodeLine,
  type PlacedToken,
  type Rect,
} from "./codeGameLogic";

// The answer for puzzle 001: print("hello") → content order ["print", "hello"], indent 0.
const ANSWER: AnswerLine[] = [{ content: ["print", "hello"], indent: 0 }];
const LINE = ANSWER[0];

describe("checkLine (order-checker)", () => {
  it("accepts the correct content order at the expected indent", () => {
    expect(checkLine(["print", "hello"], 0, LINE)).toEqual({ ok: true });
  });

  it("flags reversed / wrong order", () => {
    expect(checkLine(["hello", "print"], 0, LINE)).toMatchObject({ ok: false, reason: "wrong-order" });
  });

  it("flags the correct tokens placed at the wrong indent", () => {
    expect(checkLine(["print", "hello"], 1, LINE)).toMatchObject({ ok: false, reason: "wrong-indent" });
  });

  it("flags a valid-but-wrong word", () => {
    expect(checkLine(["print", "goodbye"], 0, LINE)).toMatchObject({ ok: false, reason: "wrong-word" });
    expect(checkLine(["write", "hello"], 0, LINE)).toMatchObject({ ok: false, reason: "wrong-word" });
  });

  it("ignores punctuation, quotes and parens (difficulty 1 = content order only)", () => {
    expect(checkLine(["print", "(", '"hello"', ")"], 0, LINE)).toEqual({ ok: true });
  });
});

// Helper: a single placed line at indent 0.
const oneLine = (content: string[], indent = 0): CodeLine[] => [{ content, indent }];

// The DETAIL is what lets the terminal say what the player did wrong instead of
// "(no output)". Its hard rule: it may name only what the PLAYER placed — never a
// missing/expected word and never the target indent, or the error becomes a hint.
describe("CheckDetail — enough to describe the mistake, never the fix", () => {
  it("wrong-indent carries the DIRECTION only, never the expected depth", () => {
    expect(checkLine(["print", "hello"], 2, LINE)).toMatchObject({
      reason: "wrong-indent", detail: { indent: "deep" },
    });
    // The answer sits at indent 1 here, so indent 0 is too far LEFT.
    expect(checkLine(["print", "hello"], 0, { content: ["print", "hello"], indent: 1 })).toMatchObject({
      reason: "wrong-indent", detail: { indent: "shallow" },
    });
  });

  it("wrong-word names the token the PLAYER placed", () => {
    expect(checkLine(["prnt", "hello"], 0, LINE)).toMatchObject({
      reason: "wrong-word", detail: { token: "prnt" },
    });
  });

  it("a SHORT line is 'incomplete' and names nothing — the missing word is the answer", () => {
    const res = checkLine(["print"], 0, LINE);
    expect(res).toMatchObject({ ok: false, reason: "wrong-word", detail: { incomplete: true } });
    expect((res as { detail?: { token?: string } }).detail?.token).toBeUndefined();
  });

  it("never blames a legitimately repeated word for a later duplicate", () => {
    const twice: AnswerLine = { content: ["print", "print"], indent: 0 };
    // Two prints are both wanted; the THIRD is the one with no room.
    expect(checkLine(["print", "print", "print"], 0, twice)).toMatchObject({
      reason: "wrong-word", detail: { token: "print" },
    });
    // …and a single print is short, so it reads as incomplete rather than naming a word.
    expect(checkLine(["print"], 0, twice)).toMatchObject({ detail: { incomplete: true } });
  });

  it("checkProgram reports WHICH line failed (0-based)", () => {
    const answer: AnswerLine[] = [
      { content: ["for", "i"], indent: 0 },
      { content: ["print", "hi"], indent: 1 },
    ];
    const body_at_zero: CodeLine[] = [
      { content: ["for", "i"], indent: 0 },
      { content: ["print", "hi"], indent: 0 },
    ];
    expect(checkProgram(body_at_zero, answer)).toMatchObject({
      reason: "wrong-indent", detail: { line: 1, indent: "shallow" },
    });
  });

  it("extra-code points at the first row past the answer", () => {
    const twice: CodeLine[] = [
      { content: ["print", "hello"], indent: 0 },
      { content: ["print", "hello"], indent: 0 },
    ];
    expect(checkProgram(twice, ANSWER)).toMatchObject({ reason: "extra-code", detail: { line: 1 } });
  });

  it("checkProgramAny carries the CLOSEST variant's detail, not the first variant's", () => {
    // Variant B is closer (wrong-indent outranks wrong-word), so its detail must win.
    const accepted: AnswerLine[][] = [
      [{ content: ["write", "hello"], indent: 0 }],
      [{ content: ["print", "hello"], indent: 1 }],
    ];
    expect(checkProgramAny(oneLine(["print", "hello"]), accepted)).toMatchObject({
      reason: "wrong-indent", detail: { indent: "shallow" },
    });
  });
});

describe("run (build/run state machine)", () => {
  it("refuses to run an unbuilt program → build-first", () => {
    const fresh = createBuildState();
    expect(run(fresh, oneLine(["print", "hello"]), ANSWER)).toMatchObject({ ok: false, reason: "build-first" });
  });

  it("runs once built and reports success for the correct program", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: true });
  });

  it("once built, still reports the specific reason for a wrong line", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, oneLine(["hello", "print"]), ANSWER)).toMatchObject({ ok: false, reason: "wrong-order" });
  });

  it("editing a built program re-dirties it → run fails build-first again", () => {
    let state = markBuilt(createBuildState());
    expect(run(state, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: true });
    state = markDirty(state); // simulate placing/removing a token after Build
    expect(run(state, oneLine(["print", "hello"]), ANSWER)).toMatchObject({ ok: false, reason: "build-first" });
  });
});

describe("checkProgram — the coding area must hold EXACTLY the answer's lines", () => {
  it("accepts exactly the one correct line", () => {
    expect(checkProgram(oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: true });
  });

  it("rejects the SAME correct line placed twice → extra-code", () => {
    const twice: CodeLine[] = [
      { content: ["print", "hello"], indent: 0 },
      { content: ["print", "hello"], indent: 0 },
    ];
    expect(checkProgram(twice, ANSWER)).toMatchObject({ ok: false, reason: "extra-code" });
  });

  it("rejects ANY extra line beyond the answer, even an unrelated stray → extra-code", () => {
    const extra: CodeLine[] = [
      { content: ["print", "hello"], indent: 0 },
      { content: ["return"], indent: 0 },
    ];
    expect(checkProgram(extra, ANSWER)).toMatchObject({ ok: false, reason: "extra-code" });
  });

  it("still surfaces a single line's own error (order) before counting lines", () => {
    expect(checkProgram(oneLine(["hello", "print"]), ANSWER)).toMatchObject({ ok: false, reason: "wrong-order" });
  });

  it("an empty program falls out as wrong-word (nothing placed)", () => {
    expect(checkProgram([], ANSWER)).toMatchObject({ ok: false, reason: "wrong-word" });
  });
});

describe("normalizeContent", () => {
  it("drops punctuation tokens and strips surrounding quotes (guided default)", () => {
    expect(normalizeContent(["print", "(", '"hello"', ")"])).toEqual(["print", "hello"]);
    expect(normalizeContent(["  print  ", "'x'"])).toEqual(["print", "x"]);
  });

  it("keeps punctuation but still strips quotes when requirePunctuation is on", () => {
    expect(normalizeContent(["print", "(", '"hello"', ")"], true)).toEqual(["print", "(", "hello", ")"]);
  });
});

// The PUNCTUATION tier: the same tokens that difficulty-1 ignores are now REQUIRED and
// order-checked. The player has to collect and place the parens/colons/commas themselves.
describe("punctuation tier — requirePunctuation keeps ( ) : , in the order-check", () => {
  const ANS: AnswerLine[] = [{ content: ["print", "(", '"hello"', ")"], indent: 0 }];
  const L = ANS[0];

  it("accepts the fully punctuated line (quotes are still normalized away)", () => {
    expect(checkLine(["print", "(", "hello", ")"], 0, L, true)).toEqual({ ok: true });
    expect(checkLine(["print", "(", '"hello"', ")"], 0, L, true)).toEqual({ ok: true });
  });

  it("rejects a line MISSING required punctuation → wrong-word", () => {
    expect(checkLine(["print", "hello"], 0, L, true)).toMatchObject({ ok: false, reason: "wrong-word" });
  });

  it("flags punctuation placed in the wrong order → wrong-order", () => {
    expect(checkLine(["print", ")", "hello", "("], 0, L, true)).toMatchObject({ ok: false, reason: "wrong-order" });
  });

  it("guided mode (default) still treats that punctuation as optional", () => {
    expect(checkLine(["print", "hello"], 0, L)).toEqual({ ok: true });
  });

  it("run threads the flag through the whole program", () => {
    const built = markBuilt(createBuildState());
    const good: CodeLine[] = [{ content: ["print", "(", "hello", ")"], indent: 0 }];
    const missing: CodeLine[] = [{ content: ["print", "hello"], indent: 0 }];
    expect(run(built, good, ANS, true)).toEqual({ ok: true });
    expect(run(built, missing, ANS, true)).toMatchObject({ ok: false, reason: "wrong-word" });
    expect(run(built, missing, ANS, false)).toEqual({ ok: true }); // guided ignores punctuation
  });
});

// Base tier accepts multiple valid programs (order-matched against a SET — never executed).
describe("checkProgramAny / runAny — multiple accepted solutions", () => {
  const V1: AnswerLine[] = [{ content: ["x", "=", "5"], indent: 0 }, { content: ["print", "x"], indent: 0 }];
  const V2: AnswerLine[] = [{ content: ["y", "=", "5"], indent: 0 }, { content: ["print", "y"], indent: 0 }];
  const accepted = [V1, V2];
  const prog = (v: AnswerLine[]): CodeLine[] => v.map((l) => ({ ...l }));

  it("passes when the program matches ANY accepted variant", () => {
    expect(checkProgramAny(prog(V1), accepted)).toEqual({ ok: true });
    expect(checkProgramAny(prog(V2), accepted)).toEqual({ ok: true });
  });

  it("on no match, reports the CLOSEST variant's reason", () => {
    // line 0 reversed → wrong-order vs V1 (right words), only wrong-word vs V2 → wrong-order wins
    const reordered: CodeLine[] = [{ content: ["5", "=", "x"], indent: 0 }, { content: ["print", "x"], indent: 0 }];
    expect(checkProgramAny(reordered, accepted)).toMatchObject({ ok: false, reason: "wrong-order" });
  });

  it("runAny still requires a built program first", () => {
    expect(runAny(createBuildState(), prog(V1), accepted)).toMatchObject({ ok: false, reason: "build-first" });
    expect(runAny(markBuilt(createBuildState()), prog(V1), accepted)).toEqual({ ok: true });
  });
});

describe("requiresPunctuation — derived from a level's mechanics", () => {
  it("true for the mixed/explicit tiers or an explicit flag; false for base", () => {
    expect(requiresPunctuation({ tier: "mixed" })).toBe(true);
    expect(requiresPunctuation({ tier: "explicit" })).toBe(true);
    expect(requiresPunctuation({ tier: "base", punctuationRequired: true })).toBe(true);
    expect(requiresPunctuation({ tier: "base" })).toBe(false);
    expect(requiresPunctuation(undefined)).toBe(false);
  });
});

// A board with tokens on MULTIPLE rows (the case the old single-line test never exercised).
const BOARD: PlacedToken[] = [
  { token: "print", x: 1, y: 2 },
  { token: "hi", x: 2, y: 2 },     // row 2: the player's current line
  { token: "return", x: 1, y: 5 }, // row 5: a DIFFERENT line, must be left alone by dd
  { token: "x", x: 3, y: 5 },
];

describe("tokensOnRow — dd / dw scope is the current line only", () => {
  it("dd targets only the player's current row, not the whole board", () => {
    const cleared = tokensOnRow(BOARD, 2);
    expect(cleared.map((p) => p.token)).toEqual(["print", "hi"]); // row 2, left-to-right
    // The other row is untouched: removing row 2 leaves row 5 intact.
    const remaining = BOARD.filter((p) => !cleared.includes(p));
    expect(remaining.map((p) => p.token)).toEqual(["return", "x"]);
  });

  it("returns nothing for an empty row", () => {
    expect(tokensOnRow(BOARD, 9)).toEqual([]);
  });

  it("dw affects only the token under the player (on the current line)", () => {
    expect(tokenAtCell(BOARD, 2, 2)?.token).toBe("hi"); // current cell on row 2
    expect(tokenAtCell(BOARD, 1, 5)?.token).toBe("return");
    expect(tokenAtCell(BOARD, 9, 9)).toBeNull();
  });
});

describe("evaluatedLine — validation reads ONLY the coding area", () => {
  const area: Rect = { x: 1, y: 1, width: 4, height: 4 }; // cols 1..4, rows 1..4

  it("checks inside-area tokens and silently ignores tokens placed outside", () => {
    const placed: PlacedToken[] = [
      { token: "print", x: 1, y: 2 },   // inside
      { token: "hello", x: 2, y: 2 },   // inside
      { token: "JUNK", x: 9, y: 2 },    // outside (column beyond the area) → ignored
      { token: "STRAY", x: 1, y: 7 },   // outside (row beyond the area) → ignored
    ];
    expect(evaluatedLine(placed, area)).toEqual({ content: ["print", "hello"], indent: 0 });
  });

  it("computes indent from the area's left edge, on the first in-area row", () => {
    const placed: PlacedToken[] = [
      { token: "print", x: 2, y: 3 }, // one cell in from the wall → indent 1
      { token: "hello", x: 3, y: 3 },
    ];
    expect(evaluatedLine(placed, area)).toEqual({ content: ["print", "hello"], indent: 1 });
  });

  it("is empty when every placed token sits outside the coding area", () => {
    const placed: PlacedToken[] = [{ token: "print", x: 9, y: 9 }];
    expect(evaluatedLine(placed, area)).toEqual({ content: [], indent: 0 });
  });
});

describe("evaluatedLines — the whole program (every in-area row, top-to-bottom)", () => {
  const area: Rect = { x: 1, y: 1, width: 7, height: 7 };

  it("returns one line per occupied in-area row, ignoring outside tokens", () => {
    const placed: PlacedToken[] = [
      { token: "print", x: 1, y: 2 }, { token: "hello", x: 2, y: 2 }, // row 2
      { token: "print", x: 1, y: 4 }, { token: "hello", x: 2, y: 4 }, // row 4 — a 2nd line
      { token: "JUNK", x: 9, y: 2 },                                   // outside → ignored
    ];
    expect(evaluatedLines(placed, area)).toEqual([
      { content: ["print", "hello"], indent: 0 },
      { content: ["print", "hello"], indent: 0 },
    ]);
  });

  it("is empty when nothing sits inside the coding area", () => {
    expect(evaluatedLines([{ token: "print", x: 9, y: 9 }], area)).toEqual([]);
  });
});
