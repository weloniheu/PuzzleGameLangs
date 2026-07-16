// ---------------------------------------------------------------------------
// The GRAMMAR module — implements RoomPuzzleModule for `grammar_build` rooms
// (registered by puzzle_type in puzzles/index.ts).
//
// SAME FORMAT as logic + vocab: the game IS the room, ONE player (the slime),
// and the mechanic is SHARED Sokoban PUSH (ruleEngine.tryMove) — no inventory,
// no submit button. The slime pushes word-tiles into a row of sentence-frame
// slots; each move the arrangement is checked automatically (grammarCheck, its
// own pure validation — untouched). A wrong-role word sitting in a slot is
// flagged; when the frame reads as a valid sentence the room is solved.
// Roles, words, orders, and feedback text are all PACK DATA.
// ---------------------------------------------------------------------------

import type { GrammarBuildPayload, Puzzle } from "../../schema/types";
import type { EngineContext, MountedPuzzle, RoomPuzzleModule } from "../../engine/puzzleModule";
import { floorOrigin } from "../../engine/core/room";
import { tryMove, DIRECTIONS, type Entity } from "../logic/ruleEngine";
import { checkSentence } from "./grammarCheck";
import { PUSH_RULES, buildGrammarBoard, slotCell, filledSlots, type GrammarBoard } from "./grammarBoard";

// Scoped style (Rule 5): only .grammar-* classes.
const ROOM_STYLE = `
.grammar-slot-layer, .grammar-word-layer { position: absolute; top: 0; left: 0; }
.grammar-slot { position: absolute; box-sizing: border-box; border-radius: 8px;
  border: 2px dashed rgba(74, 48, 22, 0.55); background: rgba(255, 244, 214, 0.28);
  display: flex; align-items: flex-end; justify-content: center; }
.grammar-slot-label { font-weight: 700; line-height: 1; padding-bottom: 8%;
  color: rgba(74, 48, 22, 0.8); }
.grammar-slot.flagged { border-color: #c0392b; border-style: solid;
  background: rgba(220, 80, 60, 0.22); }
.grammar-cell { position: absolute; display: flex; align-items: center; justify-content: center; }
.grammar-word { font-weight: 800; line-height: 1.1; text-align: center; max-width: 92%;
  border-radius: 6px; padding: 6% 8%; background: linear-gradient(#ffe6a6, #f0c464); color: #3a2a12;
  border: 1px solid rgba(74, 48, 22, 0.45);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.5); }
.grammar-banner { position: fixed; left: 50%; transform: translateX(-50%);
  top: 52px; z-index: 40; pointer-events: none;
  font-weight: 800; font-size: 17px; color: #ffe08a;
  background: rgba(24, 19, 11, 0.88); border: 1px solid rgba(255, 224, 138, 0.5);
  border-radius: 999px; padding: 8px 18px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
.grammar-banner[hidden] { display: none; }
`;

