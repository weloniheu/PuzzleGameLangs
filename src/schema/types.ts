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
  | "logic_rules"    // Baba-style rule manipulation (room-only; see src/puzzles/logic/)
  | "grammar_build"  // fill role-slots in a sentence frame (room-only; see src/puzzles/grammar/)
  | "vocab_match"    // Sokoban push-to-match vocabulary (room-only; see src/puzzles/vocab/)
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

// --- Difficulty axes 2 & 3 (CLOSED sets — new engine dispatch axes, siblings of
//     `difficulty`). The engine reads these like it reads `puzzle_type`; it still never
//     reads `language` / `level` / `pack_id`, so CLAUDE.md Rule 1 holds. Content picks
//     from these; a level is a (concept × tier × mode × modifiers) cell. ---

/** Axis 2 — MECHANICAL depth: a syntax-scaffolding FADE (each tier removes one support).
 *  CLOSED. NOTE: `randomized` used to live here; it is now an Axis-3 modifier. */
export type MechanicTier =
  | "base"          // the floor: distractors, scattered order, indentation-as-placement,
                    // multi-line composition, goal/output-only display; NO punctuation required
  | "mixed"         // structural punctuation is pre-placed/scaffolded; the player fetches the
                    // loose punctuation (commas, arg parens). See CodingArea.prefilled.
  | "explicit"      // no scaffolding; ALL punctuation (incl. colons) is fetched and placed
  | "env_clues"     // hints embedded in room decor (SCHEMA HOOK ONLY for now — no rendering)
  | "concept_modes"; // debug / predict interaction modes (see CodeMode)

/** Axis 2, tier 5 — the coding interaction MODE. CLOSED. Dispatched inside the coding module. */
export type CodeMode = "assemble" | "debug" | "predict";

/** A decor-embedded hint (env_clues tier). SCHEMA HOOK ONLY — rendering lands in a later
 *  design task; the engine stores the shape but draws nothing yet. */
export interface EnvClue {
  decorId: string; // which decor object carries the clue
  hint: string;    // the hint text embedded there
}

/** Per-level mechanical config. `tier` is the source of truth; `punctuationRequired` defaults
 *  FROM the tier (mixed/explicit ⇒ true) and may be set explicitly to compose off-tier
 *  variants. Omitting the whole block ⇒ base + assemble (backward compatible). */
export interface MechanicsConfig {
  /** Omitted ⇒ the level claims NO tier: it stays on the modifier-derived ladder rung
   *  (see ladder.ts resolveMechanic), so a board level can declare a `goalSpec` without
   *  collapsing its Shuffled/Shrouded grouping into "Base". */
  tier?: MechanicTier;
  /** Interaction mode. Omitted ⇒ "assemble". */
  mode?: CodeMode;
  /** What the player is shown as the target — desired output and/or a plain-language
   *  description. NEVER the target code (no tier reveals the answer). Display + success
   *  echo only; validation order-matches solution.accepted (Rule 3: no execution). */
  goalSpec?: { output?: string; description?: string };
  /** Order-checker REQUIRES punctuation tokens (stops normalizing them away). Defaults from
   *  the tier (mixed/explicit ⇒ true); set explicitly to compose onto another tier. */
  punctuationRequired?: boolean;
  /** Decor-embedded hints (SCHEMA HOOK ONLY — see EnvClue). */
  envClues?: EnvClue[];
}

/** Axis 3 — stackable environmental MODIFIERS, orthogonal to concept and tier. CLOSED
 *  registry (validated at load); defaults to [] for every level.
 *  - randomized: pile spawn positions shuffled per run (seed is RUNTIME — random at mount,
 *    injected fixed in tests; not stored in pack data).
 *  - lowlight: limited vision radius — a radial falloff pinned to the player's screen cell
 *    (rendered by roomHost; see the `.room-lowlight` rules in style.css). */
export type Modifier = "randomized" | "lowlight";

// --- Type-specific payload / solution shapes (discriminated by puzzle_type) ---

