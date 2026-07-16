// ---------------------------------------------------------------------------
// Room manager — the layer ABOVE the room host. It owns "which room is active" and
// performs transitions: FULLY tear down the current room, then mount the target.
//
// Each room mounts FRESH (mountRoom builds all its own state); persistent progress
// (discovered commands, hub unlocks) lives in the Codex, never carried in the room.
// Doors don't know about rooms — they emit a target id; the manager resolves it to a
// puzzle and swaps. The EXIT door is just a door whose target is the hub.
//
// The manager also feeds the LADDER chooser (5a): per puzzle type it hands portals
// the stamped level list + coming-soon languages + the current level id + a fresh
// unlock snapshot; the pure rung builders live in core/ladder.
// ---------------------------------------------------------------------------

import type { Puzzle, PuzzleType, TutorialBlock } from "../schema/types";
import { mountRoom, type RoomHandle } from "./roomHost";
import { addUnlock, getUnlocks } from "./core/codex";
import { HUB_ID } from "./core/progression";
import type { LadderData, LadderLevel, LockedLanguage } from "./core/ladder";
import { portalFlashColor } from "./core/portalColors";

export interface RoomManager {
  /** Tear down the current room (if any) and mount the room with this id. */
  enter(id: string): void;
  /** Tear down the current room without mounting another (e.g. leaving for a card game). */
  teardown(): void;
}

/** What main.ts merges per puzzle type (stamped levels + coming-soon languages). */
export interface TypeLadder {
  levels: LadderLevel[];
  lockedLanguages: LockedLanguage[];
}

/**
 * @param container       where rooms mount (the fullscreen host).
 * @param resolve         id → Puzzle (the manager stays agnostic about where rooms come from).
 * @param ladderForType   puzzle type → its stamped level list + locked languages (feeds the ladder).
 * @param hooks.onBeforeMount  run just before each mount (e.g. switch to the fullscreen host).
 */
export function createRoomManager(
  container: HTMLElement,
  resolve: (id: string) => Puzzle | null,
  ladderForType: (puzzleType: PuzzleType) => TypeLadder,
  hooks: { onBeforeMount?: () => void; tutorialFor?: (id: string) => TutorialBlock | null } = {},
): RoomManager {
  let current: RoomHandle | null = null;

  function teardown() {
    if (current) {
      current.teardown(); // destroys EVERYTHING the room created (listeners, timers, DOM)
      current = null;
    }
  }

  // Resolve a teleport's flash color from a target id: hub→red; else the destination
  // room's override or its puzzle-type color.
  const flashFor = (target: string) =>
    target === HUB_ID
      ? portalFlashColor({ hub: true })
      : portalFlashColor({
          puzzleType: resolve(target)?.puzzle_type,
          override: resolve(target)?.room?.flash_color,
        });

  /** The LADDER data for one puzzle type: levels stamped with their flash colors,
   *  a FRESH unlock snapshot, and where the player currently is. */
  function ladderData(puzzleType: PuzzleType, currentId: string | null): LadderData {
    const { levels, lockedLanguages } = ladderForType(puzzleType);
    return {
      levels: levels.map((lv) => ({ ...lv, flashColor: flashFor(lv.id) })),
      lockedLanguages,
      unlocks: new Set(getUnlocks()),
      currentId,
    };
  }

  function enter(id: string) {
    const puzzle = resolve(id);
    // Validate the target BEFORE tearing anything down, so a bad door leaves the
    // current room intact rather than stranding the player in an empty container.
    if (!puzzle || !puzzle.room) {
      console.warn(`Room manager: no mountable room for id "${id}" — staying put.`);
      return;
    }
    teardown(); // clean teardown BEFORE mounting the next room — no state/listener bleed
    hooks.onBeforeMount?.();

    // A room is a "level" (gets the arrival=exit MENU PORTAL) when it appears in its
    // puzzle type's level list; the hub is not a level, so it has no menu portal.
    const isLevel = ladderForType(puzzle.puzzle_type).levels.some((lv) => lv.id === puzzle.id);

    current = mountRoom(container, puzzle, {
      // Shared first-encounter tutorials the level references (Pack.tutorials); the manager
      // owns the cross-pack lookup, the host owns the seen-check + playback.
      tutorialFor: hooks.tutorialFor,
      // A transition (door OR ladder selection) is just "enter the target".
      onDoor: (target) => enter(target),
      // Solving a room can earn an unlock (e.g. reveal the next level in the ladder).
      onSolved: (solved) => {
        const key = solved.room?.grants_unlock;
        if (key) addUnlock(key);
      },
      flashColorFor: flashFor,
      // The menu portal's ladder (this room's type), recomputed fresh on every open
      // so a just-earned unlock shows up immediately. Only levels have a menu portal.
      menuLadder: isLevel
        ? () => ladderData(puzzle.puzzle_type, puzzle.id)
        : undefined,
      // A door (hub portal) opens the TARGET type's ladder. Null when the target
      // isn't in any level list (falls back to the direct hop).
      doorLadder: (target) => {
        const dest = resolve(target);
        if (!dest) return null;
        const { levels } = ladderForType(dest.puzzle_type);
        if (!levels.some((lv) => lv.id === dest.id)) return null;
        return ladderData(dest.puzzle_type, null);
      },
    });
  }

  return { enter, teardown };
}
