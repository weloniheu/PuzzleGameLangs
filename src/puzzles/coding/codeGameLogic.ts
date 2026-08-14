// ---------------------------------------------------------------------------
// Code game: build/run state machine + order-checker. PURE, DOM-free, tested.
//
// This EXTENDS the codeMatch philosophy (compare, never execute): we check the
// ORDER of the placed content tokens against a stored answer. No eval, no sandbox.
//
// The answer is a LIST of lines so multi-line difficulties slot in later. The GUIDED
// tier compares CONTENT token order only (punctuation/quotes/parens normalized away);
// the PUNCTUATION tier keeps + requires punctuation via the `requirePunctuation` flag
// threaded through checkLine/checkProgram/run (see normalizeContent).
// ---------------------------------------------------------------------------

/** One expected line: the content tokens in order + the indent it must sit at. */
export interface AnswerLine {
  content: string[];
  indent: number;
}

export type CheckReason = "build-first" | "wrong-order" | "wrong-indent" | "wrong-word" | "extra-code";

/** Enough about the mistake to DESCRIBE it without describing the fix. Only ever names
 *  what the PLAYER placed — never an expected/missing word, never the target indent.
 *  Naming those would make the error a hint, and hints are the hint giver's job. */
export interface CheckDetail {
  /** 0-based index of the offending line. */
  line?: number;
  /** A token the player placed that the answer has no room for (wrong-word only). */
  token?: string;
  /** Every placed token was wanted, there just aren't enough of them. Says "something
   *  is missing" WITHOUT saying what — naming the missing token would be the answer. */
  incomplete?: boolean;
  /** wrong-indent: which way their line is off. Direction only, never the depth. */
  indent?: "deep" | "shallow";
}
export type CheckResult = { ok: true } | { ok: false; reason: CheckReason; detail?: CheckDetail };

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

