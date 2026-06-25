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

export type CheckReason = "build-first" | "wrong-order" | "wrong-indent" | "wrong-word";
export type CheckResult = { ok: true } | { ok: false; reason: CheckReason };

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
 * Run the program: a built (non-dirty) line is required first, then line 0 is
 * order-checked. Running while dirty/unbuilt yields "build-first".
 */
export function run(
  state: BuildState,
  placedContent: string[],
  actualIndent: number,
  answer: AnswerLine[],
): CheckResult {
  if (!state.built) return { ok: false, reason: "build-first" };
  return checkLine(placedContent, actualIndent, answer[0]);
}
