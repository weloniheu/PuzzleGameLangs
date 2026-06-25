import type { PuzzleRenderer, PuzzleType } from "../../schema/types";
import { matchRenderer } from "./matchRenderer";
import { sentenceRenderer } from "./sentenceRenderer";
import { combineRenderer } from "./combineRenderer";
import { codeRenderer } from "./codeRenderer";

/**
 * The engine dispatches on puzzle_type via this registry. Adding a new puzzle
 * TYPE = build a renderer + register it here (and add a validator). Adding a
 * new LANGUAGE = touch nothing in this file.
 */
const registry: Partial<Record<PuzzleType, PuzzleRenderer>> = {
  match: matchRenderer,
  sentence_build: sentenceRenderer,
  combine: combineRenderer,
  code_build: codeRenderer,
  // fill_blank: ...     (next puzzle type to implement)
  // reorder: ...
  // predict_output: ... (deferred with execution tier — see Phase 4)
  // fix_the_bug: ...
};

export function getRenderer(type: PuzzleType): PuzzleRenderer {
  const r = registry[type];
  if (!r) throw new Error(`No renderer registered for "${type}"`);
  return r;
}

export function hasRenderer(type: PuzzleType): boolean {
  return Boolean(registry[type]);
}
