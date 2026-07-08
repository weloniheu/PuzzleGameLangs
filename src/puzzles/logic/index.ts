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
import type { Room } from "../../engine/core/room";
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

// Scoped style for the in-room board pieces (word chips + object glyphs + banner).
// Injected once per mount, removed with the room DOM. `.logic-word` role colors
// mirror the standalone page so both surfaces read alike.
const ROOM_STYLE = `
.logic-board-layer { position: absolute; top: 0; left: 0; }
.logic-board-layer .logic-cell-box { position: absolute; display: flex;
  align-items: center; justify-content: center; }
.logic-board-layer .logic-word { font-weight: 800; letter-spacing: .3px;
  text-transform: uppercase; border-radius: 5px; padding: 2px 4px;
  box-shadow: 0 2px 0 rgba(0,0,0,.3); }
.logic-board-layer .logic-word.noun { background: #e8b04b; color: #2a1d09; }
.logic-board-layer .logic-word.property { background: #6fae7a; color: #10240f; }
.logic-board-layer .logic-word.connector { background: #b9b2a3; color: #241f16; }
.logic-board-layer .logic-word.live { outline: 2px solid #ffe8a3; box-shadow: 0 0 10px #ffd76a; }
.logic-board-layer .logic-obj { line-height: 1; }
.logic-board-layer .logic-obj.badge { font-weight: 700; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: #c98a3a; color: #241a0f; }
.logic-room-banner { position: fixed; left: 50%; transform: translateX(-50%);
  top: 56px; z-index: 40; font-weight: 800; font-size: 18px; color: #ffe08a;
  text-shadow: 0 2px 6px rgba(0,0,0,.6); pointer-events: none; }
.logic-room-banner[hidden] { display: none; }
`;

/** Where the board sits in the room: the top-left FLOOR cell (the wall ring is
 *  content; a ringed room puts the board at (1,1)). Derived, never hardcoded. */
function floorOrigin(room: Room): { ox: number; oy: number } {
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (room.grid[y][x] === "floor") return { ox: x, oy: y };
    }
  }
  return { ox: 0, oy: 0 };
}

export const logicModule: RoomPuzzleModule = {
  puzzleType: "logic_rules",

  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle {
    // CONTENT: which LOGIC pack + which of its boards this room plays.
    const payload = puzzle.payload as LogicRulesPayload;
    const { ox, oy } = floorOrigin(ctx.room);

    const styleEl = document.createElement("style");
    styleEl.id = "logic-room-style";
    styleEl.textContent = ROOM_STYLE;
    ctx.container.appendChild(styleEl);

    // The board's entities render as ONE world layer: above the floor tiles,
    // below the player — the engine's grid is the board's grid.
    const boardLayer = document.createElement("div");
    boardLayer.className = "logic-board-layer";
    ctx.addLayer(boardLayer, "over");

    const banner = document.createElement("div");
    banner.className = "logic-room-banner";
    banner.hidden = true;
    ctx.container.appendChild(banner);

    let pack: LogicPack | null = null;
    let boardDef: LogicPuzzle | null = null;
    let board: Board | null = null;
    const history: Entity[][] = [];
    let won = false;
    let disposed = false;

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
          chip.style.fontSize = `${Math.round(tile * 0.24)}px`;
          box.appendChild(chip);
        } else {
          const glyph = OBJECT_GLYPH[e.noun ?? ""];
          const obj = document.createElement("div");
          obj.className = glyph ? "logic-obj" : "logic-obj badge";
          obj.textContent = glyph ?? (e.noun ?? "?").slice(0, 3);
          obj.style.fontSize = `${Math.round(tile * (glyph ? 0.55 : 0.3))}px`;
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
      banner.textContent = "✦ Solved! Walk back to the portal ✦";
      banner.hidden = false;
      ctx.onSolved(); // earns this room's unlock — the next level appears in the exit menu
    }

    function move(dir: { dx: number; dy: number }) {
      if (!board || won) return;
      history.push(cloneEntities(board.entities));
      const res = step(board, dir);
      drawBoard();
      if (res.status === "won") finish();
    }
    function undo() {
      if (!board || won || !history.length) return;
      board.entities = history.pop()!;
      drawBoard();
    }
    function reset() {
      if (!pack || !boardDef) return;
      board = createBoard(boardDef, pack.vocab, pack.pattern);
      history.length = 0;
      won = false;
      banner.hidden = true;
      drawBoard();
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
        drawBoard();
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
        disposed = true; // DOM (layer, banner, style) dies with the room's container wipe
      },
      panel: null,
    };
  },
};
