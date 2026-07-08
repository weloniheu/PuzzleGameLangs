// ---------------------------------------------------------------------------
// Portals & transitions (shared engine system). Extracted from roomRenderer:
// hub doors (one mechanic, data-driven reaction), the level MENU PORTAL and its
// destination chooser, the teleport flash, and the strict TELEPORT-AWAY
// sequence — 1) flash the player's CURRENT cell in the destination's color,
// 2) remove the player element, 3) change map (manager teardown + mount).
//
// PURE, testable bits: `moveSelection` (the chooser's cursor clamp) and
// `awaySequence` (the ordering contract). Colors/targets/labels are all data —
// see core/portalColors + core/doors; the engine never names a level.
// ---------------------------------------------------------------------------

import type { PuzzleType, RoomDoor } from "../../schema/types";
import { MOVE, type Cell, type Direction, type Room } from "../core/room";
import { doorReaction, effectiveDoorState } from "../core/doors";
import { portalFlashColor } from "../core/portalColors";
import type { DestinationOption } from "../core/progression";
import type { Dialogue } from "./dialogue";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The destination chooser's cursor move, clamped to the option list. PURE. */
export function moveSelection(sel: number, delta: number, count: number): number {
  return clamp(sel + delta, 0, count - 1);
}

/** The TELEPORT-AWAY ordering contract: flash first; only when it completes,
 *  remove the player, THEN transition (teardown + mount). PURE over its fakes. */
export function awaySequence(
  flash: (onDone: () => void) => void,
  removePlayer: () => void,
  transition: () => void,
): void {
  flash(() => {
    removePlayer(); // remove the player before the map changes
    transition();   // change map (manager does teardown + mount)
  });
}

export interface PortalsDeps {
  container: HTMLElement; // hosts the destination-menu overlay
  world: HTMLElement;     // hosts the transient arrival portal (flash el is appended by the host)
  room: Room;
  doors: RoomDoor[];
  unlocks: ReadonlySet<string>;
  /** Data passthrough for flash-color defaults — the engine never branches on it. */
  puzzleType: PuzzleType;
  /** Level rooms get the persistent menu portal at spawn; the hub does not. */
  hasMenuPortal: boolean;
  tile(): number;
  pos(): Cell;
  dialogue: Dialogue;
  removePlayer(): void;
  focusRoom(): void;
  /** Hop the player one step, trying directions in order (hub-arrival hop-off). */
  hopPlayer(order: Direction[]): void;
  /** The destination chooser's options, recomputed FRESH on each open. */
  menuDestinations?: () => DestinationOption[];
  /** Resolve a teleport flash color from a target id (the manager has the registry). */
  flashColorFor?: (target: string) => string;
  /** Commit a transition — the manager tears this room down and mounts the target. */
  onTransition(target: string): void;
}

export interface Portals {
  doorLayer: HTMLElement;
  menuPortalEl: HTMLElement | null;
  flashEl: HTMLElement;
  buildDoors(): void;
  buildMenuPortal(): void;
  doorAt(x: number, y: number): RoomDoor | null;
  onMenuPortal(x: number, y: number): boolean;
  activateDoor(d: RoomDoor): void;
  isDestMenuOpen(): boolean;
  openDestinationMenu(): void;
  closeDestinationMenu(): void;
  moveDestSel(delta: number): void;
  selectDestination(): void;
  playFlash(cell: Cell, color: string, onDone?: () => void): void;
  playHubArrival(color: string): void;
  clearTimers(): void;
}