export interface MatchPayload {
  /** Canonical correct pairs. The renderer shuffles the right column for display. */
  pairs: { left: string; right: string }[];
  /** Optional first-time walkthrough (see systems/tutorialOverlay.ts). Persisted per
   *  puzzle TYPE, so only the first match puzzle the player ever meets plays it. */
  guided_tutorial?: DialogueBeat[];
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
  /** Optional first-time walkthrough (see systems/tutorialOverlay.ts). Per-TYPE. */
  guided_tutorial?: DialogueBeat[];
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
  /** Optional first-time walkthrough (see systems/tutorialOverlay.ts). Per-TYPE. */
  guided_tutorial?: DialogueBeat[];
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
   *  "wrong-word") plus "success". The engine reads these and hardcodes none.
   *  Tutorial rooms may also define FIRST-TIME beats keyed by a `first_*` trigger
   *  (see DialogueTrigger) — fired once the first time that mechanic happens. */
  beats?: Record<string, string>;
  /** Pretend shell commands echoed to the terminal as FLAVOR — nothing executes. */
  terminal?: { build: string; run: string };
  /** Portrait-only dialogue (snake + hint giver share one presentation; see below). */
  dialogue?: DialogueConfig;
}

// --- logic_rules (Baba-style rule manipulation; ROOM-ONLY, no card renderer) ---
// The game's own data contract (rule pattern + vocab + boards) lives in a separate
// LOGIC pack (src/puzzles/logic/schema.ts) so a new language stays zero-engine-change.
// This wrapper payload just POINTS the room at that pack.
export interface LogicRulesPayload {
  /** URL of the LogicPack (rule pattern + vocab + boards) this room draws from. */
  pack_url: string;
  /** WHICH board in that pack this room plays — one room per board, so the room's
   *  floor is exactly the board (the engine renders it via the shared tile grid). */
  board_id: string;
  /** Optional room dialogue — same shared shape every room puzzle may declare. */
  dialogue?: DialogueConfig;
}
export interface LogicRulesSolution {
  /** Win conditions live in the logic pack's boards; there is nothing to compare here. */
  note?: string;
}

// --- grammar_build (push word-tiles into a sentence frame; ROOM-ONLY) ---
// Matches the logic/vocab format: the slime PUSHES word-tiles across the grid into
// a row of role-slots; the sentence is checked automatically each move. The frame's
// roles/labels/order, the tagged word bank (with board positions), the acceptable
// role ORDERS, and feedback text are all pack data — a new language is a new pack,
// zero engine change. See src/puzzles/grammar/.
export interface GrammarSlotDef {
  role: string;  // machine role, e.g. "subject" | "verb" — pack-defined, engine-opaque
  label: string; // learner prompt drawn on the slot, e.g. "who?"
}
export interface GrammarWordDef {
  text: string;                  // printed on the tile
  role: string;                  // the role this word can legally fill ("decoy" fits nowhere)
  pos: { x: number; y: number }; // board cell (relative to the room's floor origin)
}
export interface GrammarBuildPayload {
  /** The sentence frame: labeled slots in display order (drawn left→right). */
  structure: GrammarSlotDef[];
  /** The word bank: pushable tiles scattered on the board. */
  words: GrammarWordDef[];
  /** Acceptable ROLE ORDERS for the filled frame (≥1; flexible-order languages
   *  declare several). Usually just [structure.map(s => s.role)]. */
  structures: string[][];
  /** The FIRST slot's board cell; slots run left→right from here. */
  frame: { x: number; y: number };
  /** Move budget for the ★★★ rating (undo refunds moves). Omitted → no rating. */
  par?: number;
  /** Feedback text (CONTENT): "solved" (win banner). The engine hardcodes none. */
  feedback?: Record<string, string>;
  /** Optional room dialogue — same shared shape every room puzzle may declare. */
  dialogue?: DialogueConfig;
}
export interface GrammarBuildSolution {
  /** A canonical correct sentence, for authors/review only (the checker derives
   *  correctness from roles + structures, so alternates also pass). */
  sentence?: string;
}

// --- vocab_match (Sokoban push-to-match; ROOM-ONLY) ---
// The PAIRING SEMANTICS are pack data: a word↔meaning pack and a synonym↔synonym
// pack are the same engine with different `pairs`. Tile ids are opaque; the engine
// never knows which kind of pack it's playing. Tile positions are BOARD cells
// (relative to the room's floor origin); the player starts at the room spawn.
export interface VocabTileDef {
  id: string;                    // opaque pairing id (ASCII slug)
  text: string;                  // what's printed on the tile
  pos: { x: number; y: number }; // board cell
  /** Text the HELP key reveals for this tile (the meaning/translation). CONTENT. */
  help?: string;
}
/** A floor SIGN: a prop with a LOOK (glyph) and a written LABEL in the learning
 *  language. The WORD is always the truth; the picture may lie (a "hoʻopunipuni"
 *  trap). CONTENT decides which lie — the engine only compares tile ids. */
