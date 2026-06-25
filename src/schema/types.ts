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
  /** Feedback beats keyed by reason ("build-first" | "wrong-order" | "wrong-indent" |
   *  "wrong-word") plus "success". The engine reads these and hardcodes none. */
  beats?: Record<string, string>;
  /** Pretend shell commands echoed to the terminal as FLAVOR — nothing executes. */
  terminal?: { build: string; run: string };
  /** Portrait-only dialogue (snake + hint giver share one presentation; see below). */
  dialogue?: DialogueConfig;
}

// --- dialogue (two portrait-only speakers sharing one presentation) ---
export type DialogueTrigger =
  | "on_enter" | "build-first" | "wrong-order" | "wrong-indent" | "wrong-word" | "success" | "hint";
/** One spoken beat. `speaker` selects the avatar; `trigger` selects when it fires. */
export interface DialogueBeat {
  id: string;
  speaker: string;          // e.g. "snake" | "hint"
  text: string;
  trigger: DialogueTrigger | string;
  /** true → auto-advance after a pause; omitted → engine auto-advances only short text. */
  autoAdvance?: boolean;
  /** marker id to briefly highlight while this beat shows (e.g. "hint"). */
  highlight?: string;
}
/** A speaker's portrait config (placeholder art is fine; portrait2 = optional talk frame). */
export interface DialogueSpeaker {
  name: string;
  side: "left" | "right";   // which edge the portrait slides in from
  portrait: string;
  portrait2?: string;
}
/** A hint giver line. `tag` is a DATA SEAM for later context-aware selection — ignored now. */
export interface HintBeat {
  text: string;
  tag?: string;
}
export interface DialogueConfig {
  speakers: Record<string, DialogueSpeaker>;
  /** Snake greeting beats played on room enter. */
  on_enter?: DialogueBeat[];
  /** Hint giver's ordered hints (shown one-per-interaction, capped at the last). */
  hints?: HintBeat[];
}
/** One expected code line for the order-checker: content tokens (in order) + indent. */
export interface CodeAnswerLine {
  content: string[];
  indent: number;
}
export interface CodeBuildSolution {
  /** The output the assembled program must produce. Checked by `code_match`. */
  output: string;
  /** Order-check answer: a LIST of lines so multi-line difficulties slot in later;
   *  difficulty 1 checks only line 0's content order (ignoring punctuation/quotes). */
  lines?: CodeAnswerLine[];
}

// --- Room (world layer) ---
// OPTIONAL top-down room a puzzle can live in. Pure CONTENT: the engine reads the
// tile grid from here and never hardcodes a layout. The default char legend is
// '#' wall · '.' floor · 'D' door · 'S' spawn (override per-room with `legend`).
export type RoomTile = "floor" | "wall" | "door";
/** A word pile the player faces and presses pickup on. CONTENT: the engine never
 *  hardcodes which words exist. Piles are infinite for now (consumed on placement
 *  later, not on pickup). They occupy a cell and block movement (you stand and face). */
export interface RoomPile {
  token: string;            // the word added to inventory on pickup
  pos: { x: number; y: number };
}
/** Rectangular region (in cells) where the player may place tokens. The line's
 *  indent = a placed token's column minus this region's left edge (`x`). CONTENT. */
export interface CodingArea {
  x: number;       // left edge column (indent 0 is here, against the wall)
  y: number;       // top row
  width: number;   // columns
  height: number;  // rows
}
export interface RoomLayout {
  width: number;  // columns
  height: number; // rows
  /** One string per row; each char is a tile (see default legend above). */
  tiles: string[];
  /** Optional char→meaning overrides; "spawn" marks the start cell. */
  legend?: Record<string, RoomTile | "spawn">;
  /** Explicit spawn cell; if omitted, derived from an 'S' tile, else first floor. */
  spawn?: { x: number; y: number };
  /** Word piles placed on floor cells; the player faces one and presses pickup. */
  piles?: RoomPile[];
  /** Region where tokens can be placed (and indent is measured from). */
  coding_area?: CodingArea;
  /** How many inventory slots the player has in this room. Engine defaults if absent. */
  inventory_slots?: number;
  /** Keyboard-activatable objects in the room (Build / Run). */
  controls?: RoomControl[];
  /** The hint giver's in-room marker (the snake has NO marker — it's portrait-only). */
  hint_giver?: { pos: { x: number; y: number }; marker?: string };
}

export type RoomActionKind = "build" | "run";
/** A labeled object the player stands on and activates with Enter (Build / Run). */
export interface RoomControl {
  action: RoomActionKind;
  label: string;
  pos: { x: number; y: number };
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
  /** OPTIONAL world layer. When present, the puzzle opens in a walkable room. */
  room?: RoomLayout;
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
