// ---------------------------------------------------------------------------
// LOGIC puzzle — DOM renderer + local game shell. SELF-CONTAINED.
//
// ISOLATION: imports only the pure logic engine + the pure `teardown` core. It does
// NOT touch roomRenderer/roomManager. The entry points below are shaped so a future
// RoomPuzzleModule adapter can wrap them (mount → handle with destroy()); the guts
// stay here so plugging in later is an adapter, not a rewrite.
//
// STYLE is scoped under `.logic-game` (Rule 5) — injected once, torn down on destroy.
// Input is keyboard-only (Rule 4): arrows / WASD / hjkl move; U undo; R reset; Enter
// advances on win. All three movement schemes are live at once for the prototype.
// ---------------------------------------------------------------------------

import type { LogicPack, LogicPuzzle } from "./schema";
import {
  createBoard,
  step,
  isSolved,
  activeRuleCells,
  DIRECTIONS,
  type Board,
  type Direction,
  type Entity,
} from "./ruleEngine";
import { createTeardown, type Teardown } from "../../engine/core/teardown";

export interface LogicMountHandle {
  destroy(): void;
  /** Feed one movement step (in-room, the engine's input dispatch drives this). */
  move(dir: Direction): void;
  undo(): void;
  reset(): void;
  won(): boolean;
  /** Enter-on-win: fires onSolved iff the puzzle is won. Returns true if consumed. */
  confirmWin(): boolean;
}

// --- keyboard → direction (three schemes live at once; keyboard-only per Rule 4) ---
const MOVE_KEYS: Record<string, Direction> = {
  ArrowUp: DIRECTIONS.up, ArrowDown: DIRECTIONS.down,
  ArrowLeft: DIRECTIONS.left, ArrowRight: DIRECTIONS.right,
  w: DIRECTIONS.up, s: DIRECTIONS.down, a: DIRECTIONS.left, d: DIRECTIONS.right,
  k: DIRECTIONS.up, j: DIRECTIONS.down, h: DIRECTIONS.left, l: DIRECTIONS.right,
};

// --- object-kind display (per-renderer visual default; unknown → tinted initial).
//     Shared with the in-room module (index.ts) so both surfaces draw alike. ---
export const OBJECT_GLYPH: Record<string, string> = {
  slime: "🟢", rock: "🪨", flag: "🚩", wall: "🧱", water: "💧", key: "🗝️", door: "🚪",
};

const STYLE = `
.logic-game { --cell: 46px; display: flex; flex-direction: column; align-items: center;
  gap: 14px; font-family: system-ui, sans-serif; color: #f3ead3; padding: 18px; }
.logic-game .logic-title { font-size: 20px; font-weight: 700; letter-spacing: .3px; }
.logic-game .logic-sub { font-size: 13px; opacity: .75; margin-top: -8px; }
.logic-game .logic-board { display: grid; gap: 2px; background: #3a2f22; padding: 6px;
  border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.35); }
.logic-game .logic-cell { width: var(--cell); height: var(--cell); position: relative;
  background: #6b5a41; border-radius: 5px; display: flex; align-items: center;
  justify-content: center; }
.logic-game .logic-obj { font-size: 26px; line-height: 1; }
.logic-game .logic-obj.badge { font-size: 15px; font-weight: 700; width: 30px; height: 30px;
  border-radius: 6px; display: flex; align-items: center; justify-content: center;
  background: #c98a3a; color: #241a0f; }
.logic-game .logic-word { font-size: 12px; font-weight: 800; letter-spacing: .3px;
  padding: 3px 5px; border-radius: 5px; text-transform: uppercase;
  box-shadow: 0 2px 0 rgba(0,0,0,.3); }
.logic-game .logic-word.noun { background: #e8b04b; color: #2a1d09; }
.logic-game .logic-word.property { background: #6fae7a; color: #10240f; }
.logic-game .logic-word.connector { background: #b9b2a3; color: #241f16; }
.logic-game .logic-word.live { outline: 2px solid #ffe8a3; box-shadow: 0 0 10px #ffd76a; }
.logic-game .logic-hud { font-size: 13px; opacity: .85; text-align: center; line-height: 1.5; }
.logic-game .logic-banner { font-size: 18px; font-weight: 800; color: #ffe08a;
  min-height: 24px; }
`;

/** Deep-enough copy for the undo history (shared with the in-room module). */
export function cloneEntities(entities: Entity[]): Entity[] {
  return entities.map((e) => ({ ...e, word: e.word ? { ...e.word } : undefined }));
}

/**
 * Mount ONE puzzle. Returns a handle whose destroy() runs full teardown (listener +
 * injected DOM). `onSolved` fires once when the player CONFIRMS a win (Enter).
 *
 * `standaloneKeys` (default true) wires this mount's OWN window keydown listener —
 * the standalone /logic.html page uses that. The room engine passes FALSE and drives
 * the returned handle through its shared input dispatch instead, so there is exactly
 * ONE live input pipeline either way (no ghost input).
 */