export interface VocabPropDef {
  id: string;
  /** What it LOOKS like — an emoji/glyph drawn on the floor. */
  glyph: string;
  /** What the sign SAYS (learning language) — rendered on a plaque. */
  label: string;
  /** The tile whose word truly belongs at this sign (per the LABEL). Presenting it
   *  confirms (free meaning reveal); presenting anything else is a counted guess. */
  accepts: string;
  /** Whether look and label agree. Drives the ACCUSE verdict; liar props should only
   *  use words the player has already learned (review levels, never first exposure). */
  honest: boolean;
  pos: { x: number; y: number };
  /** Corrective line when a WRONG tile is presented here (state the truth plainly). */
  wrong?: string;
  /** Corrective line when this liar is successfully ACCUSED (Enter beside it). */
  exposed?: string;
}

export interface VocabMatchPayload {
  tiles: VocabTileDef[];
  /** Unordered tile-id pairs that LOCK when pushed together. Tiles in NO pair are
   *  decoys — pure bait; the level wins without them. */
  pairs: [string, string][];
  /** Floor signs (see VocabPropDef). Solid obstacles; catching a liar grants +1
   *  reveal charge, accusing an honest sign costs a guess. */
  props?: VocabPropDef[];
  /** Move budget for the ★★★ rating (undo refunds moves). Omitted → no rating. */
  par?: number;
  /** How many DISTINCT tiles the HELP key may reveal this level. Omitted → unlimited
   *  (tutorials). Spent charges never refund — deduction pressure is the point. */
  reveal_charges?: number;
  /** Feedback text: "solved" (win banner) | "help_none" (help with nothing nearby)
   *  | "mismatch" (a wrong combination was tried) | "reveal_spent" (no charges left). */
  feedback?: Record<string, string>;
  /** Optional room dialogue — same shared shape every room puzzle may declare. */
  dialogue?: DialogueConfig;
}
export interface VocabMatchSolution {
  /** The pairings ARE the solution; this is for authors/review only. */
  note?: string;
}

// --- dialogue (two portrait-only speakers sharing one presentation) ---
export type DialogueTrigger =
  | "on_enter" | "build-first" | "wrong-order" | "wrong-indent" | "wrong-word" | "success" | "hint"
  // GUIDED TUTORIAL beats (room-world `dialogue.guided_tutorial` AND card-game
  // `payload.guided_tutorial` both tag every step this way — see systems/tutorialCard.ts,
  // the shared popup that renders them; content/TUTORIAL_SCRIPTS.md documents authoring).
  | "guided_tutorial"
  // FIRST-TIME triggers (tutorial rooms): fire ONCE the first time that mechanic happens
  // per room-load, through the same beat system. Optional — a room without them is unaffected.
  | "first_pickup" | "first_inventory_full" | "first_place"
  | "first_run_no_build" | "first_wrong_order" | "first_build";
/** Closed set of mechanics a GUIDED TUTORIAL step can block on. The engine reports when
 *  one actually happens (see Dialogue.notify in systems/dialogue.ts); content only picks
 *  from these — it never invents a new one. */
export type TutorialWaitFor =
  | "move" | "interact" | "pickup" | "place" | "build" | "run"
  /** an OPEN door transition — stricter than "interact" (blocked doors / hint giver don't count) */
  | "enter_door"
  // CARD-GAME kinds (fired via systems/tutorialOverlay.ts; see content/TUTORIAL_SCRIPTS.md):
  /** walked into a word block and shoved it one tile (match sokoban mechanic) */
  | "push"
  /** ran a Mix with at least two things in the bowl (combine mechanic) */
  | "combine";
/** Closed set of pictures a GUIDED TUTORIAL step can illustrate itself with (see
 *  systems/tutorialCard.ts). Every `TutorialWaitFor` doubles as a demo — an interactive
 *  step draws the action it is waiting on, for free. The extra kinds below exist for
 *  INFORMATIONAL steps, which have no action to draw but still need a picture: they are
 *  the CONCEPT demos, used when a level introduces a new idea rather than a new control.
 *  Content only picks from this set; the engine owns what each one draws. */
