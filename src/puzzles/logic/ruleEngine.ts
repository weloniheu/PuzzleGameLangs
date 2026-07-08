// ---------------------------------------------------------------------------
// LOGIC puzzle — the pure rule engine. NO DOM. This is the core; tested hard.
//
// Baba-Is-You-style: the board carries an OBJECT layer and WORD-TILES. Each move the
// engine RE-EVALUATES: (1) scan word arrangements against the pack's RULE-PATTERN to
// find active rules, (2) apply the resulting properties/transforms, (3) resolve
// movement + pushing, (4) recompute rules (words may have moved), (5) check the win.
//
// The engine matches a declared PATTERN — it parses no language. Rules, properties
// and win are all derived; nothing here knows English or Hawaiian. See schema.ts.
// ---------------------------------------------------------------------------

import type {
  LogicPuzzle,
  PropertyId,
  RulePattern,
  VocabEntry,
  WordRole,
} from "./schema";

/** A step vector. Reused shape as engine/core/room's Direction; kept local to avoid
 *  coupling the pure engine to the room module. */
export interface Direction {
  dx: number;
  dy: number;
}
export const DIRECTIONS: Record<string, Direction> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** The resolved meaning of a word-tile on the board (looked up once from vocab). */
export interface ResolvedWord {
  text: string;
  role: WordRole;
  property?: PropertyId; // set iff role === "property"
  noun?: string;         // set iff role === "noun"
}

/** A single board thing. Objects and word-tiles both live here (both can be pushed). */
export interface Entity {
  id: string;
  x: number;
  y: number;
  /** object-layer: the object kind (e.g. "rock"); undefined for word-tiles. */
  noun?: string;
  /** word-layer: the resolved word; undefined for objects. */
  word?: ResolvedWord;
}

export interface Board {
  width: number;
  height: number;
  entities: Entity[];
  pattern: RulePattern;
}

/** What a rule's predicate says the subject IS. */
export type Predicate =
  | { type: "property"; property: PropertyId }
  | { type: "noun"; noun: string }; // transform: subject-kind becomes this kind

export interface Rule {
  subject: string; // object-kind id
  predicate: Predicate;
}

/** The fully-derived consequence of the active rules, ready to apply/query. */
export interface RuleSet {
  rules: Rule[];
  /** object-kind → the behaviors it currently has. */
  properties: Map<string, Set<PropertyId>>;
  /** object-kind transformations to apply (from → to). */
  transforms: Array<{ from: string; to: string }>;
}

// --- board construction ----------------------------------------------------

function indexVocab(vocab: VocabEntry[]): Map<string, VocabEntry> {
  const m = new Map<string, VocabEntry>();
  for (const v of vocab) m.set(v.text, v);
  return m;
}

function resolveWord(entry: VocabEntry): ResolvedWord {
  if (entry.role === "noun") return { text: entry.text, role: "noun", noun: entry.noun };
  if (entry.role === "property") {
    return { text: entry.text, role: "property", property: entry.property };
  }
  return { text: entry.text, role: "connector" };
}

/**
 * Build a live Board from a puzzle + its pack vocab + pattern. Word-tiles are resolved
 * against the vocab once (unknown words throw — packs are validated before play).
 */
export function createBoard(
  puzzle: LogicPuzzle,
  vocab: VocabEntry[],
  pattern: RulePattern
): Board {
  const vindex = indexVocab(vocab);
  const entities: Entity[] = [];
  let n = 0;
  for (const o of puzzle.objects) {
    entities.push({ id: `o${n++}`, x: o.x, y: o.y, noun: o.noun });
  }
  for (const w of puzzle.words) {
    const entry = vindex.get(w.text);
    if (!entry) throw new Error(`word "${w.text}" is not in the pack vocab`);
    entities.push({ id: `w${n++}`, x: w.x, y: w.y, word: resolveWord(entry) });
  }
  return { width: puzzle.width, height: puzzle.height, entities, pattern };
}

// --- queries ---------------------------------------------------------------

