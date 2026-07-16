// ---------------------------------------------------------------------------
// LOGIC puzzle type — data contract (Baba-Is-You-style rule manipulation).
//
// ISOLATION: this file (and everything in src/puzzles/logic/) is self-contained.
// It does NOT import from src/engine/renderers/* and adds nothing to that monolith.
// It mirrors the "two axes" philosophy of the main schema WITHOUT touching it:
//
//   • PROPERTY behaviors ("you", "stop", "push", "win") + noun→noun TRANSFORM are
//     the ENGINE's closed set — mechanics the rule engine understands.
//   • The WORDS for those behaviors, the object kinds, the RULE-PATTERN (slot order)
//     and the puzzles are all DATA in a pack. A new language = a new pack, zero
//     engine change. The litmus test holds: no `if (language === …)` in the engine.
// ---------------------------------------------------------------------------

/** Behaviors the engine knows how to apply. CLOSED set — content picks, never invents.
 *  (Analogous to PuzzleType in the main schema.) A word-tile becomes one of these via
 *  its vocab entry's `property`; the word itself is language content. */
export type PropertyId = "you" | "stop" | "push" | "win";

/** The grammatical ROLE a word-tile plays when forming a rule. The pattern's slots
 *  accept roles; the engine never hardcodes which specific words fill them. */
export type WordRole = "noun" | "property" | "connector";

/** A word-tile that names an OBJECT KIND (e.g. the word "ROCK" → object kind "rock"). */
export interface VocabNoun {
  text: string;          // what is printed on the tile, e.g. "ROCK" / "PŌHAKU"
  role: "noun";
  noun: string;          // engine object-kind id this word refers to, e.g. "rock"
}
/** A word-tile that names a BEHAVIOR (e.g. "PUSH" → engine property "push"). */
export interface VocabProperty {
  text: string;
  role: "property";
  property: PropertyId;  // which engine behavior this word grants
}
/** A word-tile that is grammatical glue (the "IS" / "ʻo" / "ka"). It carries meaning
 *  only by its POSITION in the pattern; the engine treats it as structure. */
export interface VocabConnector {
  text: string;
  role: "connector";
}
export type VocabEntry = VocabNoun | VocabProperty | VocabConnector;

/** One position in the rule-pattern template. */
export interface PatternSlot {
  /** Which word-roles may legally sit here. */
  accepts: WordRole[];
  /** Structural slots (the connector) omit this. `subject` = the noun the rule is
   *  ABOUT; `predicate` = what it becomes/does (a property, or a noun for transform). */
  capture?: "subject" | "predicate";
}
export type ReadDirection = "horizontal" | "vertical";

/** The token-order template that constitutes a valid rule in THIS language.
 *  English: [NOUN][IS][PROPERTY] read L→R and top→bottom. A different language is a
 *  different `slots` order — the engine matches board arrangements against this, and
 *  parses no grammar of its own. */
export interface RulePattern {
  slots: PatternSlot[];
  /** Which reading directions the engine scans (default both). */
  directions: ReadDirection[];
}

/** An object-layer thing placed on the board (rock, wall, flag, the entity, …). */
export interface ObjectPlacement {
  noun: string;   // object-kind id (matched by VocabNoun.noun to form rules)
  x: number;
  y: number;
}
/** A word-tile placed on the board. Its role/meaning comes from the pack vocab. */
export interface WordPlacement {
  text: string;   // must exist in the pack vocab
  x: number;
  y: number;
}

export interface LogicPuzzle {
  id: string;
  title: string;
  difficulty: number;
  width: number;
  height: number;
  objects: ObjectPlacement[];
  words: WordPlacement[];
  /** Optional single-line nudge (Baba puzzles rarely need more). */
  hint?: string;
  /** Move budget for the ★★★ rating (authored near-optimal solution length).
   *  Solve ≤ par → ★★★, ≤ 1.6×par → ★★, any solve → ★. Omitted → no rating shown. */
  par?: number;
}

/** DOCUMENTATION ONLY — the engine never reads it; the pack LINT only checks that the
 *  label doesn't contradict the declared pattern (see packLoader). Records the basic
 *  form so authors of structurally similar languages know which pack to COPY. A label
 *  is a starting point, never a grammar guarantee. */
export interface LogicPackTypology {
  /** Basic order, e.g. "SVO", "VSO (predicate-first)". */
  word_order?: string;
  /** The rule-construction family, e.g. "copular-svo", "predicate-first-equational". */
  pattern_family?: string;
  notes?: string;
}

export interface LogicPack {
  pack_id: string;
  schema_version: string;
  language: string;      // OPEN label; the engine never branches on it.
  /** Documentation-only authoring aid (lint-checked for self-consistency only). */
  typology?: LogicPackTypology;
  pattern: RulePattern;
  vocab: VocabEntry[];
  puzzles: LogicPuzzle[];
}