export type TutorialDemo =
  | TutorialWaitFor
  /** a row of slots with one tile already filled in — the "some is done for you" tier */
  | "prefilled"
  /** one line running over and over — what a loop IS */
  | "loop"
  /** a header line with its body stepped one tile to the right — what an INDENT means */
  | "indent"
  /** a named block (header + indented body) sitting apart from the line that calls it */
  | "function"
  /** a value travelling into a named slot in a header — what an ARGUMENT does */
  | "argument"
  /** tiles swapping places — the `randomized` modifier's "shuffled" tier */
  | "shuffle"
  /** the room dark except a circle around the player — the `lowlight` modifier */
  | "lowlight";
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
  /** GUIDED TUTORIAL ONLY: if set, this beat does NOT auto-advance on a timer — it stays
   *  until the player actually performs this action, then advances. Omit for normal beats. */
  waitFor?: TutorialWaitFor;
  /** GUIDED TUTORIAL ONLY: which picture to draw on the card. Defaults to `waitFor`, so an
   *  interactive step illustrates its own action without saying anything. Set it explicitly
   *  to give an INFORMATIONAL step (one with no `waitFor`) a picture — that is how a new
   *  CONCEPT gets shown instead of only described. See TutorialDemo. */
  demo?: TutorialDemo;
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
  /** GUIDED TUTORIAL (content, cut-and-dry, no character): plays ONCE ever, the first time
   *  this room is visited (persisted — see codex.ts tutorial tracking), appended after
   *  `on_enter`. A room without this is unaffected. Settings offers a "replay" that clears
   *  the persisted flag so it plays again next visit. */
  guided_tutorial?: DialogueBeat[];
}

/** A SHARED, reusable first-encounter tutorial (concept / mechanic tier / modifier), stored in
 *  the pack's `tutorials` map and referenced by levels via `tutorial_refs`. Whole-unit: it plays
 *  its full `dialogue` the first time a referencing level is entered, then is marked seen (one
 *  flag per id); "Replay tutorials" clears the flag and it plays the same sequence again. */
export interface TutorialBlock {
  /** The full sequence, delivered through the two-speaker dialogue system. */
  dialogue: DialogueBeat[];
  /** OPTIONAL id of a level that demonstrates the concept (schema hook; not yet auto-used). */
  demoLevel?: string;
}

/** One expected code line for the order-checker: content tokens (in order) + indent. */
export interface CodeAnswerLine {
  content: string[];
  indent: number;
}
export interface CodeBuildSolution {
  /** The output the assembled program must produce (display + success echo). Checked by
   *  `code_match`. NB: this is NOT computed from the player's code (Rule 3: no execution). */
  output: string;
  /** Order-check answer: a LIST of lines (multi-line programs). Sugar for a single accepted
   *  variant — see `accepted`. Normalization per the mechanical tier. */
  lines?: CodeAnswerLine[];
  /** ACCEPTED programs: the placed program passes if it order-matches ANY entry (so genuinely
   *  different-but-correct solutions all pass, without executing anything). `lines`, when set,
   *  is treated as one accepted variant. Populated by base-tier levels with alternate orderings. */
  accepted?: CodeAnswerLine[][];
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
  /** VISUAL classification (6a/5b): punctuation renders as a purple bead, everything
   *  else keeps the word chip. Purely a style token — validation never reads it. */
  kind?: "function" | "keyword" | "string" | "value" | "punctuation" | "decoy";
  /** Distractor tell (6a): dashed border + faded, TRAY-ONLY (a placed decoy renders
   *  plain — the tell marks the unconfirmed pile, not the player's choice). */
  decoy?: boolean;
}
/** Rectangular region (in cells) where the player may place tokens. The line's
 *  indent = a placed token's column minus this region's left edge (`x`). CONTENT. */
