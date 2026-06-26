import type { Validator, ValidatorType } from "../../schema/types";
// import { setMatch } from "./setMatch";
import { sequenceMatch } from "./sequenceMatch";
import { exactMatch, normalizedMatch } from "./textMatch";
import { combineMatch } from "./combineMatch";
import { codeMatch } from "./codeMatch";

/**
 * The engine dispatches on validator_type via this registry. Adding a new
 * validator = register it here. NOTE: there is no `language` anywhere in this
 * file — that is the point.
 *
 * `execution_match` is intentionally absent: it belongs to the heavy sandbox
 * tier (Phase 4) and is not registered until that infrastructure exists. Any
 * puzzle requesting it will be rejected at load, which is the desired behavior.
 */
const registry: Partial<Record<ValidatorType, Validator>> = {
  // set_match: setMatch,
  sequence_match: sequenceMatch, // also used by sentence_build (grammar)
  exact_match: exactMatch,
  normalized_match: normalizedMatch,
  combine_match: combineMatch,
  code_match: codeMatch,         // light pattern tier, not the deferred sandbox
  // mc_index: ...        (add when you implement multiple choice)
  // execution_match: ... (deferred — needs sandbox, see roadmap Phase 4)
};

export function getValidator(type: ValidatorType): Validator {
  const v = registry[type];
  if (!v) throw new Error(`No validator registered for "${type}"`);
  return v;
}

export function hasValidator(type: ValidatorType): boolean {
  return Boolean(registry[type]);
}
