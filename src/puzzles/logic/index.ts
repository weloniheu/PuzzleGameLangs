// ---------------------------------------------------------------------------
// The LOGIC module — implements RoomPuzzleModule for `logic_rules` rooms
// (registered by puzzle_type in puzzles/index.ts).
//
// The board IS the room: each logic_rules room's floor is exactly one board of
// the LOGIC pack (one room per board — see the wrapper pack), rendered by the
// engine's shared tile substrate. This module draws only the board's ENTITIES
// (word-tiles + objects) as a world layer aligned to the engine grid, and
// drives the UNCHANGED rule engine (createBoard/step/undo/reset/win).
//
// One input pipeline: the engine's dispatch routes movement/undo/reset here.
// The room's menu portal (at spawn) is the exit — Enter falls through to it.
// ---------------------------------------------------------------------------

import type { LogicRulesPayload, Puzzle } from "../../schema/types";
import type { EngineContext, MountedPuzzle, RoomPuzzleModule } from "../../engine/puzzleModule";
import { floorOrigin } from "../../engine/core/room";
import { mulberry32, shuffled, randomSeed } from "../../engine/core/shuffle";
import { getItem, setItem } from "../../engine/core/storage";
import type { LogicPack, LogicPuzzle } from "./schema";
import { loadLogicPack } from "./packLoader";
import { cloneEntities, OBJECT_GLYPH } from "./logicRenderer";
import {
  createBoard,
  step,
  activeRuleCells,
  computeRules,
  hasProperty,
  DIRECTIONS,
  type Board,
  type Entity,
} from "./ruleEngine";

// Scoped skin for logic rooms (Rule 5: this game type's own look, nothing shared is
// restyled — every rule sits under `.logic-room`, a class this module puts on the
// container for the room's lifetime). The FLOOR keeps the coding game's tile grammar
// (flat fill + inset border) in the logic game's own mossy palette; word chips and
// glyphs are the board's pieces. Role colors mirror the standalone page.
const ROOM_STYLE = `
.logic-room .room-tile-layer .tile-floor {
  background: #a3b381;
  box-shadow: inset 0 0 0 1px rgba(84, 100, 58, 0.45);
}
/* Checkerboard read for the board (rooms are odd-width, so row-major parity works). */
.logic-room .room-tile-layer .tile-floor:nth-child(2n) { background: #99aa75; }
.logic-room .room-tile-layer .tile-wall {
  background: #55603c;
  box-shadow: inset 0 0 0 2px rgba(30, 37, 20, 0.55);
}

.logic-board-layer { position: absolute; top: 0; left: 0; }
.logic-board-layer .logic-cell-box { position: absolute; display: flex;
  align-items: center; justify-content: center; }

.logic-board-layer .logic-word { font-weight: 900; letter-spacing: .4px; line-height: 1;
  text-transform: uppercase; border-radius: 6px; padding: 7% 9%;
  border: 1px solid rgba(0,0,0,.28);
  box-shadow: 0 2px 0 rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.28); }
.logic-board-layer .logic-word.noun { background: linear-gradient(#f0bc57, #dda43c); color: #2a1d09; }
.logic-board-layer .logic-word.property { background: linear-gradient(#82c08d, #5f9e6b); color: #0f2410; }
.logic-board-layer .logic-word.connector { background: linear-gradient(#d4cdbd, #b3ab97); color: #241f16; }
.logic-board-layer .logic-word.live {
  outline: 2px solid #ffe8a3;
  animation: logic-live-pulse 1.6s ease-in-out infinite;
}
@keyframes logic-live-pulse {
  0%, 100% { box-shadow: 0 2px 0 rgba(0,0,0,.35), 0 0 8px rgba(255, 215, 106, 0.55); }
  50%      { box-shadow: 0 2px 0 rgba(0,0,0,.35), 0 0 16px rgba(255, 215, 106, 0.95); }
}

.logic-board-layer .logic-obj { line-height: 1; filter: drop-shadow(0 3px 3px rgba(0,0,0,.35)); }
.logic-board-layer .logic-obj.badge { font-weight: 700; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: #c98a3a; color: #241a0f;
  box-shadow: 0 2px 0 rgba(0,0,0,.3), inset 0 0 0 1px rgba(0,0,0,.25); }

.logic-room-banner { position: fixed; left: 50%; transform: translateX(-50%);
  top: 52px; z-index: 40; pointer-events: none;
  font-weight: 800; font-size: 17px; color: #ffe08a;
  background: rgba(24, 19, 11, 0.88); border: 1px solid rgba(255, 224, 138, 0.5);
  border-radius: 999px; padding: 8px 18px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
.logic-room-banner[hidden] { display: none; }
.logic-room-banner .logic-stars { color: #ffcf4a; letter-spacing: 2px; }

/* Live move/par readout — the ECONOMY axis made visible. Undo refunds moves, so
   experimenting is free; the budget only prices the SOLVE. */
.logic-moves-chip { position: fixed; top: 72px; right: 18px; z-index: 40;
  pointer-events: none; font-weight: 700; font-size: 13px; color: #f2e6cf;
  background: rgba(24, 19, 11, 0.82); border: 1px solid rgba(242, 230, 207, 0.3);
  border-radius: 999px; padding: 5px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); }
.logic-moves-chip .over-par { color: #e0a58a; }
`;