export function inBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.width && y < board.height;
}
export function entitiesAt(board: Board, x: number, y: number): Entity[] {
  return board.entities.filter((e) => e.x === x && e.y === y);
}
/** The word-tile occupying a cell (first, if several), or null. */
function wordAt(board: Board, x: number, y: number): Entity | null {
  return board.entities.find((e) => e.x === x && e.y === y && e.word) ?? null;
}

// --- rule scanning (matches the declared PATTERN, knows no language) --------

/** Try to match the pattern starting at (sx,sy) stepping by (dx,dy). Returns the rule
 *  or null. Requires CONTIGUOUS word-tiles whose roles fit each slot in order. */
function matchAt(board: Board, sx: number, sy: number, dx: number, dy: number): Rule | null {
  const slots = board.pattern.slots;
  let subject: ResolvedWord | null = null;
  let predicate: ResolvedWord | null = null;
  for (let i = 0; i < slots.length; i++) {
    const x = sx + dx * i;
    const y = sy + dy * i;
    if (!inBounds(board, x, y)) return null;
    const ent = wordAt(board, x, y);
    if (!ent || !ent.word) return null;
    if (!slots[i].accepts.includes(ent.word.role)) return null;
    if (slots[i].capture === "subject") subject = ent.word;
    else if (slots[i].capture === "predicate") predicate = ent.word;
  }
  if (!subject || !subject.noun || !predicate) return null;
  if (predicate.role === "property" && predicate.property) {
    return { subject: subject.noun, predicate: { type: "property", property: predicate.property } };
  }
  if (predicate.role === "noun" && predicate.noun) {
    return { subject: subject.noun, predicate: { type: "noun", noun: predicate.noun } };
  }
  return null;
}

/** Every active rule on the board, scanned in the pattern's reading directions. */
export function findRules(board: Board): Rule[] {
  const dirs: Direction[] = [];
  if (board.pattern.directions.includes("horizontal")) dirs.push(DIRECTIONS.right);
  if (board.pattern.directions.includes("vertical")) dirs.push(DIRECTIONS.down);
  const out: Rule[] = [];
  const seen = new Set<string>();
  for (const d of dirs) {
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const rule = matchAt(board, x, y, d.dx, d.dy);
        if (!rule) continue;
        const key = `${rule.subject}|${rule.predicate.type}|${
          rule.predicate.type === "property" ? rule.predicate.property : rule.predicate.noun
        }`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rule);
      }
    }
  }
  return out;
}

/** The cells (`"x,y"`) of every word-tile currently participating in a rule. Pure
 *  presentation aid for the renderer to glow "live" words — not used by the engine. */
export function activeRuleCells(board: Board): Set<string> {
  const dirs: Direction[] = [];
  if (board.pattern.directions.includes("horizontal")) dirs.push(DIRECTIONS.right);
  if (board.pattern.directions.includes("vertical")) dirs.push(DIRECTIONS.down);
  const cells = new Set<string>();
  const n = board.pattern.slots.length;
  for (const d of dirs) {
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        if (!matchAt(board, x, y, d.dx, d.dy)) continue;
        for (let i = 0; i < n; i++) cells.add(`${x + d.dx * i},${y + d.dy * i}`);
      }
    }
  }
  return cells;
}

/** Derive the full consequence (properties + transforms) from the active rules. */
export function computeRules(board: Board): RuleSet {
  const rules = findRules(board);
  const properties = new Map<string, Set<PropertyId>>();
  const transforms: Array<{ from: string; to: string }> = [];
  for (const r of rules) {
    if (r.predicate.type === "property") {
      const set = properties.get(r.subject) ?? new Set<PropertyId>();
      set.add(r.predicate.property);
      properties.set(r.subject, set);
    } else if (r.subject !== r.predicate.noun) {
      transforms.push({ from: r.subject, to: r.predicate.noun });
    }
  }
  return { rules, properties, transforms };
}