export interface CodingArea {
  x: number;       // left edge column (indent 0 is here, against the wall)
  y: number;       // top row
  width: number;   // columns
  height: number;  // rows
  /** MIXED tier: structural punctuation SCAFFOLDED into the area (already placed), so the
   *  player fetches only the loose punctuation. Each token sits at a cell and the order-checker
   *  reads it exactly like a player-placed token. Omitted ⇒ nothing pre-placed. */
  prefilled?: { token: string; x: number; y: number }[];
}
/** Optional, gateable room features. A room renders ONLY the features it declares; an
 *  undeclared feature is not built at all. CLOSED set (engine has a render branch per
 *  feature); content picks from these. Always-on basics (movement, settings) are NOT
 *  features — they need no declaration. The inventory HUD IS a feature: rooms that
 *  carry tokens (hub, code levels) declare it; board rooms (logic) don't. */
export type RoomFeature = "terminal" | "coding_area" | "inventory";

/** Visual skins a room may declare (STYLE axis). CLOSED set — the engine ships one
 *  scoped CSS block per token; content picks. The language→look mapping is a CONTENT
 *  decision made per pack (a Hawaiian pack declares "tropical"); the engine never
 *  derives a skin from a language. A new skin = a new token + CSS, no logic. */
export type RoomTheme = "grove" | "tropical" | "library" | "tech";

export interface RoomLayout {
  width: number;  // columns
  height: number; // rows
  /** One string per row; each char is a tile (see default legend above). */
  tiles: string[];
  /** Optional char→meaning overrides; "spawn" marks the start cell. */
  legend?: Record<string, RoomTile | "spawn">;
  /** Optional visual skin token (see RoomTheme). Omitted → the default warm-sand look. */
  theme?: RoomTheme;
  /** Explicit spawn cell; if omitted, derived from an 'S' tile, else first floor. */
  spawn?: { x: number; y: number };
  /** Word piles placed on floor cells; the player faces one and presses pickup. */
  piles?: RoomPile[];
  /** Region where tokens can be placed (and indent is measured from). */
  coding_area?: CodingArea;
  /** Features this room renders. Undeclared features are not built (see RoomFeature).
   *  Coding-style puzzles declare ["terminal", "coding_area", "inventory"]; the hub
   *  declares ["inventory"]; logic board rooms declare none. */
  features?: RoomFeature[];
  /** How many inventory slots the player has in this room. Resolved room-first, then by
   *  puzzle-type default, then a fallback (see engine/roomFeatures.ts). */
  inventory_slots?: number;
  /** Keyboard-activatable objects in the room (Build / Run). */
  controls?: RoomControl[];
  /** The hint giver's in-room marker (the snake has NO marker — it's portrait-only). */
  hint_giver?: { pos: { x: number; y: number }; marker?: string };
  /** Doors that transition to other rooms/puzzles (data-driven reaction; see engine/doors.ts). */
  doors?: RoomDoor[];
  /** Unlock key granted when this room's puzzle is SOLVED (opens a flagged door elsewhere). */
  grants_unlock?: string;
  /** OVERRIDE for the teleport flash color of flashes that ENTER/TARGET this room. If set,
   *  it wins over the puzzle-type-derived default (see engine/portalColors.ts). CSS color. */
  flash_color?: string;
}

export type RoomActionKind = "build" | "run" | "submit";
/** A labeled object the player stands on and activates with Enter (Build / Run /
 *  Submit). Which module handles which action kind is the module's business. */
export interface RoomControl {
  action: RoomActionKind;
  label: string;
  pos: { x: number; y: number };
}

/** A door's base state. `open` transitions; `locked`/`coming_soon` are blocked until
 *  (for locked) an unlock flag is earned. The REACTION is data-driven — see engine/doors.ts. */
export type DoorState = "open" | "locked" | "coming_soon";
/** A door the player stands on and activates with Enter. CONTENT: one mechanic (interact),
 *  but the reaction depends on this data. The EXIT door is just a door whose `target` is the
 *  hub — there is no special back-system. */
