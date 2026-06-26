// ---------------------------------------------------------------------------
// Room manager — the layer ABOVE renderRoom. It owns "which room is active" and
// performs transitions: FULLY tear down the current room, then mount the target.
//
// Each room mounts FRESH (renderRoom builds all its own state); persistent progress
// (discovered commands, hub unlocks) lives in the Codex, never carried in the room.
// Doors don't know about rooms — they emit a target id; the manager resolves it to a
// puzzle and swaps. The EXIT door is just a door whose target is the hub.
// ---------------------------------------------------------------------------

import type { Puzzle, LevelEntry, PuzzleType } from "../schema/types";
import { renderRoom, type RoomHandle } from "./renderers/roomRenderer";
import { addUnlock, getUnlocks } from "./codex";
import { destinationMenu, HUB_ID } from "./progression";
import { portalFlashColor } from "./portalColors";

export interface RoomManager {
  /** Tear down the current room (if any) and mount the room with this id. */
  enter(id: string): void;
  /** Tear down the current room without mounting another (e.g. leaving for a card game). */
  teardown(): void;
}

/**
 * @param container       where rooms mount (the fullscreen host).
 * @param resolve         id → Puzzle (the manager stays agnostic about where rooms come from).
 * @param levelsForType   puzzle type → its ordered level list (drives the menu portal).
 * @param hooks.onBeforeMount  run just before each mount (e.g. switch to the fullscreen host).
 */
export function createRoomManager(
  container: HTMLElement,
  resolve: (id: string) => Puzzle | null,
  levelsForType: (puzzleType: PuzzleType) => LevelEntry[],
  hooks: { onBeforeMount?: () => void } = {},
): RoomManager {
  let current: RoomHandle | null = null;

  function teardown() {
    if (current) {
      current.teardown(); // destroys EVERYTHING the room created (listeners, timers, DOM)
      current = null;
    }
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
    const levels = levelsForType(puzzle.puzzle_type);
    const isLevel = levels.some((lv) => lv.id === puzzle.id);
    const isHub = puzzle.id === HUB_ID;

    current = renderRoom(container, puzzle, {
      // Arriving at the HUB plays the one TRANSIENT portal: a red pad flashes at the arrival
      // point, the slime hops off, then it self-consumes (leaving the permanent hub portals).
      transientArrivalColor: isHub ? portalFlashColor({ hub: true }) : undefined,
      // A transition (door OR menu-portal selection) is just "enter the target".
      onDoor: (target) => enter(target),
      // Solving a room can earn an unlock (e.g. reveal the next level in the menu/hub).
      onSolved: (solved) => {
        const key = solved.room?.grants_unlock;
        if (key) addUnlock(key);
      },
      // Resolve a teleport's flash color from its target id (used by hub portals):
      // hub→red; else the destination room's override or its puzzle-type color.
      flashColorFor: (target) =>
        target === HUB_ID
          ? portalFlashColor({ hub: true })
          : portalFlashColor({
              puzzleType: resolve(target)?.puzzle_type,
              override: resolve(target)?.room?.flash_color,
            }),
      // The menu portal's chooser, recomputed fresh on every open so a just-earned
      // unlock shows up immediately. Only levels have a menu portal. Each option carries its
      // resolved flash color (hub→red; else the DESTINATION room's override or type color).
      menuDestinations: isLevel
        ? () =>
            destinationMenu(levels, new Set(getUnlocks()), HUB_ID, "Hub").map((opt) => {
              if (opt.kind === "hub") return { ...opt, flashColor: portalFlashColor({ hub: true }) };
              const dest = resolve(opt.id);
              return {
                ...opt,
                flashColor: portalFlashColor({
                  puzzleType: dest?.puzzle_type,
                  override: dest?.room?.flash_color,
                }),
              };
            })
        : undefined,
    });
  }

  return { enter, teardown };
}