export function hasProperty(rs: RuleSet, noun: string | undefined, prop: PropertyId): boolean {
  return !!noun && !!rs.properties.get(noun)?.has(prop);
}

// --- movement + pushing (Sokoban) ------------------------------------------

/** Word-tiles are ALWAYS pushable (Baba: text is push). Objects are pushable only
 *  when a rule grants them `push`. */
function isPushable(e: Entity, rs: RuleSet): boolean {
  if (e.word) return true;
  return hasProperty(rs, e.noun, "push");
}
function isStop(e: Entity, rs: RuleSet): boolean {
  return !e.word && hasProperty(rs, e.noun, "stop");
}
function isYou(e: Entity, rs: RuleSet): boolean {
  return !e.word && hasProperty(rs, e.noun, "you");
}

/**
 * Attempt to move `mover` one step in `dir`, pushing any pushables in front. Mutates
 * entity coordinates on success. Returns true if the move happened.
 *
 * Walks the line ahead: a STOP cell (or the boundary while still needing to push)
 * blocks the whole move; pushable cells join the train; the first cell with only
 * overlap-objects (or empty) ends the train and the move commits.
 */
function tryMove(board: Board, mover: Entity, dir: Direction, rs: RuleSet): boolean {
  const train: Entity[] = [mover];
  let cx = mover.x;
  let cy = mover.y;
  for (;;) {
    const nx = cx + dir.dx;
    const ny = cy + dir.dy;
    if (!inBounds(board, nx, ny)) return false;
    const ents = entitiesAt(board, nx, ny);
    if (ents.some((e) => isStop(e, rs))) return false;
    const pushes = ents.filter((e) => isPushable(e, rs));
    if (pushes.length) {
      train.push(...pushes);
      cx = nx;
      cy = ny;
      continue;
    }
    break; // empty or overlap-only cell — the train can advance
  }
  for (const e of train) {
    e.x += dir.dx;
    e.y += dir.dy;
  }
  return true;
}

export type StepStatus = "playing" | "won";
export interface StepResult {
  status: StepStatus;
  /** true if any entity actually moved this step (false = fully blocked / no YOU). */
  moved: boolean;
}

/** Apply queued transforms in place (subject-kind objects become the target kind). */
function applyTransforms(board: Board, rs: RuleSet): boolean {
  let changed = false;
  for (const t of rs.transforms) {
    for (const e of board.entities) {
      if (!e.word && e.noun === t.from) {
        e.noun = t.to;
        changed = true;
      }
    }
  }
  return changed;
}

/** Win when any cell holds both a YOU object and a WIN object (Baba: you on win). */
export function checkWin(board: Board, rs: RuleSet): boolean {
  for (const e of board.entities) {
    if (!isYou(e, rs)) continue;
    const here = entitiesAt(board, e.x, e.y);
    if (here.some((o) => !o.word && hasProperty(rs, o.noun, "win"))) return true;
  }
  return false;
}

/**
 * Advance the board one player move. Re-evaluates rules before moving (who is YOU /
 * push / stop), moves every YOU (leading edge first so a train of YOUs doesn't self-
 * collide), then recomputes rules, applies transforms, and checks the win.
 */
export function step(board: Board, dir: Direction): StepResult {
  const rs0 = computeRules(board);
  const yous = board.entities
    .filter((e) => isYou(e, rs0))
    // move the entity nearest the leading edge (in `dir`) first
    .sort((a, b) => b.x * dir.dx + b.y * dir.dy - (a.x * dir.dx + a.y * dir.dy));

  let moved = false;
  for (const you of yous) {
    if (tryMove(board, you, dir, rs0)) moved = true;
  }

  // Words may have moved → rules can differ now. Apply transforms, then settle rules.
  let rs = computeRules(board);
  if (applyTransforms(board, rs)) rs = computeRules(board);

  return { status: checkWin(board, rs) ? "won" : "playing", moved };
}

/** Win check for the INITIAL board (before any move) — a puzzle may start solved. */
export function isSolved(board: Board): boolean {
  return checkWin(board, computeRules(board));
}