export function mountLogicPuzzle(
  container: HTMLElement,
  pack: LogicPack,
  puzzle: LogicPuzzle,
  onSolved: () => void,
  opts: { standaloneKeys?: boolean } = {}
): LogicMountHandle {
  const td: Teardown = createTeardown();

  // Inject scoped style once per document.
  if (!document.getElementById("logic-style")) {
    const styleEl = document.createElement("style");
    styleEl.id = "logic-style";
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);
    td.add(() => styleEl.remove());
  }

  const root = document.createElement("div");
  root.className = "logic-game";
  container.appendChild(root);
  td.add(() => root.remove());

  const titleEl = document.createElement("div");
  titleEl.className = "logic-title";
  titleEl.textContent = puzzle.title;
  const subEl = document.createElement("div");
  subEl.className = "logic-sub";
  subEl.textContent = puzzle.hint ?? "Push the words to change the rules.";
  const boardEl = document.createElement("div");
  boardEl.className = "logic-board";
  boardEl.style.gridTemplateColumns = `repeat(${puzzle.width}, var(--cell))`;
  const bannerEl = document.createElement("div");
  bannerEl.className = "logic-banner";
  const hudEl = document.createElement("div");
  hudEl.className = "logic-hud";
  hudEl.innerHTML = "move: <b>arrows / WASD / hjkl</b> &nbsp;·&nbsp; undo: <b>U</b> &nbsp;·&nbsp; reset: <b>R</b>";
  root.append(titleEl, subEl, boardEl, bannerEl, hudEl);

  let board: Board = createBoard(puzzle, pack.vocab, pack.pattern);
  const history: Entity[][] = [];
  let won = false;

  function draw() {
    const live = activeRuleCells(board);
    boardEl.innerHTML = "";
    for (let y = 0; y < board.height; y++) {
      for (let x = 0; x < board.width; x++) {
        const cell = document.createElement("div");
        cell.className = "logic-cell";
        for (const e of board.entities) {
          if (e.x !== x || e.y !== y) continue;
          if (e.word) {
            const chip = document.createElement("div");
            chip.className = `logic-word ${e.word.role}${live.has(`${x},${y}`) ? " live" : ""}`;
            chip.textContent = e.word.text;
            cell.appendChild(chip);
          } else {
            const glyph = OBJECT_GLYPH[e.noun ?? ""];
            const obj = document.createElement("div");
            obj.className = glyph ? "logic-obj" : "logic-obj badge";
            obj.textContent = glyph ?? (e.noun ?? "?").slice(0, 3);
            cell.appendChild(obj);
          }
        }
        boardEl.appendChild(cell);
      }
    }
  }

  function finish() {
    won = true;
    bannerEl.textContent = "✦ Solved! Press Enter ✦";
  }

  function move(dir: Direction) {
    if (won) return;
    history.push(cloneEntities(board.entities));
    const res = step(board, dir);
    draw();
    if (res.status === "won") finish();
  }
  function undo() {
    if (won || !history.length) return;
    board.entities = history.pop()!;
    draw();
  }
  function reset() {
    board = createBoard(puzzle, pack.vocab, pack.pattern);
    history.length = 0;
    won = false;
    bannerEl.textContent = "";
    draw();
  }

  /** Enter-on-win: consume the confirm and report the solve (shared by both drivers). */
  function confirmWin(): boolean {
    if (!won) return false;
    onSolved();
    return true;
  }

  // Standalone driver ONLY (dev /logic.html): this mount's own window listener. The
  // room engine sets standaloneKeys:false and routes its input dispatch to the handle.
  if (opts.standaloneKeys ?? true) {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.key === "Enter" && confirmWin()) return;
      if (key === "u" || key === "z") { e.preventDefault(); undo(); return; }
      if (key === "r") { e.preventDefault(); reset(); return; }
      const dir = MOVE_KEYS[e.key] ?? MOVE_KEYS[key];
      if (dir) { e.preventDefault(); move(dir); }
    };
    window.addEventListener("keydown", onKey);
    td.add(() => window.removeEventListener("keydown", onKey));
  }

  draw();
  if (isSolved(board)) finish(); // a puzzle may start already solved (edge case)

  return { destroy: () => td.run(), move, undo, reset, won: () => won, confirmWin };
}

/**
 * Self-contained game shell: plays the pack's puzzles in order, advancing on win.
 * dev.ts calls this standalone; the RoomPuzzleModule adapter (index.ts) calls it with
 * `standaloneKeys: false` and drives the returned handle through the room engine's
 * input dispatch. Only one puzzle is mounted at a time; each is fully torn down
 * before the next mounts. `onSolved` fires on every confirmed win, before advancing.
 */
export function startLogicGame(
  container: HTMLElement,
  pack: LogicPack,
  opts: { standaloneKeys?: boolean; onSolved?: () => void } = {}
): LogicMountHandle {
  const puzzles = [...pack.puzzles].sort((a, b) => a.difficulty - b.difficulty);
  let current: LogicMountHandle | null = null;
  let i = 0;

  function mountAt(index: number) {
    current?.destroy();
    i = ((index % puzzles.length) + puzzles.length) % puzzles.length;
    current = mountLogicPuzzle(
      container, pack, puzzles[i],
      () => { opts.onSolved?.(); mountAt(i + 1); },
      { standaloneKeys: opts.standaloneKeys },
    );
  }
  mountAt(0);
  return {
    destroy: () => current?.destroy(),
    move: (dir) => current?.move(dir),
    undo: () => current?.undo(),
    reset: () => current?.reset(),
    won: () => current?.won() ?? false,
    confirmWin: () => current?.confirmWin() ?? false,
  };
}
