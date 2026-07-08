// ---------------------------------------------------------------------------
// The engine ⇄ puzzle-module boundary. A room puzzle TYPE (coding, logic, …)
// plugs into the shared room engine by implementing RoomPuzzleModule and
// registering in puzzles/index.ts, keyed by `puzzle_type` — dispatch through a
// registry, exactly like renderers/validators. The host NEVER names a type.
//
// What the engine exposes to a module is an EngineContext of SERVICES (world
// layers, dialogue, inventory, reflow, teardown) — never anything type-aware.
// ---------------------------------------------------------------------------

import type { DialogueBeat, Puzzle, PuzzleType, RoomFeature, RoomLayout } from "../schema/types";
import type { Cell, Room } from "./core/room";
import type { Teardown } from "./core/teardown";
import type { Dialogue } from "./systems/dialogue";
import type { InventoryHud } from "./systems/inventoryHud";

/** A dockable panel the module may own (e.g. the coding terminal). The host reads
 *  dock state for its camera crop / portrait anchoring and drives layout passes. */
export interface PanelHandle {
  isDocked(): boolean;
  dockedH(): number;
  /** Is keyboard focus inside the panel? (esc-ladder routing) */
  containsActive(): boolean;
  /** Write the docked band geometry (called from the host's camera pass). */
  layoutDocked(): void;
  /** Apply the settings-owned panel font size, if this panel has text to size. */
  applyFont?(): void;
}

/** Where a module layer slots into the world's stacking order. */
export type LayerSlot =
  | "under"  // above the tile grid, below doors/markers (e.g. a zone tint)
  | "over";  // above piles, below the player (e.g. placed tokens)

/** The services the engine hands a module at mount. Read state through the getters —
 *  tile size and player position change live. */
export interface EngineContext {
  container: HTMLElement;
  room: Room;
  layout: RoomLayout;
  features: ReadonlySet<RoomFeature>;
  /** Current tile px (the single source of truth for cell pixels). */
  tile(): number;
  /** The room's full available pixel height (panel max-dock math). */
  fullH(): number;
  /** The player's current cell. */
  pos(): Cell;
  /** Insert a module layer into the world at a stacking slot (camera-tracked,
   *  torn down with the room). */
  addLayer(el: HTMLElement, slot: LayerSlot): void;
  /** Camera-only reflow (viewport crop; never re-tiles). */
  reflow(): void;
  /** Return keyboard focus to the room viewport. */
  focusRoom(): void;
  /** Move the engine's player (the slime) to a cell and redraw (camera follows).
   *  Board modules use this to pin the player to their board's controlled entity. */
  movePlayer(cell: Cell): void;
  dialogue: Dialogue;
  /** null when the room doesn't declare the "inventory" feature. */
  inventory: InventoryHud | null;
  /** Report the room's puzzle solved (may earn an unlock — the manager decides). */
  onSolved(): void;
  /** Register module undo callbacks (the engine also clears all room DOM). */
  teardown: Teardown;
}

/** A live, mounted module: the host routes interact / actions / layout to it. */
export interface MountedPuzzle {
  /** Player pressed interact while standing on `cell`. Return true if the module
   *  handled it (Build/Run/etc.); false lets the engine try portals/hint-giver next. */
  onInteract(cell: Cell): boolean;
  /** Extra in-room actions bound via keybindings (place, debug, dd/dw…). Return
   *  true if the module claims the action; false lets the engine handle it. */
  onAction?(actionId: string): boolean;
  /** Rebuild the module's own layers at the current tile size. */
  relayout(): void;
  /** Non-DOM cleanup (the engine also clears the room DOM wholesale). */
  teardown(): void;
  /** The module's dockable panel, if it has one (camera crop + esc routing). */
  panel?: PanelHandle | null;
  /** Content lookup for the dialogue system's first-time-once mechanism. */
  firstTimeBeat?(trigger: string): DialogueBeat | null;
  /** Called after each player draw (e.g. refresh a position-dependent readout). */
  onPlayerDraw?(): void;
}

export interface RoomPuzzleModule {
  /** Registry key — dispatch, not branching. */
  puzzleType: PuzzleType;
  /** Build play objects (coding area, terminal, …) into the world; return live hooks. */
  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle;
}
