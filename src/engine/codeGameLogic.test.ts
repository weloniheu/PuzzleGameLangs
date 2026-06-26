import { describe, it, expect } from "vitest";
import {
  checkLine,
  checkProgram,
  run,
  normalizeContent,
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

// Helper: a single placed line at indent 0.
const oneLine = (content: string[], indent = 0): CodeLine[] => [{ content, indent }];

describe("run (build/run state machine)", () => {
  it("refuses to run an unbuilt program → build-first", () => {
    const fresh = createBuildState();
    expect(run(fresh, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: false, reason: "build-first" });
  });

  it("runs once built and reports success for the correct program", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: true });
  });

  it("once built, still reports the specific reason for a wrong line", () => {
    const built = markBuilt(createBuildState());
    expect(run(built, oneLine(["hello", "print"]), ANSWER)).toEqual({ ok: false, reason: "wrong-order" });
  });

  it("editing a built program re-dirties it → run fails build-first again", () => {
    let state = markBuilt(createBuildState());
    expect(run(state, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: true });
    state = markDirty(state); // simulate placing/removing a token after Build
    expect(run(state, oneLine(["print", "hello"]), ANSWER)).toEqual({ ok: false, reason: "build-first" });
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
    expect(checkProgram(twice, ANSWER)).toEqual({ ok: false, reason: "extra-code" });
  });

  it("rejects ANY extra line beyond the answer, even an unrelated stray → extra-code", () => {
    const extra: CodeLine[] = [
      { content: ["print", "hello"], indent: 0 },
      { content: ["return"], indent: 0 },
    ];
    expect(checkProgram(extra, ANSWER)).toEqual({ ok: false, reason: "extra-code" });
  });

  it("still surfaces a single line's own error (order) before counting lines", () => {
    expect(checkProgram(oneLine(["hello", "print"]), ANSWER)).toEqual({ ok: false, reason: "wrong-order" });
  });

  it("an empty program falls out as wrong-word (nothing placed)", () => {
    expect(checkProgram([], ANSWER)).toEqual({ ok: false, reason: "wrong-word" });
  });
});

describe("normalizeContent", () => {
  it("drops punctuation tokens and strips surrounding quotes", () => {
    expect(normalizeContent(["print", "(", '"hello"', ")"])).toEqual(["print", "hello"]);
    expect(normalizeContent(["  print  ", "'x'"])).toEqual(["print", "x"]);
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
