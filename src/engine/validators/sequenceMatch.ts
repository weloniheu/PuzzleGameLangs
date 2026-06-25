import type { Validator, ValidationResult, Solution, ReorderSolution } from "../../schema/types";

/** Ordered comparison. Used by `reorder`. */
export const sequenceMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const order = (solution as ReorderSolution).order ?? [];
    const sub = (submission as string[]) ?? [];
    const ok =
      sub.length === order.length && sub.every((t, i) => t === order[i]);
    return ok
      ? { correct: true, feedback: "Correct order!" }
      : { correct: false, feedback: "The order isn't right yet." };
  },
};
