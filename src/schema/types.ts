// ---------------------------------------------------------------------------
// THE CONTRACT (Phase 1 of the roadmap)
//
// These types mirror content/packs/*.json and src/schema/puzzle.schema.json.
// The engine (consumer) and the generation layer (producer) BOTH speak these
// types. Change them in one place and everything downstream follows.
//
// Two axes — keep them straight:
//   PuzzleType    = CLOSED set. Engine code. The LLM picks from these; never invents.
//   language      = OPEN string. Pure content/data. The engine NEVER branches on it.
// ---------------------------------------------------------------------------

/** Engine-supported interaction formats. Closed set. */
export type PuzzleType =
  | "match"
  | "fill_blank"
  | "reorder"
  | "sentence_build" // grammar: arrange tagged words into a sentence structure
  | "combine"        // word-logic: combine objects to reach a described outcome
  | "code_build"     // assemble code blocks from a discovered-command palette
  | "predict_output"
  | "fix_the_bug";

/** How a submission is checked. Closed set. */
export type ValidatorType =
  | "exact_match"
  | "normalized_match"
  | "set_match"
  | "sequence_match"
  | "combine_match"  // unordered comparison of the chosen ingredient set
  | "code_match"     // compares the program's produced output (light, pattern tier)
  | "mc_index"
  | "execution_match"; // heavy tier — not registered until the sandbox exists

export type Difficulty = 1 | 2 | 3 | 4 | 5;

// --- Type-specific payload / solution shapes (discriminated by puzzle_type) ---

export interface MatchPayload {
  /** Canonical correct pairs. The renderer shuffles the right column for display. */
  pairs: { left: string; right: string }[];
}
export interface MatchSolution {
  /** left -> right. Validated unordered by `set_match`. */
  mapping: Record<string, string>;
}

export interface FillBlankPayload {
  /** Text with blanks marked as "____". */
  text: string;
  blank_count: number;
}
export interface FillBlankSolution {
  answers: string[];
}

export interface ReorderPayload {
  /** Presented shuffled; player drags into order. */
  tokens: string[];
}
export interface ReorderSolution {
  /** Correct token order. Validated by `sequence_match`. */
  order: string[];
}

// --- sentence_build (grammar) ---
// The pack ships the STRUCTURE (the ordered roles, e.g. subject → verb → object)
// and a bag of words each TAGGED with its role. The engine constructs the labelled
// slots from `structure` and lets the player drop words in; it never needs to know
// English grammar — only that a word's role should match the slot it lands in.
export interface SentenceSlot {
  /** machine role, e.g. "subject" | "verb" | "object" | "adjective". */
  role: string;
  /** learner-facing prompt drawn on the slot, e.g. "who?" */
  label: string;
}
export interface SentenceWord {
  text: string;
  role: string; // which slot this word belongs in; extras can be decoys
}
export interface SentencePayload {
  structure: SentenceSlot[];
  /** Presented shuffled; may include more words than slots (decoys). */
  words: SentenceWord[];
  /** Optional worked example shown above the board to model the structure. */
  example?: string;
}
// sentence_build is validated by `sequence_match` against ReorderSolution.order.

// --- combine (word-logic / rock-paper-scissors-water) ---
export interface CombineItem {
  id: string;   // referenced by recipes & solution
  label: string; // learner-facing, e.g. "✂️ scissors"
}
export interface CombineRecipe {
  /** Unordered set of item ids that react together. */
  inputs: string[];
  /** What the combination produces, shown to the player. */
  result: string;
}
export interface CombinePayload {
  /** The outcome the player must achieve, in plain words. */
  goal: string;
  items: CombineItem[];
  recipes: CombineRecipe[];
}
export interface CombineSolution {
  /** The winning unordered set of item ids. Checked by `combine_match`. */
  inputs: string[];
}

// --- code_build (assemble simple code from a palette of command blocks) ---
export interface CodeToken {
  text: string; // what is written into the program, e.g. print  or  "hello"
  /** functional tokens do something; `decoy` tokens are red herrings. */
  kind: "function" | "keyword" | "string" | "value" | "punctuation" | "decoy";
  /** if set, successfully using this token unlocks it in the player's Codex. */
  discovers?: string;
}
export interface CodeBuildPayload {
  /** Story text framing the puzzle ("you find yourself looking at a blue planet…"). */
  scenario: string;
  goal: string;
  /** Blocks offered in the palette; player arranges a subset into one line. */
  tokens: CodeToken[];
}
export interface CodeBuildSolution {
  /** The output the assembled program must produce. Checked by `code_match`. */
  output: string;
}

// (predict_output / fix_the_bug payloads live in the contract but are deferred —
//  see Phase 4. Stubbed here so the types compile and the schema stays honest.)
export interface CodePayload {
  snippet: string;
  language: string;
}
export interface CodeSolution {
  output?: string;
  fixed_code?: string;
}

export type Payload =
  | MatchPayload
  | FillBlankPayload
  | ReorderPayload
  | SentencePayload
  | CombinePayload
  | CodeBuildPayload
  | CodePayload;
export type Solution =
  | MatchSolution
  | FillBlankSolution
  | ReorderSolution
  | CombineSolution
  | CodeBuildSolution
  | CodeSolution;

// --- The puzzle itself ---

export interface PuzzleMetadata {
  /** Short concept name, e.g. "common greetings". */
  concept?: string;
  tags?: string[];
  /** "human" | "llm:<model>" — provenance matters for review. */
  generator?: string;
  /** Offline safety gate: a pack should not ship unreviewed puzzles. */
  reviewed: boolean;
}

export interface Puzzle {
  id: string;
  schema_version: string;
  language: string;        // OPEN. Engine treats this as an opaque label.
  puzzle_type: PuzzleType; // CLOSED.
  validator_type: ValidatorType;
  difficulty: Difficulty;
  prompt: string;
  payload: Payload;
  solution: Solution;
  hints: string[];
  metadata: PuzzleMetadata;
}

export interface Pack {
  pack_id: string;
  schema_version: string;
  language: string;
  puzzles: Puzzle[];
}

// --- Engine-facing interfaces (Phase 2.2) ---

export interface ValidationResult {
  correct: boolean;
  feedback: string;
}

export interface Validator {
  validate(submission: unknown, solution: Solution): ValidationResult;
}

export interface PuzzleRenderer {
  /** Build the input UI into `container`; call onSubmit(submission) when the player answers. */
  render(
    container: HTMLElement,
    puzzle: Puzzle,
    onSubmit: (submission: unknown) => void
  ): void;
}
