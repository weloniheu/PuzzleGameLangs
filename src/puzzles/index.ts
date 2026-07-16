// ---------------------------------------------------------------------------
// Room puzzle-module registry: puzzle_type → RoomPuzzleModule. Mirrors the card
// path's renderers/validators registries — the room host DISPATCHES through
// this table and never names a type (CLAUDE.md Rule 1). A new room puzzle type
// = a new module folder here + one registry line; zero host changes.
// ---------------------------------------------------------------------------

import type { PuzzleType } from "../schema/types";
import type { RoomPuzzleModule } from "../engine/puzzleModule";
import { codingModule } from "./coding";
import { logicModule } from "./logic";
import { grammarModule } from "./grammar";
import { vocabModule } from "./vocab";

const MODULES: Partial<Record<PuzzleType, RoomPuzzleModule>> = {
  [codingModule.puzzleType]: codingModule,
  [logicModule.puzzleType]: logicModule,
  [grammarModule.puzzleType]: grammarModule,
  [vocabModule.puzzleType]: vocabModule,
};

/** The module registered for a puzzle type, or null (a room with no module still
 *  gets the full shared engine: movement, inventory, dialogue, portals, settings). */
export function moduleFor(puzzleType: PuzzleType): RoomPuzzleModule | null {
  return MODULES[puzzleType] ?? null;
}