/** Star rating for a solve: within par ★★★, within 1.6×par ★★, any solve ★. */
export function starsFor(moves: number, par: number): number {
  if (moves <= par) return 3;
  if (moves <= Math.ceil(par * 1.6)) return 2;
  return 1;
}

/** Persist the best star rating per board (see engine/core/storage; storage may be unavailable). */
function saveBestStars(boardId: string, stars: number) {
  try {
    const key = `logic.stars.${boardId}`;
    const prev = Number(getItem(key) ?? 0);
    if (stars > prev) setItem(key, String(stars));
  } catch { /* private mode etc. — the rating is a reward, not progress */ }
}

export const logicModule: RoomPuzzleModule = {
  puzzleType: "logic_rules",

  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle {
    // CONTENT: which LOGIC pack + which of its boards this room plays.
    const payload = puzzle.payload as LogicRulesPayload;
    // Where the board sits in the room: the top-left floor cell (see core/room).
    const { x: ox, y: oy } = floorOrigin(ctx.room);

    const styleEl = document.createElement("style");
    styleEl.id = "logic-room-style";
    styleEl.textContent = ROOM_STYLE;
    ctx.container.appendChild(styleEl);
    ctx.container.classList.add("logic-room"); // scopes the skin; removed at teardown

    // The board's entities render as ONE world layer: above the floor tiles,
    // below the player — the engine's grid is the board's grid.
    const boardLayer = document.createElement("div");
    boardLayer.className = "logic-board-layer";
    ctx.addLayer(boardLayer, "over");

    const banner = document.createElement("div");
    banner.className = "logic-room-banner";
    banner.hidden = true;
    ctx.container.appendChild(banner);

    const movesChip = document.createElement("div");
    movesChip.className = "logic-moves-chip";
    movesChip.hidden = true;
    ctx.container.appendChild(movesChip);

    let pack: LogicPack | null = null;
    let boardDef: LogicPuzzle | null = null;
    let board: Board | null = null;

    // `randomized` (Axis 3): permute the LOOSE word-tiles — the ones NOT currently
    // part of an active rule — among their own authored cells, so the board's
    // starting rules (e.g. "SLIME IS YOU") always survive the shuffle. One seed per
    // mount: reset() rebuilds the SAME arrangement (reset restores, re-entry rerolls).
    const shuffleSeed = randomSeed();
    function shuffleLooseWords(b: Board) {
      if (!puzzle.modifiers?.includes("randomized")) return;
      const live = activeRuleCells(b);
      const loose = b.entities.filter((e) => e.word && !live.has(`${e.x},${e.y}`));
      const cells = shuffled(loose.map((e) => ({ x: e.x, y: e.y })), mulberry32(shuffleSeed));
      loose.forEach((e, i) => { e.x = cells[i].x; e.y = cells[i].y; });
    }
    const history: Array<{ entities: Entity[]; moves: number }> = [];
    let moves = 0;
    let won = false;
    let disposed = false;

    function updateChip() {
      if (!boardDef) return;
      movesChip.hidden = false;
      if (boardDef.par) {
        const over = moves > boardDef.par;
        movesChip.innerHTML = "";
        const count = document.createElement("span");
        if (over) count.className = "over-par";
        count.textContent = `Moves ${moves}`;
        movesChip.append(count, ` · Par ${boardDef.par}`);
      } else {
        movesChip.textContent = `Moves ${moves}`;
      }
    }

    /** The board entity the engine SLIME embodies: the first object that the active
     *  rules make YOU. One player — the slime IS that entity; its glyph is not drawn.
     *  Derived from the rules each redraw, so a rule change re-picks it (data-driven,
     *  never a hardcoded noun). */
    function youEntity(b: Board): Entity | null {
      const rs = computeRules(b);
      return b.entities.find((e) => !e.word && hasProperty(rs, e.noun, "you")) ?? null;
    }

    function drawBoard() {
      if (!board) return;
      const tile = ctx.tile();
      const live = activeRuleCells(board);
      const you = youEntity(board);
      boardLayer.innerHTML = "";
      for (const e of board.entities) {
        if (e === you) continue; // the SLIME is this entity's body — no second glyph
        const box = document.createElement("div");
        box.className = "logic-cell-box";
        box.style.width = `${tile}px`;
        box.style.height = `${tile}px`;
        box.style.transform = `translate(${(e.x + ox) * tile}px, ${(e.y + oy) * tile}px)`;
        if (e.word) {
          const chip = document.createElement("div");
          chip.className = `logic-word ${e.word.role}${live.has(`${e.x},${e.y}`) ? " live" : ""}`;
          chip.textContent = e.word.text;
          // Long words (LANAKILA, PŌHAKU, …) shrink to stay inside their cell —
          // language is data, so tile text length is unbounded.
          chip.style.fontSize = `${Math.round(tile * Math.min(0.26, 1.5 / e.word.text.length))}px`;
          box.appendChild(chip);
        } else {
          const glyph = OBJECT_GLYPH[e.noun ?? ""];
          const obj = document.createElement("div");
          obj.className = glyph ? "logic-obj" : "logic-obj badge";
          obj.textContent = glyph ?? (e.noun ?? "?").slice(0, 3);
          obj.style.fontSize = `${Math.round(tile * (glyph ? 0.6 : 0.3))}px`;
          if (!glyph) {
            obj.style.width = `${Math.round(tile * 0.66)}px`;
            obj.style.height = `${Math.round(tile * 0.66)}px`;
          }
          box.appendChild(obj);
        }
        boardLayer.appendChild(box);
      }
      // Pin the engine player to the controlled entity (camera follows). If no rule
      // makes anything YOU right now, the slime just stays where it was.
      if (you) ctx.movePlayer({ x: you.x + ox, y: you.y + oy });
    }

    function finish() {
      won = true;
      // Rate the solve when the board carries a par (ECONOMY axis): stars price the
      // move count, never completion — any solve clears the level and its unlock.
      if (boardDef?.par) {
        const stars = starsFor(moves, boardDef.par);
        saveBestStars(boardDef.id, stars);
        banner.innerHTML = "";
        const starsEl = document.createElement("span");
        starsEl.className = "logic-stars";
        starsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
        banner.append(`✦ Solved in ${moves} moves `, starsEl, " — walk back to the portal ✦");
      } else {
        banner.textContent = "✦ Solved! Walk back to the portal ✦";
      }
      banner.hidden = false;
      ctx.onSolved(); // earns this room's unlock — the next level appears in the exit menu
    }

    function move(dir: { dx: number; dy: number }) {
      if (!board || won) return;
      const before = new Map(board.entities.map((e) => [e.id, `${e.x},${e.y}`]));
      const youId = youEntity(board)?.id ?? null;
      history.push({ entities: cloneEntities(board.entities), moves });
      const res = step(board, dir);
      if (res.moved) moves++; // a fully-blocked bump costs nothing
      // GUIDED TUTORIAL: report what ACTUALLY happened — bumping a wall counts as neither.
      const you = board.entities.find((e) => e.id === youId);
      if (you && before.get(you.id) !== `${you.x},${you.y}`) ctx.dialogue.notify("move");
      if (board.entities.some((e) => e.id !== youId && before.get(e.id) !== `${e.x},${e.y}`)) {
        ctx.dialogue.notify("push");
      }
      drawBoard();
      updateChip();
      if (res.status === "won") finish();
    }
    function undo() {
      if (!board || won || !history.length) return;
      const h = history.pop()!;
      board.entities = h.entities;
      moves = h.moves; // undo REFUNDS the move — experimenting is free, the solve is priced
      drawBoard();
      updateChip();
    }
    function reset() {
      if (!pack || !boardDef) return;
      board = createBoard(boardDef, pack.vocab, pack.pattern);
      shuffleLooseWords(board);
      history.length = 0;
      moves = 0;
      won = false;
      banner.hidden = true;
      drawBoard();
      updateChip();
    }

    // The pack loads async (fetch + structural validation — see packLoader). Input
    // no-ops until the board exists; a load failure reports in the banner.
    loadLogicPack(payload.pack_url)
      .then((p) => {
        if (disposed) return;
        const def = p.puzzles.find((z) => z.id === payload.board_id);
        if (!def) throw new Error(`board "${payload.board_id}" is not in ${payload.pack_url}`);
        pack = p;
        boardDef = def;
        board = createBoard(def, p.vocab, p.pattern);
        shuffleLooseWords(board);
        drawBoard();
        updateChip();
      })
      .catch((e) => {
        if (disposed) return;
        banner.textContent = `Could not load the logic pack: ${(e as Error).message}`;
        banner.hidden = false;
      });

    return {
      // Enter is never the module's: it falls through to the engine — standing on the
      // menu portal (the spawn cell) opens the exit chooser, win or not.
      onInteract: () => false,

      onAction(actionId) {
        if (!board) return false; // board not loaded yet
        const dir = DIRECTIONS[actionId]; // up / down / left / right — same ids as the bindings
        // A WON board is frozen and RELEASES movement: the engine walks the slime
        // freely (back to the menu portal — the exit) over the finished board.
        if (dir) {
          if (won) return false;
          move(dir);
          return true;
        }
        if (actionId === "undo") { undo(); return true; }
        if (actionId === "reset") { reset(); return true; }
        return false;
      },

      relayout: () => drawBoard(), // re-render at the new tile size
      teardown: () => {
        disposed = true;
        // The container survives room swaps — take the skin class off it; the DOM
        // (layer, banner, style el) dies with the room's container wipe.
        ctx.container.classList.remove("logic-room");
      },
      panel: null,
    };
  },
};