export const grammarModule: RoomPuzzleModule = {
  puzzleType: "grammar_build",

  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle {
    // Grammar CONTENT (engine hardcodes none): the frame, the tagged word bank
    // (with board positions), the acceptable role orders, and the win text.
    const payload = puzzle.payload as GrammarBuildPayload;
    const structure = payload.structure;
    const feedback = payload.feedback ?? {};
    const { x: ox, y: oy } = floorOrigin(ctx.room);
    const playerCell = { x: ctx.room.spawn.x - ox, y: ctx.room.spawn.y - oy };

    const styleEl = document.createElement("style");
    styleEl.id = "grammar-room-style";
    styleEl.textContent = ROOM_STYLE;
    ctx.container.appendChild(styleEl);

    const slotLayer = document.createElement("div"); // the frame boxes
    slotLayer.className = "grammar-slot-layer";
    ctx.addLayer(slotLayer, "under");
    const wordLayer = document.createElement("div"); // the pushable word tiles
    wordLayer.className = "grammar-word-layer";
    ctx.addLayer(wordLayer, "over");

    const banner = document.createElement("div");
    banner.className = "grammar-banner";
    banner.hidden = true;
    ctx.container.appendChild(banner);

    let gb: GrammarBoard = buildGrammarBoard(
      payload, ctx.room.width - ox * 2, ctx.room.height - oy * 2, playerCell,
    );
    const player = () => gb.board.entities.find((e) => e.id === "player")!;
    const history: Entity[][] = [];
    let flags: boolean[] = structure.map(() => false); // per-slot wrong-role marker
    let won = false;
    let disposed = false;

    function buildSlots() {
      const tile = ctx.tile();
      const filled = filledSlots(gb, payload);
      slotLayer.innerHTML = "";
      structure.forEach((s, i) => {
        const cell = slotCell(payload, i);
        const el = document.createElement("div");
        el.className = `grammar-slot${flags[i] ? " flagged" : ""}`;
        el.style.width = `${tile}px`;
        el.style.height = `${tile}px`;
        el.style.transform = `translate(${(cell.x + ox) * tile}px, ${(cell.y + oy) * tile}px)`;
        if (filled[i] === null) { // hide the label once a word occupies the slot
          const label = document.createElement("span");
          label.className = "grammar-slot-label";
          label.textContent = s.label;
          label.style.fontSize = `${Math.round(tile * 0.18)}px`;
          el.appendChild(label);
        }
        slotLayer.appendChild(el);
      });
    }

    function drawWords() {
      if (disposed) return;
      const tile = ctx.tile();
      wordLayer.innerHTML = "";
      for (const e of gb.board.entities) {
        if (e.id === "player") continue; // the slime IS the player — no second body
        const box = document.createElement("div");
        box.className = "grammar-cell";
        box.style.width = `${tile}px`;
        box.style.height = `${tile}px`;
        box.style.transform = `translate(${(e.x + ox) * tile}px, ${(e.y + oy) * tile}px)`;
        const chip = document.createElement("div");
        chip.className = "grammar-word";
        chip.textContent = gb.words.get(e.id)?.text ?? e.id;
        chip.style.fontSize = `${Math.round(tile * 0.19)}px`;
        box.appendChild(chip);
        wordLayer.appendChild(box);
      }
      const p = player();
      ctx.movePlayer({ x: p.x + ox, y: p.y + oy }); // pin the slime (camera follows)
    }

    function draw() {
      buildSlots();
      drawWords();
    }

    function evaluate() {
      const res = checkSentence(filledSlots(gb, payload), payload.structures);
      if (res.valid) {
        flags = structure.map(() => false);
        finish();
        return;
      }
      // Passive feedback: flag only slots filled by the WRONG role (empties stay plain).
      flags = res.slots.map((s) => s === "wrong-role");
    }

    function finish() {
      won = true;
      banner.textContent = feedback.solved ?? "✦ That's a sentence! Walk back to the portal ✦";
      banner.hidden = false;
      ctx.onSolved(); // earns this room's unlock — the next level appears in the exit menu
    }

    function move(dir: { dx: number; dy: number }) {
      const snapshot = gb.board.entities.map((e) => ({ ...e }));
      if (!tryMove(gb.board, player(), dir, PUSH_RULES)) return; // fully blocked
      history.push(snapshot);
      // GUIDED TUTORIAL: report what ACTUALLY happened — a step, and any word shoved.
      ctx.dialogue.notify("move");
      if (gb.board.entities.some((e, i) => e.id !== "player" && (e.x !== snapshot[i].x || e.y !== snapshot[i].y))) {
        ctx.dialogue.notify("push");
      }
      evaluate();
      draw();
    }
    function undo() {
      if (won || !history.length) return;
      gb.board.entities = history.pop()!;
      evaluate();
      draw();
    }
    function reset() {
      gb = buildGrammarBoard(payload, ctx.room.width - ox * 2, ctx.room.height - oy * 2, playerCell);
      history.length = 0;
      flags = structure.map(() => false);
      won = false;
      banner.hidden = true;
      draw();
    }

    draw();

    return {
      // Enter is never the module's: the menu portal (the spawn cell) is the exit.
      onInteract: () => false,
      onAction(actionId) {
        const dir = DIRECTIONS[actionId]; // up / down / left / right — same ids as the bindings
        if (dir) {
          if (won) return false; // a solved board releases movement (walk to the portal)
          move(dir);
          return true;
        }
        if (actionId === "undo") { undo(); return true; }
        if (actionId === "reset") { reset(); return true; }
        return false;
      },
      relayout: () => draw(),
      teardown: () => { disposed = true; }, // DOM dies with the room's container wipe
      panel: null,
    };
  },
};
