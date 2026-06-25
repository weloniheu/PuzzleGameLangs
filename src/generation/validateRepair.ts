import type {
  Puzzle, MatchPayload, MatchSolution, PuzzleType, ValidatorType,
  SentencePayload, ReorderSolution, CombinePayload, CombineSolution,
  CodeBuildPayload, CodeBuildSolution,
} from "../schema/types";
import { hasRenderer } from "../engine/renderers";
import { hasValidator } from "../engine/validators";

const PUZZLE_TYPES: PuzzleType[] = [
  "match", "fill_blank", "reorder", "sentence_build", "combine", "code_build",
  "predict_output", "fix_the_bug",
];
const VALIDATOR_TYPES: ValidatorType[] = [
  "exact_match", "normalized_match", "set_match", "sequence_match",
  "combine_match", "code_match", "mc_index", "execution_match",
];

/**
 * The single source of truth for "is this puzzle usable?". Used BOTH when loading
 * curated packs and when filtering freshly generated puzzles (Phase 3.2). In
 * production, back the structural checks with the JSON Schema via `ajv`; the
 * self-consistency checks below are the part JSON Schema can't express.
 */
export function validatePuzzle(p: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const o = p as Partial<Puzzle>;

  // --- structural / enum checks ---
  for (const f of ["id", "schema_version", "language", "prompt"] as const) {
    if (typeof o[f] !== "string" || !(o[f] as string)) errors.push(`missing/invalid "${f}"`);
  }
  if (!o.puzzle_type || !PUZZLE_TYPES.includes(o.puzzle_type)) errors.push(`bad puzzle_type "${o.puzzle_type}"`);
  if (!o.validator_type || !VALIDATOR_TYPES.includes(o.validator_type)) errors.push(`bad validator_type "${o.validator_type}"`);
  if (typeof o.difficulty !== "number" || o.difficulty < 1 || o.difficulty > 5) errors.push(`bad difficulty`);
  if (!Array.isArray(o.hints)) errors.push(`hints must be an array`);
  if (!o.metadata || typeof o.metadata.reviewed !== "boolean") errors.push(`metadata.reviewed (bool) required`);

  // --- the engine must actually be able to run it ---
  if (o.puzzle_type && !hasRenderer(o.puzzle_type)) errors.push(`no renderer for "${o.puzzle_type}"`);
  if (o.validator_type && !hasValidator(o.validator_type)) errors.push(`no validator for "${o.validator_type}" (deferred tier?)`);

  // --- self-consistency: the part that catches "valid JSON, unsolvable puzzle" ---
  if (o.puzzle_type === "match") {
    const pay = o.payload as MatchPayload | undefined;
    const sol = o.solution as MatchSolution | undefined;
    if (!pay?.pairs?.length) {
      errors.push(`match payload needs pairs`);
    } else if (!sol?.mapping) {
      errors.push(`match solution needs mapping`);
    } else {
      const lefts = pay.pairs.map((x) => x.left);
      const rights = pay.pairs.map((x) => x.right);
      for (const l of lefts) {
        if (!(l in sol.mapping)) errors.push(`solution missing mapping for "${l}"`);
        else if (!rights.includes(sol.mapping[l])) errors.push(`mapping for "${l}" points to a non-existent right`);
      }
      if (Object.keys(sol.mapping).length !== lefts.length) errors.push(`mapping size != number of pairs`);
    }
  }

  // sentence_build: the canonical order must be buildable from the offered words.
  if (o.puzzle_type === "sentence_build") {
    const pay = o.payload as SentencePayload | undefined;
    const sol = o.solution as ReorderSolution | undefined;
    if (!pay?.structure?.length) errors.push(`sentence_build payload needs a non-empty structure`);
    if (!pay?.words?.length) errors.push(`sentence_build payload needs words`);
    if (!sol?.order?.length) errors.push(`sentence_build solution needs an order`);
    if (pay?.structure && sol?.order && sol.order.length !== pay.structure.length) {
      errors.push(`solution.order length must equal structure length`);
    }
    if (pay?.words && sol?.order) {
      const bag = new Set(pay.words.map((w) => w.text));
      for (const t of sol.order) if (!bag.has(t)) errors.push(`order word "${t}" is not among payload.words`);
    }
  }

  // combine: the winning set must be reachable via a recipe over existing items.
  if (o.puzzle_type === "combine") {
    const pay = o.payload as CombinePayload | undefined;
    const sol = o.solution as CombineSolution | undefined;
    if (!pay?.items?.length) errors.push(`combine payload needs items`);
    if (!pay?.recipes?.length) errors.push(`combine payload needs recipes`);
    if (!sol?.inputs?.length) errors.push(`combine solution needs inputs`);
    if (pay?.items && sol?.inputs) {
      const ids = new Set(pay.items.map((it) => it.id));
      for (const id of sol.inputs) if (!ids.has(id)) errors.push(`solution input "${id}" is not a known item id`);
    }
    if (pay?.recipes && sol?.inputs) {
      const has = pay.recipes.some(
        (r) => r.inputs.length === sol.inputs.length && new Set(r.inputs).size === new Set([...r.inputs, ...sol.inputs]).size,
      );
      if (!has) errors.push(`no recipe matches the winning solution.inputs set`);
    }
  }

  // code_build: there must be tokens to assemble and a target output.
  if (o.puzzle_type === "code_build") {
    const pay = o.payload as CodeBuildPayload | undefined;
    const sol = o.solution as CodeBuildSolution | undefined;
    if (!pay?.tokens?.length) errors.push(`code_build payload needs tokens`);
    if (!pay?.scenario) errors.push(`code_build payload needs a scenario`);
    if (typeof sol?.output !== "string") errors.push(`code_build solution needs an output string`);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// The generation funnel (Phase 3.2). Offline: an author runs this over raw LLM
// output before anything ships. The SAME function can later run live.
// ---------------------------------------------------------------------------

export interface FunnelResult {
  accepted: Puzzle[];
  rejected: { raw: unknown; errors: string[] }[];
}

/** 1) parse JSON  2) coerce to array  3) validate each  4) sort accept/reject. */
export function runGenerationFunnel(rawText: string): FunnelResult {
  const out: FunnelResult = { accepted: [], rejected: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    out.rejected.push({ raw: rawText, errors: ["output is not valid JSON"] });
    return out;
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    const { ok, errors } = validatePuzzle(item);
    if (ok) out.accepted.push(item as Puzzle);
    else out.rejected.push({ raw: item, errors });
  }
  return out;
}

/**
 * Build a one-shot repair prompt to feed a rejected puzzle + its errors back to
 * the LLM. Cap retries (e.g. 3) at the call site, then give up and log.
 */
export function buildRepairPrompt(badPuzzle: unknown, errors: string[]): string {
  return [
    "The following puzzle JSON failed validation. Fix ONLY the listed problems",
    "and return corrected JSON that conforms to the schema. No commentary.",
    "",
    "Errors:",
    ...errors.map((e) => `- ${e}`),
    "",
    "Puzzle:",
    JSON.stringify(badPuzzle, null, 2),
  ].join("\n");
}
