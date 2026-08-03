// ---------------------------------------------------------------------------
// Portals & transitions (shared engine system). Extracted from roomRenderer:
// hub doors (one mechanic, data-driven reaction), the level MENU PORTAL and its
// LADDER chooser (5a: Language → Mechanic → Difficulty, drill-down), the
// teleport flash, and the strict TELEPORT-AWAY sequence — 1) flash the player's
// CURRENT cell in the destination's color, 2) remove the player element,
// 3) change map (manager teardown + mount).
//
// PURE, testable bits: `moveSelection` (the chooser's cursor clamp),
// `awaySequence` (the ordering contract), and the rung builders themselves
// (core/ladder). Colors/targets/labels are all data — see core/portalColors +
// core/doors; the engine never names a level or a language.
// ---------------------------------------------------------------------------

import type { PuzzleType, RoomDoor } from "../../schema/types";
import type { Cell, Room } from "../core/room";
import { doorReaction, effectiveDoorState } from "../core/doors";
import { portalFlashColor } from "../core/portalColors";
import { HUB_ID } from "../core/progression";
import {
  languageRung, mechanicRung, levelRung, ladderPath,
  type LadderData, type LadderRow, type LadderRung, type LadderStep,
} from "../core/ladder";
import type { Dialogue } from "./dialogue";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The destination chooser's cursor move, clamped to the option list. PURE. */
export function moveSelection(sel: number, delta: number, count: number): number {
  return clamp(sel + delta, 0, count - 1);
}

/** Where the cursor LANDS when a rung is (re)rendered: on the row the player is
 *  actually in (CURRENT), else the first real choice — never on the trailing
 *  ← Back / ⌂ Return to hub nav rows. PURE. */
export function focusRow(rows: LadderRow[]): number {
  const current = rows.findIndex((r) => r.current);
  if (current >= 0) return current;
  const first = rows.findIndex((r) => r.kind !== "back" && r.kind !== "hub");
  return first >= 0 ? first : 0;
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
  /** The menu portal's LADDER data (this room's puzzle type), recomputed FRESH on
   *  each open so a just-earned unlock shows up immediately. */
  menuLadder?: () => LadderData | null;
  /** A door's own LADDER data (the target's puzzle type). Non-null with levels →
   *  interacting with the OPEN door opens the ladder instead of transitioning
   *  directly; null/empty → the old direct transition. */
  doorLadder?: (target: string) => LadderData | null;
  /** Resolve a teleport flash color from a target id (the manager has the registry). */
  flashColorFor?: (target: string) => string;
  /** Commit a transition — the manager tears this room down and mounts the target. */
  onTransition(target: string): void;
}

export interface Portals {
  doorLayer: HTMLElement;
  menuPortalEl: HTMLElement | null;
  buildDoors(): void;
  buildMenuPortal(): void;
  doorAt(x: number, y: number): RoomDoor | null;
  onMenuPortal(x: number, y: number): boolean;
  activateDoor(d: RoomDoor): void;
  isDestMenuOpen(): boolean;
  openDestinationMenu(): void;
  closeDestinationMenu(): void;
  /** Esc inside the chooser: pop one rung, or close when already at the top. */
  escBack(): void;
  moveDestSel(delta: number): void;
  selectDestination(): void;
  playFlash(cell: Cell, color: string, onDone?: () => void): void;
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

  // --- the LADDER chooser (5a): a drill-down over Language → Mechanic → Level.
  //     A menu surface like settings: mouse-clickable AND keyboard-navigable;
  //     Esc pops one rung (closes at the top). ---
  const destMenuEl = document.createElement("div");
  destMenuEl.className = "room-destmenu";
  destMenuEl.hidden = true;
  const destMenuCard = document.createElement("div");
  destMenuCard.className = "room-destmenu-card";
  destMenuEl.appendChild(destMenuCard);
  deps.container.appendChild(destMenuEl);
  let destMenuOpen = false;
  let destSel = 0;
  let ladder: LadderData | null = null;
  let ladderTitle = "Where to?";
  // The drill-down position: [{}] = language rung; a chosen lang adds the mechanic
  // rung; a chosen mech adds the level rung. Rows recompute from this each render.
  let rungStack: LadderStep[] = [{}];
  let currentRows: LadderRow[] = [];
  // Who opened the chooser: the level MENU PORTAL, or a hub DOOR (a door-sourced
  // selection is the actual door transition, so it fires the enter_door signal).
  let destSource: "portal" | "door" = "portal";

  // Click the backdrop (outside the card) to cancel the destination menu.
  destMenuEl.addEventListener("pointerdown", (e) => { if (e.target === destMenuEl) closeDestinationMenu(); });

