import type { Validator, ValidationResult, Solution, CombineSolution } from "../../schema/types";

/**
 * Unordered set comparison for `combine` puzzles. The submission is the array of
 * item ids the player combined; it is correct iff it is the same SET as the
 * winning recipe in the solution (order and duplicates ignored). The engine never
 * knows that "water + fire" puts out a campfire — only that the chosen set matches.
 */
export const combineMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const want = new Set((solution as CombineSolution).inputs ?? []);
    const got = new Set((submission as string[]) ?? []);

    const same =
      want.size === got.size && [...want].every((id) => got.has(id));

    if (same) return { correct: true, feedback: "That combination works! 🎉" };
    if (got.size === 0) return { correct: false, feedback: "Combine some things first." };
    return { correct: false, feedback: "Something happens, but it's not what you need yet." };
  },
};