// --- content normalization ----------------------------------------------------
// GUIDED tier: punctuation/quotes/parens are ignored (content order only). The
// PUNCTUATION tier flips `requirePunctuation` on, so `(` `)` `:` `,` are KEPT and
// order-checked — the player must collect and place them. Quotes are stripped in
// BOTH tiers (a string is a string; the quote chars are never the teaching point).
const PUNCTUATION = /^[()[\]{}:;,]+$/;
const isPunctuation = (t: string): boolean => PUNCTUATION.test(t);
const stripQuotes = (t: string): string => t.replace(/^["']|["']$/g, "");

/** Normalize placed/answer tokens for comparison. Strips surrounding quotes always;
 *  drops punctuation-only tokens UNLESS `requirePunctuation` (the punctuation tier). */
export function normalizeContent(tokens: string[], requirePunctuation = false): string[] {
  return tokens
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && (requirePunctuation || !isPunctuation(t)))
    .map(stripQuotes);
}

/** Does this level's mechanics require punctuation in the answer? The MIXED and EXPLICIT
 *  tiers imply it (the scaffolding fade — the player supplies punctuation); a level may also
 *  set the flag explicitly to compose it onto another tier. Shared by the coding module and
 *  its tests so the two never disagree. */
export function requiresPunctuation(mechanics?: { tier?: string; punctuationRequired?: boolean }): boolean {
  return !!(mechanics?.punctuationRequired || mechanics?.tier === "mixed" || mechanics?.tier === "explicit");
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
export function checkLine(
  placedContent: string[], actualIndent: number, line: AnswerLine, requirePunctuation = false,
): CheckResult {
  const got = normalizeContent(placedContent, requirePunctuation);
  const want = normalizeContent(line.content, requirePunctuation);
  if (sameOrder(got, want)) {
    if (actualIndent === line.indent) return { ok: true };
    return {
      ok: false,
      reason: "wrong-indent",
      detail: { indent: actualIndent > line.indent ? "deep" : "shallow" },
    };
  }
  if (sameMultiset(got, want)) return { ok: false, reason: "wrong-order" };
  const token = unexpectedToken(got, want);
  // No unexpected token ⇒ nothing is WRONG, there just isn't enough of it. Reporting an
  // "unknown word" here would be a false diagnosis (the classic case: the player left the
  // parentheses off, so every token they placed is correct). Flag it as incomplete —
  // which word is missing stays unsaid, because that would be the answer.
  return {
    ok: false,
    reason: "wrong-word",
    detail: token ? { token } : { incomplete: true },
  };
}

/** The first token the player placed that the answer has no room for. Multiset-aware,
 *  so a legitimately repeated word is never blamed for a later duplicate. */
function unexpectedToken(got: string[], want: string[]): string | null {
  const budget = new Map<string, number>();
  for (const w of want) budget.set(w, (budget.get(w) ?? 0) + 1);
  for (const g of got) {
    const left = budget.get(g) ?? 0;
    if (left <= 0) return g;
    budget.set(g, left - 1);
  }
  return null;
}

/**
 * Order-check the WHOLE program (every occupied in-area row) against the answer.
 * The coding area must contain EXACTLY the answer's lines and nothing more:
 *   more lines than the answer (e.g. the program placed twice) → "extra-code"
 *   otherwise each line is order-checked in turn (first failure wins).
 * A missing expected line is checked as an empty line, which falls out as wrong-word.
 */
export function checkProgram(lines: CodeLine[], answer: AnswerLine[], requirePunctuation = false): CheckResult {
  // The first unexpected row is the one past the end of the answer.
  if (lines.length > answer.length) return { ok: false, reason: "extra-code", detail: { line: answer.length } };
  for (let i = 0; i < answer.length; i++) {
    const got = lines[i] ?? { content: [], indent: answer[i].indent };
    const res = checkLine(got.content, got.indent, answer[i], requirePunctuation);
    if (!res.ok) return { ...res, detail: { ...res.detail, line: i } };
  }
  return { ok: true };
}

/**
 * Run the program: a built (non-dirty) program is required first, then the whole
 * program is order-checked against the answer. Running while dirty/unbuilt yields
 * "build-first".
 */
export function run(
  state: BuildState, lines: CodeLine[], answer: AnswerLine[], requirePunctuation = false,
): CheckResult {
  if (!state.built) return { ok: false, reason: "build-first" };
  return checkProgram(lines, answer, requirePunctuation);
}

// --- multiple accepted solutions (base tier: genuinely different programs can be correct) ---
// We NEVER execute (Rule 3); "behavior matching" = order-matching against ANY author-listed
// accepted program. On failure we report the CLOSEST variant's reason (lower rank = nearer to
// correct) so the feedback beat is the most helpful one.
const REASON_RANK: Record<CheckReason, number> = {
  "wrong-indent": 0, // content & order right, just the indent
  "wrong-order": 1,  // right words, wrong order
  "wrong-word": 2,   // a word that isn't in the answer
  "extra-code": 3,   // too many lines
  "build-first": 4,  // not built (handled before per-variant checks)
};

/** Order-check the program against a LIST of accepted answers: ok if it matches ANY; otherwise
 *  the closest variant's failure reason. An empty list behaves like an empty answer (wrong-word). */
export function checkProgramAny(
  lines: CodeLine[], accepted: AnswerLine[][], requirePunctuation = false,
): CheckResult {
  const variants = accepted.length ? accepted : [[]];
  let best: Extract<CheckResult, { ok: false }> | null = null;
  for (const answer of variants) {
    const res = checkProgram(lines, answer, requirePunctuation);
    if (res.ok) return { ok: true };
    if (!best || REASON_RANK[res.reason] < REASON_RANK[best.reason]) best = res;
  }
  return best ?? { ok: false, reason: "wrong-word" };
}

/** run(), but against a set of accepted programs (see checkProgramAny). */
export function runAny(
  state: BuildState, lines: CodeLine[], accepted: AnswerLine[][], requirePunctuation = false,
): CheckResult {
  if (!state.built) return { ok: false, reason: "build-first" };
  return checkProgramAny(lines, accepted, requirePunctuation);
}