  /** Fill `el` with the whirlpool-portal look (2a): halo glow, two expanding rings,
   *  and a slowly spinning art disc (the portal PNG, or a CSS swirl when no art).
   *  The game's color arrives as --portal-accent; everything else derives from it. */
  function buildPortalVisual(el: HTMLElement, accent: string, icon?: string) {
    el.style.setProperty("--portal-accent", accent);
    const glow = document.createElement("div");
    glow.className = "tile-portal-glow";
    const ring1 = document.createElement("div");
    ring1.className = "tile-portal-ring";
    const ring2 = document.createElement("div");
    ring2.className = "tile-portal-ring delayed";
    const disc = document.createElement("div");
    disc.className = "tile-portal-disc";
    if (icon) {
      const img = document.createElement("img");
      img.className = "tile-portal-img";
      img.src = icon;
      img.alt = "";
      disc.appendChild(img);
    } else {
      const swirl = document.createElement("div");
      swirl.className = "tile-portal-swirl";
      disc.appendChild(swirl);
    }
    el.append(glow, ring1, ring2, disc);
  }

  /** (Re)build the hub PORTALS (whirlpool discs with each game's art + color, plus a
   *  label pill). The EFFECTIVE state (resolved against earned unlocks) drives the look:
   *  open = active glowing disc, locked/coming_soon = a dimmed stone pad with a glyph. */
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
      if (state === "open") {
        // The portal glows in its DESTINATION's color (same resolver the flash uses).
        const accent = deps.flashColorFor?.(d.target)
          ?? portalFlashColor({ puzzleType: deps.puzzleType });
        buildPortalVisual(el, accent, d.icon);
      } else {
        const glyph = document.createElement("span");
        glyph.className = "tile-portal-glyph";
        glyph.textContent = state === "locked" ? "🔒" : "🚧";
        glyph.style.fontSize = `${Math.round(tile * 0.42)}px`;
        el.appendChild(glyph);
      }
      const label = document.createElement("span");
      label.className = "tile-portal-label";
      label.textContent = d.label;
      label.style.fontSize = `${Math.round(tile * 0.2)}px`;
      el.appendChild(label);
      doorLayer.appendChild(el);
    }
  }

  /** Size + position the persistent menu portal at spawn (level rooms only) — the same
   *  whirlpool look, colored by THIS room's puzzle type, CSS swirl (no per-level art). */
  function buildMenuPortal() {
    if (!menuPortalEl || !menuPortalCell) return;
    const tile = deps.tile();
    menuPortalEl.innerHTML = "";
    menuPortalEl.style.width = `${tile}px`;
    menuPortalEl.style.height = `${tile}px`;
    menuPortalEl.style.transform = `translate(${menuPortalCell.x * tile}px, ${menuPortalCell.y * tile}px)`;
    buildPortalVisual(menuPortalEl, portalFlashColor({ puzzleType: deps.puzzleType }));
  }

  const doorAt = (x: number, y: number) => doors.find((d) => d.pos.x === x && d.pos.y === y) ?? null;
  const onMenuPortal = (x: number, y: number) => !!menuPortalCell && menuPortalCell.x === x && menuPortalCell.y === y;

  /** The teleport flash SEAM. The animated cell-bloom was removed with the dead-code
   *  pass (it had been disabled); a future visual goes here. Callers still route the
   *  away sequence through it, so re-adding an animation restores the strict ordering
   *  (flash completes → remove player → transition) without touching them. */
  function playFlash(_cell: Cell, _color: string, onDone?: () => void) {
    onDone?.();
  }

  /** Hub PORTALS — one mechanic, data-driven reaction (see core/doors.ts): open → the
   *  teleport-away sequence, same as the menu portal; locked / coming_soon → fire the
   *  beat and stay put. */
  function activateDoor(d: RoomDoor) {
    const reaction = doorReaction(d, unlocks);
    if (reaction.kind === "transition") {
      // A door with its OWN ladder (e.g. a hub portal → its puzzle type's languages)
      // opens the drill-down chooser instead of teleporting straight away.
      // enter_door then fires on the final SELECTION (the actual transition), not here.
      const data = deps.doorLadder?.(reaction.target) ?? null;
      if (data && data.levels.length) {
        openChooser(data, `${d.label} portal`, "door");
        return;
      }
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

  // --- the LADDER chooser (the menu portal's / a door's drill-down) ----------
  /** The rung the drill-down currently shows, computed fresh from the stack top
   *  (so availability/CURRENT reflect the latest data on every render). */
  function currentRung(): LadderRung {
    const top = rungStack[rungStack.length - 1];
    if (top.mech !== undefined) return levelRung(ladder!, top.lang!, top.mech);
    if (top.lang !== undefined) return mechanicRung(ladder!, top.lang);
    return languageRung(ladder!, ladderTitle);
  }
  function openChooser(data: LadderData, title: string, source: "portal" | "door") {
    ladder = data;
    ladderTitle = title;
    destSource = source;
    // Open where the player LEFT OFF: the rung holding the level they're standing in
    // (language → mechanic → level), so re-entering the portal shows that list with
    // the level highlighted. No current level (e.g. a hub door) → the language rung.
    rungStack = ladderPath(data);
    destMenuOpen = true;
    renderDestMenu(true);
    destMenuEl.hidden = false;
  }
  function openDestinationMenu() {
    const data = deps.menuLadder?.(); // fresh: a just-earned unlock shows up now
    if (!data || !data.levels.length) return;
    openChooser(data, "Where to?", "portal");
  }
  function closeDestinationMenu() {
    destMenuOpen = false;
    destMenuEl.hidden = true;
    deps.focusRoom();
  }
  /** Esc / the ← Back row: pop one rung (level → mechanic → language); at the top
   *  there is nothing above — close (⌂ Return to hub is the way out from there). */
  function escBack() {
    if (rungStack.length > 1) {
      rungStack.pop();
      renderDestMenu(true); // land on the group we came from
      return;
    }
    closeDestinationMenu();
  }
  /** `refocus` = a rung CHANGE: put the cursor on the current/first choice.
   *  Otherwise keep the cursor where it is (a plain re-render after a move). */
  function renderDestMenu(refocus = false) {
    if (!ladder) return;
    const rung = currentRung();
    currentRows = rung.rows;
    destSel = refocus ? focusRow(currentRows) : moveSelection(destSel, 0, currentRows.length);
    destMenuCard.innerHTML = "";
    const title = document.createElement("p");
    title.className = "room-destmenu-title";
    title.textContent = rung.title;
    destMenuCard.appendChild(title);
    rung.rows.forEach((row, i) => {
      const b = document.createElement("button");
      b.type = "button";
      const cls = ["room-destmenu-option"];
      if (i === destSel) cls.push("selected");
      if (row.kind === "locked") cls.push("locked");
      if (row.kind === "back" || row.kind === "hub") cls.push("nav");
      b.className = cls.join(" ");
      const label = document.createElement("span");
      label.textContent = row.label;
      b.appendChild(label);
      // The small dark CURRENT tag — marks where the player IS; cursor-independent (5a).
      if (row.current) {
        const tag = document.createElement("span");
        tag.className = "room-destmenu-tag";
        tag.textContent = "CURRENT";
        b.appendChild(tag);
      }
      // Mouse is SECONDARY: a click picks directly, but hovering never moves the
      // keyboard cursor (arrows own the selection; hover feedback is CSS-only).
      b.onclick = () => { destSel = i; selectDestination(); };
      destMenuCard.appendChild(b);
    });
    const hint = document.createElement("p");
    hint.className = "room-destmenu-hint";
    hint.textContent = "↑↓ choose · Enter go · Esc back";
    destMenuCard.appendChild(hint);
  }
  function moveDestSel(delta: number) {
    destSel = moveSelection(destSel, delta, currentRows.length);
    renderDestMenu();
  }
  /** Commit a LEVEL/HUB choice — the TELEPORT-AWAY sequence, in strict order (see
   *  awaySequence): flash the player's cell in the destination's color, remove the
   *  player, change map. */
  function commitTransition(target: string, flashColor?: string) {
    closeDestinationMenu();
    // A door-sourced choice IS the door transition: satisfy "enter_door" now,
    // BEFORE the flash/teardown (see activateDoor's direct path).
    if (destSource === "door") deps.dialogue.notify("enter_door");
    const color = flashColor
      ?? portalFlashColor({ hub: target === HUB_ID, puzzleType: deps.puzzleType });
    awaySequence(
      (onDone) => playFlash(deps.pos(), color, onDone),
      deps.removePlayer,
      () => deps.onTransition(target),
    );
  }
  /** Enter on the highlighted row: drill into a group, transition on a level/hub
   *  row, pop on Back, or speak a locked row's beat (and stay put). */
  function selectDestination() {
    const row = currentRows[destSel];
    if (!row) return;
    switch (row.kind) {
      case "back":
        escBack();
        return;
      case "enter": {
        const top = rungStack[rungStack.length - 1];
        rungStack.push(top.lang === undefined ? { lang: row.key } : { lang: top.lang, mech: row.key });
        renderDestMenu(true); // onto the next rung's current/first choice
        return;
      }
      case "locked":
        // Greyed row: no transition. Speak its beat (as the narrator) if it has one.
        closeDestinationMenu();
        if (row.beat) {
          deps.dialogue.play([{ id: `ladder-locked-${row.label}`, speaker: "narrator", text: row.beat, trigger: "door" }]);
        }
        return;
      case "hub":
        // From a hub DOOR the player is already standing in the hub — just close
        // (the row exists to switch types: close, walk to another portal).
        if (destSource === "door") { closeDestinationMenu(); return; }
        commitTransition(HUB_ID);
        return;
      case "level":
        commitTransition(row.id!, row.flashColor);
    }
  }

  return {
    doorLayer,
    menuPortalEl,
    buildDoors,
    buildMenuPortal,
    doorAt,
    onMenuPortal,
    activateDoor,
    isDestMenuOpen: () => destMenuOpen,
    openDestinationMenu,
    closeDestinationMenu,
    escBack,
    moveDestSel,
    selectDestination,
    playFlash,
  };
}
