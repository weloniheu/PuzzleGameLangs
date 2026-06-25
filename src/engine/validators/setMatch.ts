import type { Validator, ValidationResult, Solution, MatchSolution } from "../../schema/types";

/**
 * Unordered comparison. The submission is a left->right mapping; it is correct
 * iff it contains exactly the same {left,right} pairs as the solution.
 * Used by `match` puzzles.
 */
export const setMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const sol = (solution as MatchSolution).mapping;
    const sub = (submission ?? {}) as Record<string, string>;

    const solKeys = Object.keys(sol);
    const subKeys = Object.keys(sub);

    if (subKeys.length !== solKeys.length) {
      return { correct: false, feedback: "Pair every item before submitting." };
    }

    const wrong = solKeys.filter((k) => sub[k] !== sol[k]);
    if (wrong.length === 0) {
      return { correct: true, feedback: "Correct! All pairs matched." };
    }
    return {
      correct: false,
      feedback: `${wrong.length} pair${wrong.length > 1 ? "s" : ""} not matched correctly yet.`,
    };
  },
};