export function createPortals(deps: PortalsDeps): Portals {
  const { room, doors, unlocks } = deps;

  const doorLayer = document.createElement("div"); // transition doors
  doorLayer.className = "room-door-layer";

  // Menu portal (arrival = exit): for LEVEL rooms only, a persistent portal sits at
  // spawn. Interacting opens the destination chooser. The hub has no menu portal.
  const menuPortalCell = deps.hasMenuPortal ? { x: room.spawn.x, y: room.spawn.y } : null;
  const menuPortalEl = menuPortalCell ? document.createElement("div") : null;
  if (menuPortalEl) menuPortalEl.className = "tile-room tile-portal";

  // Teleport flash — a colored circle that blooms IN A CELL. Used by BOTH the menu
  // portal (levels) and the hub PORTALS, so it exists in every room. Lives in `world`
  // so it tracks the camera and aligns to the grid (host appends it after the player).
  const flashEl = document.createElement("div");
  flashEl.className = "room-flash";
  flashEl.hidden = true;
  let flashTimer = 0;

  // --- destination menu (the menu portal's chooser: Hub + unlocked levels). A menu
  //     surface like settings: mouse-clickable AND keyboard-navigable; Esc cancels. ---
  const destMenuEl = document.createElement("div");
  destMenuEl.className = "room-destmenu";
  destMenuEl.hidden = true;
  const destMenuCard = document.createElement("div");
  destMenuCard.className = "room-destmenu-card";
  destMenuEl.appendChild(destMenuCard);
  deps.container.appendChild(destMenuEl);
  let destMenuOpen = false;
  let destSel = 0;
  let destOptions: DestinationOption[] = [];

  // Click the backdrop (outside the card) to cancel the destination menu.
  destMenuEl.addEventListener("pointerdown", (e) => { if (e.target === destMenuEl) closeDestinationMenu(); });

  /** (Re)build the hub PORTALS (same swirly look as the menu portal, plus a label). The
   *  EFFECTIVE state (resolved against earned unlocks) drives the look: open = active
   *  swirl, locked/coming_soon = a dimmed pad with a lock / construction glyph. */
  function buildDoors() {
    const tile = deps.tile();
    doorLayer.innerHTML = "";
    for (const d of doors) {
      const state = effectiveDoorState(d, unlocks);
      const el = document.createElement("div");
      el.className = `tile-room tile-portal tile-portal-${state}`;
      el.style.width = `${tile}px`;
      el.style.height = `${tile}px`;
      el.style.transform = `translate(${d.pos.x * tile}px, ${d.pos.y * tile}px)`;
      const glyph = document.createElement("span");
      glyph.className = "tile-portal-glyph";
      glyph.textContent = state === "open" ? "🌀" : state === "locked" ? "🔒" : "🚧";
      glyph.style.fontSize = `${Math.round(tile * 0.42)}px`;
      const label = document.createElement("span");
      label.className = "tile-portal-label";
      label.textContent = d.label;
      label.style.fontSize = `${Math.round(tile * 0.2)}px`;
      el.append(glyph, label);
      doorLayer.appendChild(el);
    }
  }

  /** Size + position the persistent menu portal at spawn (level rooms only). */
  function buildMenuPortal() {
    if (!menuPortalEl || !menuPortalCell) return;
    const tile = deps.tile();
    menuPortalEl.style.width = `${tile}px`;
    menuPortalEl.style.height = `${tile}px`;
    menuPortalEl.style.transform = `translate(${menuPortalCell.x * tile}px, ${menuPortalCell.y * tile}px)`;
    menuPortalEl.style.fontSize = `${Math.round(tile * 0.5)}px`;
    menuPortalEl.textContent = "🌀";
  }

  const doorAt = (x: number, y: number) => doors.find((d) => d.pos.x === x && d.pos.y === y) ?? null;
  const onMenuPortal = (x: number, y: number) => !!menuPortalCell && menuPortalCell.x === x && menuPortalCell.y === y;

  /** Bloom the teleport flash in a CELL, in `color`, then run `onDone` (~flash duration).
   *  No-op-but-still-calls-onDone when there's no flash element (keeps callers' order intact). */
  function playFlash(cell: Cell, _color: string, onDone?: () => void) {
    onDone?.(); return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    if (!flashEl) { onDone?.(); return; }
    // flashEl.style.setProperty("--flash", color);
    const tile = deps.tile();
    flashEl.style.width = `${tile}px`;
    flashEl.style.height = `${tile}px`;
    flashEl.style.left = `${cell.x * tile}px`;
    flashEl.style.top = `${cell.y * tile}px`;
    flashEl.hidden = false;
    flashEl.classList.remove("shown");
    requestAnimationFrame(() => flashEl.classList.add("shown")); // restart the bloom animation
    flashTimer = window.setTimeout(() => {
      flashEl.classList.remove("shown");
      flashEl.hidden = true;
      flashTimer = 0;
      onDone?.();
    }, 380);
  }

  /** HUB ARRIVAL — the one TRANSIENT portal. A red pad appears at the spawn, flashes; then
   *  the slime hops off into open space and the pad self-consumes. The permanent hub
   *  portals are untouched. (Currently disabled at the call site, kept for re-enable.) */
  function playHubArrival(color: string) {
    const tile = deps.tile();
    const portal = document.createElement("div");
    portal.className = "tile-room tile-portal tile-portal-transient"; // under the slime (z-index)
    portal.style.width = `${tile}px`;
    portal.style.height = `${tile}px`;
    portal.style.transform = `translate(${room.spawn.x * tile}px, ${room.spawn.y * tile}px)`;
    portal.style.fontSize = `${Math.round(tile * 0.5)}px`;
    portal.textContent = "🌀";
    deps.world.append(portal);

    deps.hopPlayer([MOVE.up, MOVE.right, MOVE.left, MOVE.down]);
    portal.remove();
    playFlash(room.spawn, color, () => {
      // slime hops off the portal cell into the first open neighbor, then the pad vanishes
      deps.hopPlayer([MOVE.right, MOVE.left, MOVE.up, MOVE.down]);
      portal.remove(); // self-consume — the transient portal is gone
    });
  }

  /** Hub PORTALS — one mechanic, data-driven reaction (see core/doors.ts): open → the
   *  teleport-away sequence, same as the menu portal; locked / coming_soon → fire the
   *  beat and stay put. */
  function activateDoor(d: RoomDoor) {
    const reaction = doorReaction(d, unlocks);
    if (reaction.kind === "transition") {
      // GUIDED TUTORIAL: an OPEN-door transition satisfies "enter_door" (stricter than
      // "interact" — a blocked door or the hint giver doesn't count). Fired BEFORE the
      // flash/teardown so the step advances (and completion persists) while this room lives.
      deps.dialogue.notify("enter_door");
      const color = deps.flashColorFor?.(reaction.target)
        ?? portalFlashColor({ puzzleType: deps.puzzleType });
      awaySequence(
        (onDone) => playFlash(deps.pos(), color, onDone),
        deps.removePlayer,
        () => deps.onTransition(reaction.target),
      );
      return;
    }
    // Blocked-portal reactions speak as the NARRATOR (no character) — works in terminal-less rooms like the hub.
    if (d.beat) deps.dialogue.play([{ id: `door-${reaction.reason}`, speaker: "narrator", text: d.beat, trigger: "door" }]);
  }

  // --- destination menu (the menu portal's chooser) -------------------------
  function openDestinationMenu() {
    if (!deps.menuDestinations) return;
    destOptions = deps.menuDestinations(); // fresh: a just-earned unlock shows up now
    if (!destOptions.length) return;
    destSel = 0;
    destMenuOpen = true;
    renderDestMenu();
    destMenuEl.hidden = false;
  }
  function closeDestinationMenu() {
    destMenuOpen = false;
    destMenuEl.hidden = true;
    deps.focusRoom();
  }
  function renderDestMenu() {
    destMenuCard.innerHTML = "";
    const title = document.createElement("p");
    title.className = "room-destmenu-title";
    title.textContent = "Where to?";
    destMenuCard.appendChild(title);
    destOptions.forEach((opt, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-destmenu-option${i === destSel ? " selected" : ""}`;
      b.textContent = opt.kind === "hub" ? `⌂ ${opt.label}` : opt.label;
      b.onclick = () => { destSel = i; selectDestination(); };       // mouse: pick directly
      b.onmouseenter = () => { destSel = i; renderDestMenu(); };     // mouse hover tracks the cursor
      destMenuCard.appendChild(b);
    });
    const hint = document.createElement("p");
    hint.className = "room-destmenu-hint";
    hint.textContent = "↑↓ choose · Enter go · Esc cancel";
    destMenuCard.appendChild(hint);
  }
  function moveDestSel(delta: number) {
    destSel = moveSelection(destSel, delta, destOptions.length);
    renderDestMenu();
  }
  /** Commit the highlighted choice — the TELEPORT-AWAY sequence, in strict order (see
   *  awaySequence): flash the player's cell in the destination's color, remove the
   *  player, change map. */
  function selectDestination() {
    const opt = destOptions[destSel];
    if (!opt) return;
    closeDestinationMenu();
    const color = opt.flashColor ?? portalFlashColor({ hub: opt.kind === "hub", puzzleType: deps.puzzleType });
    awaySequence(
      (onDone) => playFlash(deps.pos(), color, onDone),
      deps.removePlayer,
      () => deps.onTransition(opt.id),
    );
  }

  return {
    doorLayer,
    menuPortalEl,
    flashEl,
    buildDoors,
    buildMenuPortal,
    doorAt,
    onMenuPortal,
    activateDoor,
    isDestMenuOpen: () => destMenuOpen,
    openDestinationMenu,
    closeDestinationMenu,
    moveDestSel,
    selectDestination,
    playFlash,
    playHubArrival,
    clearTimers: () => {
      if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; } // pending warp flash
    },
  };
}