export interface RoomDoor {
  pos: { x: number; y: number };
  /** Room/puzzle id this door opens (e.g. another puzzle, or the hub for an exit door). */
  target: string;
  /** Display text on the door tile. */
  label: string;
  state: DoorState;
  /** If set and present in the saved unlocks, a `locked` door is treated as `open`
   *  (e.g. solving a puzzle earns this key). Ignored for `open`/`coming_soon`. */
  unlock?: string;
  /** Optional beat text shown (via the snake portrait) when the door is blocked. */
  beat?: string;
  /** Optional portal-art image URL shown spinning inside the open portal disc
   *  (e.g. "/assets/codeportal.png"). CONTENT — the engine only renders it. */
  icon?: string;
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
  | LogicRulesPayload
  | GrammarBuildPayload
  | VocabMatchPayload
  | CodePayload;
export type Solution =
  | MatchSolution
  | FillBlankSolution
  | ReorderSolution
  | CombineSolution
  | CodeBuildSolution
  | LogicRulesSolution
  | GrammarBuildSolution
  | VocabMatchSolution
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
  /** OPTIONAL Axis-2 mechanical config (tier / mode / switches). Omitted ⇒ guided + assemble,
   *  so every existing level keeps its behavior unchanged (see MechanicsConfig). */
  mechanics?: MechanicsConfig;
  /** OPTIONAL Axis-3 stackable modifiers (validated against the closed registry). Omitted ⇒ []. */
  modifiers?: Modifier[];
  /** OPTIONAL ids of SHARED tutorials (see Pack.tutorials) to play on first entry, in order,
   *  BEFORE this room's own guided_tutorial. Each plays whole, once (per-id seen flag). */
  tutorial_refs?: string[];
  /** OPTIONAL world layer. When present, the puzzle opens in a walkable room. */
  room?: RoomLayout;
  /** OPTIONAL label marking this as a tutorial room. Purely a content label — the engine
   *  NEVER branches on it. A tutorial room's only behavioral difference is that it defines
   *  `first_*` beats (see DialogueTrigger); there is no separate tutorial engine. */
  tutorial?: boolean;
}

/** One entry in a puzzle type's ORDERED level list. A level is available when its
 *  `unlock` key is earned (the first level has none). Completing a level grants the
 *  next level's unlock (via the room's `grants_unlock`). CONTENT. */
export interface LevelEntry {
  id: string;        // puzzle/room id this level mounts
  label: string;     // display text in the destination menu
  unlock?: string;   // unlock key required to be available (omit for the first level)
  /** LADDER grouping key (5a). Usually omitted — stamped at merge from the pack's
   *  `language`. OPAQUE to the engine (grouped by equality, never branched on). */
  language?: string;
  /** LADDER grouping key (5a): which mechanic rung this level belongs to. Usually
   *  omitted — derived from the puzzle's mechanics tier / modifiers signature
   *  (see engine/core/ladder.ts resolveMechanic). OPAQUE to the engine. */
  mechanic?: string;
}
/** A puzzle type's ordered levels. The destination menu lists the UNLOCKED ones. */
export interface ProgressionEntry {
  puzzle_type: PuzzleType;
  levels: LevelEntry[];
  /** "Coming soon" sibling languages (5a): greyed, non-enterable rows on the ladder's
   *  language rung (e.g. JavaScript / SQL under Coding). `beat` is the line spoken
   *  when selected. Pure CONTENT — zero engine change to add one. */
  locked_languages?: { label: string; beat?: string }[];
}

/** DOCUMENTATION ONLY — the engine NEVER reads this (see content/packs/README.md).
 *  Records a language pack's basic form so authors can find a structurally similar
 *  pack to COPY from (e.g. another predicate-first language starts from the Hawaiian
 *  pack). A typology label is a starting point, never a grammar guarantee: shared
 *  word order does not mean shared articles, agreement, or particles — every copied
 *  construction still needs a speaker's review. */
export interface PackTypology {
  /** Basic constituent order, e.g. "SVO", "VSO (predicate-first)". */
  word_order?: string;
  /** The construction template this pack's structures follow, e.g. "predicate-first-equational". */
  pattern_family?: string;
  notes?: string;
}

export interface Pack {
  pack_id: string;
  schema_version: string;
  language: string;
  /** Learner-facing display name for `language` on the ladder's language rung
   *  (e.g. "Python", "ʻŌlelo Hawaiʻi"). Omitted → the raw key is shown. CONTENT. */
  language_label?: string;
  /** Documentation-only authoring aid; never engine-read. See PackTypology. */
  typology?: PackTypology;
  puzzles: Puzzle[];
  /** Ordered level lists per puzzle type (drives the menu portal's destination chooser). */
  progression?: ProgressionEntry[];
  /** SHARED first-encounter tutorials, keyed by a content-defined id (e.g. "tier:mixed",
   *  "concept:loops"). Levels opt in via `tutorial_refs`. See TutorialBlock. */
  tutorials?: Record<string, TutorialBlock>;
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
