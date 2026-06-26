// ---------------------------------------------------------------------------
// Code game: build/run state machine + order-checker. PURE, DOM-free, tested.
//
// This EXTENDS the codeMatch philosophy (compare, never execute): we check the
// ORDER of the placed content tokens against a stored answer. No eval, no sandbox.
//
// The answer is a LIST of lines so multi-line difficulties slot in later without a
// rewrite; only line 0 is checked today. Difficulty 1 compares CONTENT token order
// only — punctuation/quotes/parens are normalized away.
// ---------------------------------------------------------------------------

/** One expected line: the content tokens in order + the indent it must sit at. */
export interface AnswerLine {
  content: string[];
  indent: number;
}

export type CheckReason = "build-first" | "wrong-order" | "wrong-indent" | "wrong-word" | "extra-code";
export type CheckResult = { ok: true } | { ok: false; reason: CheckReason };

/** One concrete line read off the board: content tokens (in order) + its indent. Same
 *  shape as AnswerLine, but this is what the PLAYER placed, not the expected answer. */
export interface CodeLine {
  content: string[];
  indent: number;
}

/** A line is "dirty" until Built; placing/removing a token re-dirties it. */
export interface BuildState {
  built: boolean;
}
export function createBuildState(): BuildState {
  return { built: false };
}
/** Placing/removing a token → the line is dirty again (must Build before Run). */
export function markDirty(s: BuildState): BuildState {
  return { ...s, built: false };
}
/** Build → the line is built and ready to Run. */
export function markBuilt(s: BuildState): BuildState {
  return { ...s, built: true };
}

// --- placed tokens: editing scope (dd/dw) + which line the validator evaluates ---
export interface PlacedToken { token: string; x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }

/** Half-open rectangle membership: x ∈ [x, x+width), y ∈ [y, y+height). */
export function inRect(r: Rect | null | undefined, x: number, y: number): boolean {
  return !!r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/** Tokens on ONE row, left-to-right. This is dd's scope: the player's current line
 *  only — never the whole board (any column on that row, in or out of the coding area). */
export function tokensOnRow(placed: PlacedToken[], y: number): PlacedToken[] {
  return placed.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
}

/** The single token at a cell, or null. This is dw's scope (the word under the player). */
export function tokenAtCell(placed: PlacedToken[], x: number, y: number): PlacedToken | null {
  return placed.find((p) => p.x === x && p.y === y) ?? null;
}

/**
 * The line Build/Run evaluates: tokens INSIDE the coding area only, on the first
 * occupied in-area row, left-to-right (+ indent). Tokens placed OUTSIDE the coding
 * area are silently excluded — placement is free, but only the area counts.
 */
export function evaluatedLine(placed: PlacedToken[], area: Rect | null | undefined): {
  content: string[]; indent: number;
} {
  const inside = placed.filter((p) => inRect(area, p.x, p.y));
  if (!inside.length || !area) return { content: [], indent: 0 };
  const firstRow = Math.min(...inside.map((p) => p.y));
  const line = inside.filter((p) => p.y === firstRow).sort((a, b) => a.x - b.x);
  return { content: line.map((p) => p.token), indent: line[0].x - area.x };
}

/**
 * EVERY occupied row inside the coding area, top-to-bottom — i.e. the whole "program",
 * one CodeLine per row (content left-to-right + indent from the area's left edge).
 * The answer is a single line today, so more than one returned line means there's extra
 * code in the area (e.g. the program placed twice). Tokens outside the area are excluded.
 */
export function evaluatedLines(placed: PlacedToken[], area: Rect | null | undefined): CodeLine[] {
  if (!area) return [];
  const inside = placed.filter((p) => inRect(area, p.x, p.y));
  if (!inside.length) return [];
  const rows = [...new Set(inside.map((p) => p.y))].sort((a, b) => a - b);
  return rows.map((y) => {
    const row = inside.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
    return { content: row.map((p) => p.token), indent: row[0].x - area.x };
  });
}

// --- content normalization (difficulty 1: ignore punctuation/quotes/parens) ---
const PUNCTUATION = /^[()[\]{}:;,]+$/;
const isPunctuation = (t: string): boolean => PUNCTUATION.test(t);
const stripQuotes = (t: string): string => t.replace(/^["']|["']$/g, "");

/** Drop punctuation-only tokens and strip surrounding quotes, leaving content words. */
export function normalizeContent(tokens: string[]): string[] {
  return tokens
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !isPunctuation(t))
    .map(stripQuotes);
}

const sameOrder = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameMultiset = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};

/**
 * Order-check ONE line's placed content against the expected answer line.
 *   correct content & order, right indent → ok
 *   correct content & order, wrong indent → "wrong-indent"
 *   same words, different order           → "wrong-order"
 *   a word that isn't in the answer        → "wrong-word"
 */
export function checkLine(placedContent: string[], actualIndent: number, line: AnswerLine): CheckResult {
  const got = normalizeContent(placedContent);
  const want = normalizeContent(line.content);
  if (sameOrder(got, want)) {
    return actualIndent === line.indent ? { ok: true } : { ok: false, reason: "wrong-indent" };
  }
  if (sameMultiset(got, want)) return { ok: false, reason: "wrong-order" };
  return { ok: false, reason: "wrong-word" };
}

/**
 * Order-check the WHOLE program (every occupied in-area row) against the answer.
 * The coding area must contain EXACTLY the answer's lines and nothing more:
 *   more lines than the answer (e.g. the program placed twice) → "extra-code"
 *   otherwise each line is order-checked in turn (first failure wins).
 * A missing expected line is checked as an empty line, which falls out as wrong-word.
 */
export function checkProgram(lines: CodeLine[], answer: AnswerLine[]): CheckResult {
  if (lines.length > answer.length) return { ok: false, reason: "extra-code" };
  for (let i = 0; i < answer.length; i++) {
    const got = lines[i] ?? { content: [], indent: answer[i].indent };
    const res = checkLine(got.content, got.indent, answer[i]);
    if (!res.ok) return res;
  }
  return { ok: true };
}

/**
 * Run the program: a built (non-dirty) program is required first, then the whole
 * program is order-checked against the answer. Running while dirty/unbuilt yields
 * "build-first".
 */
export function run(state: BuildState, lines: CodeLine[], answer: AnswerLine[]): CheckResult {
  if (!state.built) return { ok: false, reason: "build-first" };
  return checkProgram(lines, answer);
}
