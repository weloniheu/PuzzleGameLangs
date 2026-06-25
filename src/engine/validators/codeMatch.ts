import type { Validator, ValidationResult, Solution, CodeBuildSolution } from "../../schema/types";

/**
 * Light "did the program do the job?" check for `code_build`. The renderer runs
 * the assembled blocks through a tiny, safe pattern-interpreter (NO real eval, NO
 * sandbox) and submits the OUTPUT string. We compare that output to the goal.
 *
 * This is deliberately NOT `execution_match`: that heavy tier (real interpreter in
 * a sandbox) stays deferred per the roadmap. `code_match` only ever sees a string.
 */
export const codeMatch: Validator = {
  validate(submission: unknown, solution: Solution): ValidationResult {
    const want = ((solution as CodeBuildSolution).output ?? "").trim();
    const got = (typeof submission === "string" ? submission : "").trim();

    if (got === want) return { correct: true, feedback: `It printed “${got}”. The alien beams back. ✅` };
    if (!got) return { correct: false, feedback: "Nothing was printed — your snake didn't say anything." };
    return { correct: false, feedback: `Your program said “${got}”, but that's not the response that's needed.` };
  },
};
