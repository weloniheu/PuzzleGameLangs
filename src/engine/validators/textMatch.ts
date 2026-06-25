import type { Validator, ValidationResult, Solution, FillBlankSolution } from "../../schema/types";

/** Trim-only string equality. Used by simple fill-blank. */
export const exactMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const answers = (solution as FillBlankSolution).answers ?? [];
    const sub = (submission as string[]) ?? [];
    const ok =
      sub.length === answers.length &&
      sub.every((s, i) => (s ?? "").trim() === answers[i].trim());
    return ok
      ? { correct: true, feedback: "Correct!" }
      : { correct: false, feedback: "Not quite — check each blank." };
  },
};

/** Fold case, whitespace, and Hawaiian/Latin diacritics before comparing. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks (kahakō, accents)
    .replace(/[ʻ'`]/g, "")           // strip ʻokina and apostrophes
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const normalizedMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const answers = (solution as FillBlankSolution).answers ?? [];
    const sub = (submission as string[]) ?? [];
    const ok =
      sub.length === answers.length &&
      sub.every((s, i) => normalize(s ?? "") === normalize(answers[i]));
    return ok
      ? { correct: true, feedback: "Correct!" }
      : { correct: false, feedback: "Close — check spelling and accents." };
  },
};
