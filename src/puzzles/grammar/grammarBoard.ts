// ---------------------------------------------------------------------------
// GRAMMAR puzzle — pure board construction for the PUSH format. NO DOM.
//
// Grammar now matches the logic/vocab format: the slime PUSHES word-tiles
// (shared ruleEngine.tryMove) into a row of sentence-frame slots. This module
// builds the push Board + reads which word sits in each slot, so both the DOM
// module and the playthrough test drive the exact same pure core. The role/order
// check stays in grammarCheck.ts (unchanged).
// ---------------------------------------------------------------------------

import type { GrammarBuildPayload } from "../../schema/types";
import type { Board, Entity, RuleSet } from "../logic/ruleEngine";
import type { PropertyId } from "../logic/schema";
import type { GrammarWord } from "./grammarCheck";

/** The synthetic rule set driving the SHARED push core: the slime moves (you),
 *  word-tiles push. Nothing stops/locks — words can always be re-pushed. */
export const PUSH_RULES: RuleSet = {
  rules: [],
  properties: new Map<string, Set<PropertyId>>([
    ["player", new Set<PropertyId>(["you"])],
    ["tile", new Set<PropertyId>(["push"])],
  ]),
  transforms: [],
};

/** Resolved word content for a tile id (looked up when reading the slots). */
export interface GrammarBoard {
  board: Board;
  /** tile entity id → its word (text + role), for the checker + labels. */
  words: Map<string, GrammarWord>;
}

/**
 * Build the push Board from the pack payload. Word positions and the frame are in
 * BOARD coords (0-based from the room's floor origin); `playerCell` is the slime's
 * board cell (the caller converts the room spawn). Every word becomes a pushable
 * tile entity; the frame is not entities (just target cells — see slotCell).
 */
export function buildGrammarBoard(
  payload: GrammarBuildPayload,
  floorW: number,
  floorH: number,
  playerCell: { x: number; y: number },
): GrammarBoard {
  const words = new Map<string, GrammarWord>();
  const entities: Entity[] = [
    { id: "player", noun: "player", x: playerCell.x, y: playerCell.y },
  ];
  payload.words.forEach((w, i) => {
    const id = `w${i}`;
    words.set(id, { text: w.text, role: w.role });
    entities.push({ id, noun: "tile", x: w.pos.x, y: w.pos.y });
  });
  return {
    board: { width: floorW, height: floorH, entities, pattern: { slots: [], directions: [] } },
    words,
  };
}

/** The board cell of frame slot `i` (slots run left→right from `frame`). */
export function slotCell(payload: GrammarBuildPayload, i: number): { x: number; y: number } {
  return { x: payload.frame.x + i, y: payload.frame.y };
}

/** What word sits in each frame slot right now (null = empty), for the checker. */
export function filledSlots(gb: GrammarBoard, payload: GrammarBuildPayload): (GrammarWord | null)[] {
  return payload.structure.map((_, i) => {
    const cell = slotCell(payload, i);
    const ent = gb.board.entities.find((e) => e.id !== "player" && e.x === cell.x && e.y === cell.y);
    return ent ? gb.words.get(ent.id) ?? null : null;
  });
}
