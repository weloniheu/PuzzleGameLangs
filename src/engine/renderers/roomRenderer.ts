// ---------------------------------------------------------------------------
// Room view (top-down). This is the DUMB layer: all rules live in ../room and
// ../input. It draws tiles from a parsed Room, places a slime, listens for
// movement keys.
//
// SIZING (code game only): the tile size is computed from the window so the room
// uses the whole available space.
//   • Room fits → tiles scale UP to the largest INTEGER pixel size that fits
//     (crisp pixel art), the whole room is shown and centered.
//   • Room larger than the window → tiles stay at a comfortable fixed size and a
//     camera follows the slime, clamped to room bounds so you never scroll past a
//     wall. Recomputed on (debounced) window resize.
// `tile` is the single source of truth for cell pixels — pile/coding/placement
// logic reads it so later phases (indent offset, placement) stay in sync.
//
// Styling is scoped to .room-* classes (the code game's world look — warm tiles).
// Mouse is used ONLY for the settings button and to focus the room for keyboard.
// ---------------------------------------------------------------------------

import type {
  Puzzle, CodeBuildPayload, CodeBuildSolution, RoomControl, RoomDoor, DialogueBeat, DialogueSpeaker,
} from "../../schema/types";
import { parseRoom, step, pileAt, MOVE, type Cell } from "../core/room";
import { resetCodex, resetTutorials, getUnlocks, hasCompletedTutorial, completeTutorial } from "../core/codex";
import { doorReaction, effectiveDoorState } from "../core/doors";
import { createTeardown } from "../core/teardown";
import { resolveFeatures, resolveInventorySlots } from "../core/roomFeatures";
import type { DestinationOption } from "../core/progression";
import { portalFlashColor } from "../core/portalColors";
import { renderTileLayer } from "../systems/tileLayer";
import { computeTile, computeViewport } from "../systems/camera";
import { createSlime, drawPlayer } from "../systems/player";
import { createDialogue } from "../systems/dialogue";
import {
  run as runProgram,
  createBuildState,
  markBuilt,
  markDirty,
  tokensOnRow,
  evaluatedLines,
  type AnswerLine,
  type CheckReason,
} from "../../puzzles/coding/codeGameLogic";
import { normalizeKey, resolve, type Bindings, type Key } from "../core/keybindings";
// The settings panel owns the gear/tabs/rebind UI AND the session-persistent roomSettings
// (active scheme + bindings, room size, terminal font) — read here for sizing/bindings.
import { createSettingsPanel, roomSettings } from "../systems/settingsPanel";

const SEQ_WINDOW = 600;       // ms a pending gameplay sequence (e.g. d…) waits for its next key

const FIXED_TILE = 40;       // comfortable tile px used when the room is larger than the window
const HUD_H = 48;            // inventory HUD height (px)
const HUD_GAP = 10;          // consistent gap between the HUD and its lower neighbour
                             // (the docked terminal's top edge, or the window's bottom edge).
                             // Tile sizing reserves HUD_H + 2*HUD_GAP; the terminal stays an
                             // OVERLAY (docked crops the camera; popped floats) and is not reserved.
const SIDE_RESERVE = 8;      // px breathing room so the room never butts against the window edge
const RESIZE_DEBOUNCE = 120; // ms
const TERM_DOCKED_H = 200;   // docked terminal band height — crops the camera, never the tile
const TERM_DOCK_MIN_H = 80;  // docked band drags between this and (room height − 1 row)
const TERM_MIN_W = 280;      // popped terminal minimum size
const TERM_MIN_H = 140;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A token placed into the coding area at a cell. */
interface Placed { token: string; x: number; y: number; }

/** A door transition target, or a solved-puzzle notification, bubbled up to the manager. */
export interface RoomCallbacks {
  /** An OPEN door / menu-portal selection → mount this target id (manager does teardown + mount). */
  onDoor?: (target: string) => void;
  /** The room's puzzle was solved → may earn an unlock (see RoomLayout.grants_unlock). */
  onSolved?: (puzzle: Puzzle) => void;
  /** When provided, this room is a LEVEL: a persistent MENU PORTAL sits at spawn, and this
   *  returns the destination chooser (Hub + unlocked levels), recomputed fresh on each open.
   *  Omitted for the hub (no menu portal). */
  menuDestinations?: () => DestinationOption[];
  /** Resolve the teleport flash color for a target id (the manager has the registry).
   *  Used by hub PORTALS so their transition flashes in the destination's color. */
  flashColorFor?: (target: string) => string;
  /** When set, this room is the HUB: on arrival a TRANSIENT portal in this color flashes
   *  at the spawn, the slime hops off, then the portal self-consumes. The room's other
   *  portals (the permanent type portals) are untouched. Omitted for puzzle rooms. */
  transientArrivalColor?: string;
}
/** Handle to a mounted room. `teardown()` destroys EVERYTHING the room created. */
export interface RoomHandle {
  teardown: () => void;
}

// Only one room is mounted at a time. Track the WHOLE teardown at module scope so a
// direct re-render (or a missed manager teardown) tears the old room down completely
// instead of leaking its listeners/timers into the next one.
let activeRoomTeardown: (() => void) | null = null;

export function renderRoom(
  container: HTMLElement,
  puzzle: Puzzle,
  callbacks: RoomCallbacks = {},
): RoomHandle {
  if (activeRoomTeardown) {
    activeRoomTeardown(); // self-guard: never stack two live rooms
    activeRoomTeardown = null;
  }
  // Every undo (removeEventListener / clearTimer / clear DOM) registers here; leaving the
  // room runs them all and nulls the list — no listener, timer, or state survives.
  const teardown = createTeardown();

  const layout = puzzle.room!; // main only routes room puzzles here
  // Feature gating: a room renders ONLY the features it declares. Undeclared → not built
  // (no DOM, no listeners, no teardown burden). Always-on basics (movement, settings,
  // inventory HUD) are not features. Adding a gateable feature later = extend RoomFeature
  // + a render branch here.
  const features = resolveFeatures(layout);
  const hasTerminal = features.has("terminal");
  const hasCodingArea = features.has("coding_area");
  // Code-game CONTENT (engine hardcodes none): the answer, beats, and terminal flavor.
  const payload = puzzle.payload as CodeBuildPayload;
  const solution = puzzle.solution as CodeBuildSolution;
  const answer: AnswerLine[] = solution.lines ?? [];
  const beats: Record<string, string> = payload.beats ?? {};
  const termCmds = payload.terminal ?? { build: "$ build", run: "$ run" };
  // Dialogue CONTENT (engine hardcodes none): speakers, snake greeting, hint giver lines.
  // Dialogue CONTENT (speakers/greeting/hints) — fed into the dialogue presenter (system).
  const dialogueCfg = payload.dialogue;
  const speakers: Record<string, DialogueSpeaker> = dialogueCfg?.speakers ?? {};
  const onEnterBeats: DialogueBeat[] = dialogueCfg?.on_enter ?? [];
  const hintLines = dialogueCfg?.hints ?? [];
  // GUIDED TUTORIAL (content, cut-and-dry): plays ONCE ever, appended after the on_enter
  // beats, the first time this room's id is visited (see codex.ts tutorial tracking).
  const guidedTutorialBeats: DialogueBeat[] = dialogueCfg?.guided_tutorial ?? [];

  const room = parseRoom(layout);
  let pos: Cell = { ...room.spawn };
  const inventory: string[] = [];
  const placed: Placed[] = [];
  let debugOn = false;
  let buildState = createBuildState(); // line is "dirty" until Built (see codeGameLogic)

  // (Dialogue queue/timers/first-time-once state + the presenter itself now live in
  //  systems/dialogue — see the `dialogue` instance created below.)

  // View sizing — recomputed by relayout(); everything pixel-based reads these.
  let tile = FIXED_TILE;
  let viewCols = room.width;
  let viewRows = room.height;
  // The room's FULL available pixels (window minus top bar + HUD). `tile` is sized
  // from these and is independent of the terminal, so dock/undock never resizes it.
  let fullW = 0;
  let fullH = 0;

  // Terminal: an overlay in both states. Docked = bottom band that crops the camera;
  // popped = a free-floating, drag/resizable desktop-style window over the room.
  const terminal = {
    mode: "docked" as "docked" | "popped",
    dockedH: TERM_DOCKED_H,
    x: 48, y: 88, w: 480, h: 280, // popped geometry (clamped within the window)
  };

  const placedAt = (x: number, y: number) => placed.find((p) => p.x === x && p.y === y) ?? null;
  // Build / Run objects belong to the coding_area feature — without it, none exist.
  const controls: RoomControl[] = hasCodingArea ? (layout.controls ?? []) : [];
  const controlAt = (x: number, y: number) => controls.find((c) => c.pos.x === x && c.pos.y === y) ?? null;
  const hintGiver = layout.hint_giver ?? null; // the ONLY in-room dialogue marker (snake has none)

  // Doors: stand-on-and-interact objects (like controls). Their reaction is resolved
  // against the player's earned unlocks, read ONCE at mount (fresh each time the room loads).
  const doors: RoomDoor[] = layout.doors ?? [];
  const unlocks = new Set(getUnlocks());
  const doorAt = (x: number, y: number) => doors.find((d) => d.pos.x === x && d.pos.y === y) ?? null;

  // Menu portal (arrival = exit): for LEVEL rooms only, a persistent portal sits at spawn.
  // Interacting opens the destination chooser. The hub has no menu portal (no destinations fn).
  const menuPortalCell = callbacks.menuDestinations ? { x: room.spawn.x, y: room.spawn.y } : null;
  const onMenuPortal = (x: number, y: number) => !!menuPortalCell && menuPortalCell.x === x && menuPortalCell.y === y;

  // Inventory + HUD state. The HUD is ALWAYS visible. `invFocused` is the focus state:
  // room focus → arrows move the slime (HUD slightly dimmed); inventory focus → arrows
  // move the slot cursor (`invSel`), slime is parked, HUD brightened. `invDrop` holds a
  // full-inventory pickup awaiting a drop/cancel decision (reusing the SAME slot cursor);
  // its `restore` is a placed token lifted off the board, put back if the player cancels.
  // Slot count resolves room-first, then by puzzle type, then a fallback (see roomFeatures).
  const invSlots = resolveInventorySlots(layout.inventory_slots, puzzle.puzzle_type);
  let invFocused = false;
  let invSel = 0;
  let invDrop: { pending: string; restore: Placed | null } | null = null;

  container.innerHTML = "";

  // --- top bar: holds the gear (created by the settings panel, appended below). ---
  const topbar = document.createElement("div");
  topbar.className = "room-topbar";
  container.appendChild(topbar);

  // --- stage (centers the viewport in the available space) → viewport → world ---
  const stage = document.createElement("div");
  stage.className = "room-stage";

  const viewport = document.createElement("div");
  viewport.className = "room-viewport";
  viewport.tabIndex = 0;

  const world = document.createElement("div");
  world.className = "room-world";

  // Sub-layers, so a resize can rebuild the tile/pile/placed layers at the new tile
  // size without disturbing the persistent slime element (and its focus/transition).
  const tileLayer = document.createElement("div");
  tileLayer.className = "room-tile-layer";
  // Coding-area visuals (zone tint + Build/Run layer) exist ONLY when the feature is on.
  let zoneEl: HTMLDivElement | null = null;
  let controlLayer: HTMLDivElement | null = null;
  if (hasCodingArea) {
    zoneEl = document.createElement("div"); // tinted/outlined coding-area zone
    zoneEl.className = "room-coding-zone";
    zoneEl.hidden = !room.codingArea;
    controlLayer = document.createElement("div"); // Build / Run objects
    controlLayer.className = "room-control-layer";
  }
  const doorLayer = document.createElement("div"); // transition doors
  doorLayer.className = "room-door-layer";
  // Menu portal tile (level rooms only) — a single persistent element repositioned on relayout.
  const menuPortalEl = menuPortalCell ? document.createElement("div") : null;
  if (menuPortalEl) menuPortalEl.className = "tile-room tile-portal";
  const markerLayer = document.createElement("div"); // hint giver's "?" marker
  markerLayer.className = "room-marker-layer";
  const pileLayer = document.createElement("div");
  pileLayer.className = "room-pile-layer";
  const placedLayer = document.createElement("div");
  placedLayer.className = "room-placed-layer";
  const slime = createSlime();
  // Order matters for stacking; coding-area layers slot in only when present.
  world.append(tileLayer);
  if (zoneEl) world.append(zoneEl);
  if (controlLayer) world.append(controlLayer);
  world.append(doorLayer);
  if (menuPortalEl) world.append(menuPortalEl); // below the slime, which spawns on top of it
  world.append(markerLayer, pileLayer, placedLayer, slime);

  viewport.appendChild(world);
  stage.appendChild(viewport);
  container.appendChild(stage);

  // --- persistent inventory strip (so progress is visible without opening the overlay) ---
  const invStrip = document.createElement("div");
  invStrip.className = "room-inventory";
  container.appendChild(invStrip);

  // --- debug readout (toggle with `) : the placed line on the player's row + indent ---
  const debugEl = document.createElement("div");
  debugEl.className = "room-debug";
  debugEl.hidden = true;
  container.appendChild(debugEl);

  // (Inventory is the always-visible HUD `invStrip` above + the inventory-focus state;
  //  there is no separate modal overlay — arrows are routed by focus in the room handler.)

  // --- settings panel (system): gear + Controls/Display tabs + rebind capture. Focus/esc
  //     and the relayout/terminal-font/reset callbacks are INJECTED (not entangled). ---
  const settings = createSettingsPanel({
    container,
    hasTerminal,
    relayout: () => relayout(),
    applyTermFont: () => terminalApi?.applyFont(),
    resetCodex,
    resetTutorials,
    onBeforeOpen: () => dropFocusToRoom(), // clear inventory/terminal focus before opening
    onClose: () => viewport.focus({ preventScroll: true }),
    onEscape: () => handleEscape(),        // route esc through the room's esc ladder
  });
  topbar.append(settings.gearButton);

  // --- destination menu (the menu portal's chooser: Hub + unlocked levels). A menu
  //     surface like settings: mouse-clickable AND keyboard-navigable; Esc cancels. ---
  const destMenuEl = document.createElement("div");
  destMenuEl.className = "room-destmenu";
  destMenuEl.hidden = true;
  const destMenuCard = document.createElement("div");
  destMenuCard.className = "room-destmenu-card";
  destMenuEl.appendChild(destMenuCard);
  container.appendChild(destMenuEl);
  let destMenuOpen = false;
  let destSel = 0;
  let destOptions: DestinationOption[] = [];

  // Teleport flash — a colored circle that blooms IN A CELL. Used by BOTH the menu portal
  // (levels) and the hub PORTALS, so it exists in every room. Lives in `world` so it tracks
  // the camera and aligns to the grid; appended after the slime → on top.
  const flashEl = document.createElement("div");
  flashEl.className = "room-flash";
  flashEl.hidden = true;
  world.append(flashEl);
  let flashTimer = 0;

  /** Leave inventory focus → room focus. Cancels a pending drop, restoring any lifted token. */
  function exitInventory() {
    if (invDrop) {
      if (invDrop.restore) { placed.push(invDrop.restore); drawPlaced(); buildState = markDirty(buildState); } // un-lift
      invDrop = null;
    }
    invFocused = false;
    drawInventory();
  }

  /** Clear inventory/terminal focus back to the plain room (used on settings-open). */
  function dropFocusToRoom() {
    if (invFocused) exitInventory();
    viewport.focus({ preventScroll: true }); // pulls focus off any terminal control too
  }

  /**
   * The ONE esc decision — branched on focus/menu state. There is NO separate esc
   * listener: the focus-routed keydown handlers (room / inventory / settings) all
   * forward esc here, and this resolves it by current state:
   *   settings open    → back out (sub-tab → menu → closed)
   *   inventory focused → return to room focus (first esc); cancels a pending drop
   *   terminal focused  → drop focus back to the room
   *   plain room        → open settings (second esc, from a forced room-focus state)
   */
  function handleEscape() {
    if (destMenuOpen) {           // menu portal chooser open → close it, stay in the room
      closeDestinationMenu();
      return;
    }
    if (settings.isOpen()) {      // settings open → back out (sub-tab → menu → closed)
      settings.escBack();
      return;
    }
    if (invFocused) {            // inventory focused → back to room (does NOT open settings)
      exitInventory();
      viewport.focus({ preventScroll: true });
      return;
    }
    if (terminalApi?.containsActive()) {
      viewport.focus({ preventScroll: true });
      return;
    }
    settings.open();              // plain room → open settings (open() drops room focus first)
  }

  // Click the backdrop (outside the card) to cancel the destination menu.
  destMenuEl.addEventListener("pointerdown", (e) => { if (e.target === destMenuEl) closeDestinationMenu(); });

  // --- terminal FEATURE (gated): docked/popped overlay + its drag/resize handlers.
  // Built ONLY when declared; otherwise no DOM and no listeners exist. The rest of the
  // renderer touches it through this small API (all calls are `terminalApi?.…`). ---
  interface TerminalApi {
    containsActive(): boolean;                         // is focus inside the terminal? (esc routing)
    applyMode(): void;                                 // docked vs popped visuals
    applyFont(): void;                                 // terminal text size
    clampAndPlace(): void;                             // keep a popped window on-screen (relayout)
    layoutDocked(): void;                              // write the docked band geometry (applyViewport)
    write(lines: string[], state: "neutral" | "success" | "error"): void; // body transcript
  }

  function buildTerminal(): TerminalApi {
    const terminalEl = document.createElement("div");
    terminalEl.className = "room-terminal";
    const termHeader = document.createElement("div");
    termHeader.className = "room-terminal-header";
    const termTitle = document.createElement("span");
    termTitle.className = "room-terminal-title";
    termTitle.textContent = "terminal";
    const termToggle = document.createElement("button");
    termToggle.type = "button";
    termToggle.className = "room-terminal-toggle";
    termHeader.append(termTitle, termToggle);
    const termBody = document.createElement("div");
    termBody.className = "room-terminal-body";
    termBody.textContent = ">>> ready";
    const termResize = document.createElement("div");
    termResize.className = "room-terminal-resize";
    const termDockGrip = document.createElement("div"); // top-edge drag to set docked height
    termDockGrip.className = "room-terminal-dockgrip";
    terminalEl.append(termDockGrip, termHeader, termBody, termResize);
    container.appendChild(terminalEl);

    function applyTermFont() {
      termBody.style.fontSize = `${roomSettings.termFontPx}px`;
    }
    /** Keep the popped window fully inside the game window (clamps size, then position). */
    function clampTerminal() {
      const W = container.clientWidth, H = window.innerHeight;
      terminal.w = clamp(terminal.w, TERM_MIN_W, W);
      terminal.h = clamp(terminal.h, TERM_MIN_H, H);
      terminal.x = clamp(terminal.x, 0, Math.max(0, W - terminal.w));
      terminal.y = clamp(terminal.y, 0, Math.max(0, H - terminal.h));
    }
    /** Write the popped geometry onto the element. */
    function placePopped() {
      terminalEl.style.left = `${terminal.x}px`;
      terminalEl.style.top = `${terminal.y}px`;
      terminalEl.style.width = `${terminal.w}px`;
      terminalEl.style.height = `${terminal.h}px`;
    }
    /** Apply the docked-vs-popped visual mode (geometry for docked is set in applyViewport). */
    function applyTerminalMode() {
      const popped = terminal.mode === "popped";
      terminalEl.classList.toggle("popped", popped);
      terminalEl.classList.toggle("docked", !popped);
      termToggle.textContent = popped ? "▭ dock" : "◳ pop out";
      termResize.hidden = !popped;     // corner grip = popped only
      termDockGrip.hidden = popped;    // top edge grip = docked only
      if (popped) { clampTerminal(); placePopped(); }
    }

    // Toggle dock/pop — camera-only reflow; MUST NOT call relayout (no tile change → no breathing).
    termToggle.onclick = () => {
      terminal.mode = terminal.mode === "docked" ? "popped" : "docked";
      applyTerminalMode();
      applyViewport();
      viewport.focus({ preventScroll: true });
    };

    // Drag by the header (popped only).
    let drag: { px: number; py: number; x: number; y: number } | null = null;
    termHeader.addEventListener("pointerdown", (e) => {
      if (terminal.mode !== "popped" || e.target === termToggle) return;
      drag = { px: e.clientX, py: e.clientY, x: terminal.x, y: terminal.y };
      termHeader.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    termHeader.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const W = container.clientWidth, H = window.innerHeight;
      terminal.x = clamp(drag.x + (e.clientX - drag.px), 0, Math.max(0, W - terminal.w));
      terminal.y = clamp(drag.y + (e.clientY - drag.py), 0, Math.max(0, H - terminal.h));
      placePopped();
    });
    const endDrag = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      termHeader.releasePointerCapture(e.pointerId);
      viewport.focus({ preventScroll: true });
    };
    termHeader.addEventListener("pointerup", endDrag);
    termHeader.addEventListener("pointercancel", endDrag);

    // Resize by the corner (popped only); grows right/down, clamped to the window edge.
    let rez: { px: number; py: number; w: number; h: number } | null = null;
    termResize.addEventListener("pointerdown", (e) => {
      if (terminal.mode !== "popped") return;
      rez = { px: e.clientX, py: e.clientY, w: terminal.w, h: terminal.h };
      termResize.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    termResize.addEventListener("pointermove", (e) => {
      if (!rez) return;
      const W = container.clientWidth, H = window.innerHeight;
      terminal.w = clamp(rez.w + (e.clientX - rez.px), TERM_MIN_W, W - terminal.x);
      terminal.h = clamp(rez.h + (e.clientY - rez.py), TERM_MIN_H, H - terminal.y);
      placePopped();
    });
    const endRez = (e: PointerEvent) => {
      if (!rez) return;
      rez = null;
      termResize.releasePointerCapture(e.pointerId);
      viewport.focus({ preventScroll: true });
    };
    termResize.addEventListener("pointerup", endRez);
    termResize.addEventListener("pointercancel", endRez);

    // Drag the docked band's TOP edge up/down to set its height (docked only). This is
    // a camera crop — it changes how many room rows are visible, NEVER the tile size.
    let dockRez: { py: number; h: number } | null = null;
    termDockGrip.addEventListener("pointerdown", (e) => {
      if (terminal.mode !== "docked") return;
      dockRez = { py: e.clientY, h: terminal.dockedH };
      termDockGrip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    termDockGrip.addEventListener("pointermove", (e) => {
      if (!dockRez) return;
      const maxH = Math.max(TERM_DOCK_MIN_H, fullH - tile); // keep at least one room row visible
      terminal.dockedH = clamp(dockRez.h + (dockRez.py - e.clientY), TERM_DOCK_MIN_H, maxH); // up = taller
      applyViewport(); // camera-only; tile unchanged → no breathing
    });
    const endDockRez = (e: PointerEvent) => {
      if (!dockRez) return;
      dockRez = null;
      termDockGrip.releasePointerCapture(e.pointerId);
      viewport.focus({ preventScroll: true });
    };
    termDockGrip.addEventListener("pointerup", endDockRez);
    termDockGrip.addEventListener("pointercancel", endDockRez);

    return {
      containsActive: () => terminalEl.contains(document.activeElement),
      applyMode: applyTerminalMode,
      applyFont: applyTermFont,
      clampAndPlace: () => { clampTerminal(); if (terminal.mode === "popped") placePopped(); },
      layoutDocked: () => {
        terminalEl.style.left = "0px";
        terminalEl.style.top = `${window.innerHeight - terminal.dockedH}px`;
        terminalEl.style.width = `${container.clientWidth}px`;
        terminalEl.style.height = `${terminal.dockedH}px`;
      },
      write: (lines, state) => {
        termBody.textContent = lines.join("\n");
        termBody.classList.toggle("term-success", state === "success");
        termBody.classList.toggle("term-error", state === "error");
      },
    };
  }

  let terminalApi: TerminalApi | null = null;
  if (hasTerminal) terminalApi = buildTerminal();

  // --- dialogue presenter (system) -------------------------------------------
  // Owns the portrait + narrator surfaces, the beat queue, the hint-giver marker, and the
  // first-time-once MECHANISM. Terminal-dock + stage-top are INJECTED getters (we never
  // reach into the terminal from the presenter); it only signals isActive() — the engine's
  // keydown handler does the gameplay suppression. firstTimeBeat = snakeBeat (coding content).
  const dialogue = createDialogue({
    container,
    markerLayer,
    speakers,
    hintGiver,
    hintLines,
    hasPortrait: hasTerminal,
    isTerminalDocked: () => terminal.mode === "docked",
    dockedH: () => terminal.dockedH,
    stageTop: () => stage.getBoundingClientRect().top,
    hudH: HUD_H,
    hudGap: HUD_GAP,
    onEnd: () => viewport.focus({ preventScroll: true }),
    firstTimeBeat: snakeBeat,
  });

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  /**
   * TILE-SIZING pass — runs ONLY on window resize (and first mount). Computes the
   * largest integer tile that fits the room in the FULL viewport (the terminal is an
   * overlay and is deliberately ignored here, so docking never changes the tile).
   */
  function relayout() {
    // Bail on a stale debounced fire after the room was replaced or hidden (e.g. the
    // dev switcher moved to a card game): the fullscreen host is still in the DOM but
    // display:none, so measuring it would yield zeros.
    if (!container.isConnected || container.hidden) return;

    // Full room space: window width (minus a little) and the height between the top
    // UI bar and the inventory HUD. NOTHING is reserved for the terminal here.
    const top = stage.getBoundingClientRect().top;
    fullW = Math.max(FIXED_TILE, (container.clientWidth || window.innerWidth) - SIDE_RESERVE);
    // Reserve the HUD band (and its gaps) — terminal-independent so dock/undock never
    // changes the tile. fullH is the POPPED-state room height; docking crops further.
    fullH = Math.max(FIXED_TILE, window.innerHeight - top);

    // Tile px from window+room+roomSize (see systems/camera): "fill" → largest integer
    // tile that fits (steps only at true thresholds), never below the floor; the fixed
    // sizes ignore the window and let the camera scroll.
    tile = computeTile({
      fullW, fullH, roomWidth: room.width, roomHeight: room.height,
      roomSize: roomSettings.roomSize, minTile: FIXED_TILE,
    });

    buildTiles();
    drawCodingZone();
    buildControlsLayer();
    buildDoors();
    buildMenuPortal();
    dialogue.buildMarker(tile);
    buildPiles();
    drawPlaced();
    terminalApi?.clampAndPlace();                 // keep a popped window on-screen after resize
    applyViewport();
  }

  /**
   * CAMERA pass — sets the visible viewport (rows/cols) and the docked terminal band.
   * Called by relayout AND on dock/undock. Reads `tile` but NEVER changes it, so
   * docking only crops the camera; there is no tile "breathing" on toggle.
   */
  function applyViewport() {
    const top = stage.getBoundingClientRect().top;
    // No terminal → nothing crops the camera, so the room uses the full height.
    const docked = !!terminalApi && terminal.mode === "docked";
    // Viewport cols/rows + the docked-crop effective height (see systems/camera). The
    // tile is an INPUT here and is never changed — docking only crops the camera.
    const { effH, viewCols: cols, viewRows: rows } = computeViewport({
      fullW, fullH, tile, roomWidth: room.width, roomHeight: room.height,
      docked, dockedH: terminal.dockedH,
    });
    viewCols = cols;
    viewRows = rows;

    stage.style.height = `${effH}px`;             // visible room area (camera height)
    viewport.style.width = `${viewCols * tile}px`;
    viewport.style.height = `${viewRows * tile}px`;
    world.style.width = `${room.width * tile}px`;
    world.style.height = `${room.height * tile}px`;

    // HUD: anchored just below the room area, always with the same gap above its lower
    // neighbour (the dock top when docked, the window bottom when popped). Bottom-up the
    // stack is: room → GAP → HUD → GAP → (dock | window edge), so the gap is consistent.
    invStrip.style.top = `${top + effH - HUD_H - HUD_GAP}px`;

    // Band anchored to the WINDOW bottom, full width; the HUD sits a GAP above it.
    if (docked) terminalApi!.layoutDocked();
    dialogue.positionPortrait(); // keep the portrait anchored to the terminal across dock/resize
    draw();
  }

  /** (Re)build the static tile grid at the current tile size (see systems/tileLayer). */
  function buildTiles() {
    renderTileLayer(tileLayer, room, tile);
  }

  /** Position the tinted coding-area zone (a single rectangle over those cells). No-op
   *  when the coding_area feature is off (the element was never created). */
  function drawCodingZone() {
    if (!zoneEl) return;
    const a = room.codingArea;
    if (!a) { zoneEl.hidden = true; return; }
    zoneEl.hidden = false;
    zoneEl.style.width = `${a.width * tile}px`;
    zoneEl.style.height = `${a.height * tile}px`;
    zoneEl.style.transform = `translate(${a.x * tile}px, ${a.y * tile}px)`;
  }

  /** (Re)build the Build / Run objects: labeled tiles, distinct from piles/tokens. No-op
   *  when the coding_area feature is off (no layer, no controls). */
  function buildControlsLayer() {
    if (!controlLayer) return;
    controlLayer.innerHTML = "";
    for (const c of controls) {
      const el = document.createElement("div");
      el.className = `tile-room tile-control tile-control-${c.action}`;
      el.style.width = `${tile}px`;
      el.style.height = `${tile}px`;
      el.style.transform = `translate(${c.pos.x * tile}px, ${c.pos.y * tile}px)`;
      const label = document.createElement("span");
      label.className = "tile-control-label";
      label.textContent = c.label;
      label.style.fontSize = `${Math.round(tile * 0.26)}px`;
      el.appendChild(label);
      controlLayer.appendChild(el);
    }
  }

  /** (Re)build the hub PORTALS (same swirly look as the menu portal, plus a label). The
   *  EFFECTIVE state (resolved against earned unlocks) drives the look: open = active
   *  swirl, locked/coming_soon = a dimmed pad with a lock / construction glyph. */
  function buildDoors() {
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
    menuPortalEl.style.width = `${tile}px`;
    menuPortalEl.style.height = `${tile}px`;
    menuPortalEl.style.transform = `translate(${menuPortalCell.x * tile}px, ${menuPortalCell.y * tile}px)`;
    menuPortalEl.style.fontSize = `${Math.round(tile * 0.5)}px`;
    menuPortalEl.textContent = "🌀";
  }

  /** (Re)build the word piles at the current tile size. */
  function buildPiles() {
    pileLayer.innerHTML = "";
    for (const pile of room.piles) {
      const p = document.createElement("div");
      p.className = "tile-room tile-pile";
      p.style.width = `${tile}px`;
      p.style.height = `${tile}px`;
      p.style.transform = `translate(${pile.pos.x * tile}px, ${pile.pos.y * tile}px)`;
      const label = document.createElement("span");
      label.className = "tile-pile-label";
      label.textContent = pile.token;
      label.style.fontSize = `${Math.round(tile * 0.25)}px`;
      p.appendChild(label);
      pileLayer.appendChild(p);
    }
  }

  function draw() {
    // Slime box + camera-follow translate (see systems/player); same inset/transform/clamp.
    drawPlayer(slime, world, {
      pos, tile, viewCols, viewRows, roomWidth: room.width, roomHeight: room.height,
    });
    drawDebug(); // current-row readout depends on where the player is standing
  }

  /** Bloom the teleport flash in a CELL, in `color`, then run `onDone` (~flash duration).
   *  No-op-but-still-calls-onDone when there's no flash element (keeps callers' order intact). */
  function playFlash(cell: Cell, _color: string, onDone?: () => void) {
    onDone?.(); return;
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    if (!flashEl) { onDone?.(); return; }
    // flashEl.style.setProperty("--flash", color);
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
   *  portals are untouched. */
  function playHubArrival(color: string) {
    const portal = document.createElement("div");
    portal.className = "tile-room tile-portal tile-portal-transient"; // under the slime (z-index)
    portal.style.width = `${tile}px`;
    portal.style.height = `${tile}px`;
    portal.style.transform = `translate(${room.spawn.x * tile}px, ${room.spawn.y * tile}px)`;
    portal.style.fontSize = `${Math.round(tile * 0.5)}px`;
    portal.textContent = "🌀";
    world.append(portal);

    const hopOff = () => {
      for (const dir of [MOVE.up, MOVE.right, MOVE.left, MOVE.down]) {
        const next = step(room, pos, dir);
        if (next.x !== pos.x || next.y !== pos.y) { pos = next; draw(); break; }
      }
      portal.remove();
    };
    hopOff()
    playFlash(room.spawn, color, () => {
      // slime hops off the portal cell into the first open neighbor, then the pad vanishes
      for (const dir of [MOVE.right, MOVE.left, MOVE.up, MOVE.down,]) {
        const next = step(room, pos, dir);
        if (next.x !== pos.x || next.y !== pos.y) { pos = next; draw(); break; }
      }
      portal.remove(); // self-consume — the transient portal is gone
    });
  }
  void playHubArrival; // kept (referenced) while the hub-arrival animation is disabled above

  /** Placed tokens on a given row, left-to-right (the "line" for that row). */
  function lineOnRow(y: number): Placed[] {
    return tokensOnRow(placed, y);
  }

  /** Indent = leftmost placed column on the row minus the coding area's left edge. */
  function indentOnRow(y: number): number | null {
    const line = lineOnRow(y);
    if (!line.length || !room.codingArea) return null;
    return line[0].x - room.codingArea.x;
  }

  function drawPlaced() {
    placedLayer.innerHTML = "";
    for (const p of placed) {
      const t = document.createElement("div");
      t.className = "tile-room tile-placed";
      t.style.width = `${tile}px`;
      t.style.height = `${tile}px`;
      t.style.transform = `translate(${p.x * tile}px, ${p.y * tile}px)`;
      const label = document.createElement("span");
      label.className = "tile-pile-label";
      label.style.fontSize = `${Math.round(tile * 0.25)}px`;
      label.textContent = p.token;
      t.appendChild(label);
      placedLayer.appendChild(t);
    }
    drawDebug();
  }

  function drawDebug() {
    debugEl.hidden = !debugOn;
    if (!debugOn) return;
    const line = lineOnRow(pos.y).map((p) => p.token);
    const indent = indentOnRow(pos.y);
    const status = buildState.built ? "built" : "dirty";
    debugEl.textContent = `row ${pos.y}: [${line.join(", ")}]  indent=${indent ?? "—"}  ·  ${status}  ·  tile=${tile}px`;
  }

  // -------------------------------------------------------------------------
  // Build / Run — order-check against the pack answer (NO execution; see codeGameLogic)
  // -------------------------------------------------------------------------

  /** The program Build/Run evaluates: EVERY occupied row inside the coding area (placement
   *  is free, but tokens outside the zone are silently ignored). More than the answer's
   *  lines → extra code, which fails (see checkProgram). */
  function currentProgram() {
    return evaluatedLines(placed, room.codingArea);
  }

  /** Placing/removing a token re-dirties the line (must Build again before Run). */
  function dirtyLine() {
    buildState = markDirty(buildState);
    drawDebug();
  }

  /** Echo flavor text into the EXISTING terminal (nothing executes). */
  function termSet(lines: string[], state: "neutral" | "success" | "error") {
    terminalApi?.write(lines, state); // no terminal → nowhere to echo (no-op)
  }

  function doBuild() {
    buildState = markBuilt(buildState);
    termSet([termCmds.build, "compiled main.py ✓ — ready to Run"], "neutral");
    drawDebug();
    // GUIDED TUTORIAL first (advance past the waiting step), THEN any first-time beat —
    // the reverse order would leave a satisfied step waiting forever behind the beat.
    dialogue.notify("build");
    dialogue.fireFirstTime("first_build"); // Build always succeeds → first Build is the first successful one
  }

  function doRun() {
    dialogue.notify("run"); // GUIDED TUTORIAL: satisfies a step waiting on "run" (any attempt)
    const res = runProgram(buildState, currentProgram(), answer);
    // Terminal = pretend shell transcript (flavor); the SNAKE portrait delivers the beat.
    if (res.ok) {
      termSet([termCmds.run, solution.output], "success");
    } else {
      const err =
        res.reason === "build-first" ? "error: nothing built" :
        res.reason === "extra-code" ? "error: unexpected extra code" : "(no output)";
      termSet([termCmds.run, err], "error");
    }
    if (res.ok) {
      callbacks.onSolved?.(puzzle); // may earn an unlock (e.g. open the next door in the hub)
      const b = snakeBeat("success");
      if (b) dialogue.play([b]);
      return;
    }
    // A first-time teaching beat (run-before-build, or the first wrong order) takes
    // precedence the FIRST time it happens; afterwards the normal reason beat plays.
    const firstTrigger =
      res.reason === "build-first" ? "first_run_no_build" :
      res.reason === "wrong-order" ? "first_wrong_order" : null;
    if (firstTrigger && dialogue.fireFirstTime(firstTrigger)) return;
    const b = snakeBeat(res.reason as CheckReason);
    if (b) dialogue.play([b]);
  }

  function activateControl(c: RoomControl) {
    if (c.action === "build") doBuild();
    else doRun();
  }

  // Coding-puzzle beat factory (CONTENT): wrap a `beats`-map entry (a run reason like
  // "build-first"/"success", or a "first_*" trigger) as a SNAKE portrait beat, or null
  // when the pack defines no text. Injected into the dialogue presenter as `firstTimeBeat`
  // and also used directly for run-reason beats. (Presenter machinery → systems/dialogue.)
  function snakeBeat(reason: string): DialogueBeat | null {
    const text = beats[reason];
    if (!text) return null;
    return { id: `beat-${reason}`, speaker: "snake", text, trigger: reason };
  }

  /** Always-visible HUD (Minecraft hotbar feel): N slots, FIFO order, a highlighted
   *  selected slot while in inventory focus, slightly dimmed while in room focus. */
  function drawInventory() {
    invStrip.classList.toggle("focused", invFocused); // brightening = the real focus signal
    invStrip.innerHTML = "";
    for (let s = 0; s < invSlots; s++) {
      const slot = document.createElement("span");
      const filled = s < inventory.length;
      const selected = invFocused && s === invSel;
      slot.className = `room-inventory-slot${filled ? "" : " empty"}${selected ? " selected" : ""}`;
      slot.textContent = filled ? inventory[s] : "";
      invStrip.appendChild(slot);
    }
  }

  // --- inventory focus transitions -----------------------------------------
  function enterInventory() {
    invFocused = true;
    invSel = clamp(invSel, 0, invSlots - 1);
    drawInventory();
  }
  /** Enter inventory focus in drop mode: a full-inventory pickup waiting on a choice. */
  function enterDrop(pending: string, restore: Placed | null) {
    invDrop = { pending, restore };
    invFocused = true;
    invSel = 0;
    drawInventory();
  }
  // (exitInventory is defined above, near dropFocusToRoom.)

  /** Take one copy of `token`. Full inventory does NOT silently fail: it shifts to
   *  inventory focus with a drop/cancel prompt (same slot cursor). */
  function tryPickup(token: string) {
    if (inventory.length >= invSlots) { enterDrop(token, null); return; }
    inventory.push(token);
    drawInventory();
    dialogue.notify("pickup"); // GUIDED TUTORIAL first (see doBuild), then first-time beats
    dialogue.fireFirstTime("first_pickup");
    if (inventory.length >= invSlots) dialogue.fireFirstTime("first_inventory_full");
  }

  /** Pick a placed token back into inventory; if full, the same drop/cancel flow (the
   *  token is lifted off the board and restored on cancel). */
  function tryPickPlaced(p: Placed) {
    if (inventory.length >= invSlots) {
      placed.splice(placed.indexOf(p), 1); // lift it off; restored on cancel, kept on drop
      enterDrop(p.token, p);
      drawPlaced();
      dirtyLine(); // the line changed → must Build again
      return;
    }
    inventory.push(p.token);
    placed.splice(placed.indexOf(p), 1);
    drawInventory();
    drawPlaced();
    dirtyLine();
  }

  /** Place inventory[index] onto ANY empty cell here (CONSUMED, one-use). Placement is
   *  free anywhere in the room; only the coding-area region is read by Build/Run. */
  function placeToken(index: number) {
    if (index < 0 || index >= inventory.length) return; // empty slot → nothing to place
    if (placedAt(pos.x, pos.y) || pileAt(room, pos.x, pos.y) || controlAt(pos.x, pos.y)) return; // empty, non-pile cell (the player only ever stands on floor)
    const [token] = inventory.splice(index, 1);
    placed.push({ token, x: pos.x, y: pos.y });
    invSel = clamp(invSel, 0, Math.max(0, inventory.length - 1));
    drawInventory();
    drawPlaced();
    dirtyLine(); // a freshly placed token → line is dirty until Built
    dialogue.notify("place"); // GUIDED TUTORIAL first (see doBuild), then first-time beats
    dialogue.fireFirstTime("first_place");
  }

  /** 'i': pile/placed here → pick up; otherwise toggle room ↔ inventory focus. */
  function pressI() {
    const onPlaced = placedAt(pos.x, pos.y);
    const here = pileAt(room, pos.x, pos.y);
    if (onPlaced) { tryPickPlaced(onPlaced); return; }
    if (here) { tryPickup(here.token); return; }
    if (invFocused) exitInventory(); else enterInventory();
  }

  /** 'p': inventory focus → place SELECTED slot; room focus → place FIFO (front). */
  function pressPlace() {
    placeToken(invFocused ? invSel : 0);
  }

  /** Enter in drop mode: drop the selected slot, take the pending token, return to room. */
  function confirmDrop() {
    if (!invDrop) return;
    if (invSel < inventory.length) {
      inventory.splice(invSel, 1);
      inventory.push(invDrop.pending);
    }
    invDrop = null;
    invFocused = false; // pickup resolved → back to room focus
    drawInventory();
  }

  // --- action dispatch (bindings-driven; one mechanism for keys AND sequences) ---
  const activeBindings = (): Bindings => roomSettings.bindings[roomSettings.scheme];
  let pendingKeys: Key[] = []; // buffered keys of an in-progress sequence (e.g. d…)
  let seqTimer = 0;
  function clearPending() {
    pendingKeys = [];
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = 0; }
  }
  function armPendingTimer() {
    if (seqTimer) clearTimeout(seqTimer);
    seqTimer = window.setTimeout(() => { pendingKeys = []; seqTimer = 0; }, SEQ_WINDOW);
  }

  function moveOrCursor(dir: { dx: number; dy: number }) {
    if (invFocused) {
      if (dir.dx < 0 || dir.dy < 0) invSel = Math.max(0, invSel - 1);
      else invSel = Math.min(invSlots - 1, invSel + 1);
      drawInventory();
    } else {
      const before = pos;
      pos = step(room, pos, dir);
      draw();
      // GUIDED TUTORIAL: a step waiting on "move" needs an ACTUAL move — bumping a wall doesn't count.
      if (pos.x !== before.x || pos.y !== before.y) dialogue.notify("move");
    }
  }
  function doInteract() {
    if (invFocused) { if (invDrop) confirmDrop(); return; }
    const c = controlAt(pos.x, pos.y);             // stand on Build / Run → activate
    const menuHere = onMenuPortal(pos.x, pos.y);   // stand on the menu portal → chooser
    const d = doorAt(pos.x, pos.y);                // stand on a door → transition or blocked beat
    const hintHere = dialogue.onHintGiver(pos.x, pos.y); // stand on "?" → next hint beat
    // GUIDED TUTORIAL: satisfies a step waiting on "interact" — any of the above counts.
    if (c || menuHere || d || hintHere) dialogue.notify("interact");
    if (c) { activateControl(c); return; }
    if (menuHere) { openDestinationMenu(); return; }
    if (d) { activateDoor(d); return; }
    if (hintHere) dialogue.talkToHint();
  }

  /** Hub PORTALS — one mechanic, data-driven reaction (see engine/doors.ts): open → the
   *  teleport-away sequence (flash in the destination's color → remove slime → change map),
   *  same as the menu portal; locked / coming_soon → fire the beat and stay put. */
  function activateDoor(d: RoomDoor) {
    const reaction = doorReaction(d, unlocks);
    if (reaction.kind === "transition") {
      // GUIDED TUTORIAL: an OPEN-door transition satisfies "enter_door" (stricter than
      // "interact" — a blocked door or the hint giver doesn't count). Fired BEFORE the
      // flash/teardown so the step advances (and completion persists) while this room lives.
      dialogue.notify("enter_door");
      const color = callbacks.flashColorFor?.(reaction.target)
        ?? portalFlashColor({ puzzleType: puzzle.puzzle_type });
      playFlash(pos, color, () => {
        slime.remove();                      // remove the slime before the map changes
        callbacks.onDoor?.(reaction.target); // manager tears THIS room down + mounts target
      });
      return;
    }
    // Blocked-portal reactions speak as the NARRATOR (no character) — works in terminal-less rooms like the hub.
    if (d.beat) dialogue.play([{ id: `door-${reaction.reason}`, speaker: "narrator", text: d.beat, trigger: "door" }]);
  }

  // --- destination menu (the menu portal's chooser) -------------------------
  function openDestinationMenu() {
    if (!callbacks.menuDestinations) return;
    destOptions = callbacks.menuDestinations(); // fresh: a just-earned unlock shows up now
    if (!destOptions.length) return;
    destSel = 0;
    destMenuOpen = true;
    renderDestMenu();
    destMenuEl.hidden = false;
  }
  function closeDestinationMenu() {
    destMenuOpen = false;
    destMenuEl.hidden = true;
    viewport.focus({ preventScroll: true });
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
    destSel = clamp(destSel + delta, 0, destOptions.length - 1);
    renderDestMenu();
  }
  /** Commit the highlighted choice — the TELEPORT-AWAY sequence, in strict order:
   *  1) flash the slime's CURRENT cell in the destination's color (red for the hub),
   *  2) remove the slime element (clean, no leak), 3) change map (teardown + mount). */
  function selectDestination() {
    const opt = destOptions[destSel];
    if (!opt) return;
    closeDestinationMenu();
    const color = opt.flashColor ?? portalFlashColor({ hub: opt.kind === "hub", puzzleType: puzzle.puzzle_type });
    playFlash(pos, color, () => {
      slime.remove();              // 2. remove the slime before the map changes
      callbacks.onDoor?.(opt.id);  // 3. change map (manager does teardown + mount)
    });
  }
  function vimClearLine() {            // dd — clear the player's CURRENT row only (any column,
    const row = tokensOnRow(placed, pos.y); //  in or out of the coding area); other rows stay.
    if (!row.length) return;
    for (const p of row) placed.splice(placed.indexOf(p), 1);
    drawPlaced();
    dirtyLine();
  }
  function vimDeleteToken() {          // dw — delete the placed token under the player (current line)
    const p = placedAt(pos.x, pos.y);
    if (!p) return;
    placed.splice(placed.indexOf(p), 1);
    drawPlaced();
    dirtyLine();
  }
  function dispatchAction(action: string) {
    if (MOVE[action]) { moveOrCursor(MOVE[action]); return; }
    if (action === "pickup") pressI();
    else if (action === "place") pressPlace();
    else if (action === "interact") doInteract();
    else if (action === "debug") { debugOn = !debugOn; drawDebug(); }
    else if (action === "clearLine") vimClearLine();
    else if (action === "deleteToken") vimDeleteToken();
  }

  // ONE focus-aware input handler. Esc + dialogue are fixed; everything else resolves
  // the pressed key/sequence against the ACTIVE scheme's bindings (no hardcoded keys).
  const onKeydown = (e: KeyboardEvent) => {
    // Dialogue showing is a FOCUS STATE: advance on Enter/Space, skip on Esc, and suppress
    // all gameplay until it ends. A GUIDED TUTORIAL beat (waitFor set) does NOT block —
    // blocksInput() is false so the real action falls through below and reaches `dialogue`
    // via `notify()` from wherever it happens (move/interact/pickup/place/build/run).
    if (dialogue.blocksInput()) {
      e.preventDefault();
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") dialogue.advance();
      else if (e.key === "Escape" && dialogue.canSkip()) dialogue.end();
      return;
    }

    // Destination menu open is a FOCUS STATE: arrows move the cursor, Enter selects, Esc
    // routes through the esc ladder (→ close, stay in room). All gameplay is suppressed.
    if (destMenuOpen) {
      e.preventDefault();
      if (e.key === "Escape") { handleEscape(); return; }
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { selectDestination(); return; }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "w" || e.key === "k") { moveDestSel(-1); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "s" || e.key === "j") { moveDestSel(1); return; }
      return;
    }

    if (e.key === "Escape") { e.preventDefault(); handleEscape(); return; } // reserved: esc ladder

    const key = normalizeKey(e.key);
    pendingKeys.push(key);
    let r = resolve(activeBindings(), pendingKeys);
    if (r.kind === "none" && pendingKeys.length > 1) {
      pendingKeys = [key];                 // a sequence broke — restart from this key
      r = resolve(activeBindings(), pendingKeys);
    }
    if (r.kind === "fire") {
      e.preventDefault();
      const action = r.action;
      clearPending();
      dispatchAction(action);
    } else if (r.kind === "pending") {
      e.preventDefault();
      armPendingTimer();                   // wait for the next key in the sequence
    } else {
      clearPending();                      // unbound key — let it pass through
    }
  };
  viewport.addEventListener("keydown", onKeydown);
  // Mouse may focus the room (room⇄terminal focus switch); it does nothing else in-room.
  const onPointerDown = () => viewport.focus({ preventScroll: true });
  viewport.addEventListener("pointerdown", onPointerDown);

  // Debounced resize: recompute the layout but coalesce bursts of resize events.
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, RESIZE_DEBOUNCE);
  };
  window.addEventListener("resize", onResize);

  terminalApi?.applyMode(); // terminal starts docked (bottom band) — no-op without a terminal
  terminalApi?.applyFont(); // apply the persisted terminal font size
  relayout();
  drawInventory();
  viewport.focus({ preventScroll: true });
  // ARRIVAL emergence:
  //  • PUZZLE → bloom the spawn cell on the PERMANENT menu portal (which STAYS) in the
  //    arriving room's color (its type, or this room's override).
  //  • HUB → a TRANSIENT red portal flashes, the slime hops off, then it self-consumes.
  if (menuPortalCell) {
    playFlash(room.spawn, portalFlashColor({ puzzleType: puzzle.puzzle_type, override: layout.flash_color }));
  } else if (callbacks.transientArrivalColor) {
    // playHubArrival(callbacks.transientArrivalColor);
  }
  // First-ever visit to this room: on_enter (story, if any) + the guided tutorial, played
  // as ONE unskippable sequence, then marked seen (see codex.ts). Every later visit just
  // gets the normal on_enter greeting, exactly as before.
  if (guidedTutorialBeats.length && !hasCompletedTutorial(puzzle.id)) {
    dialogue.play([...onEnterBeats, ...guidedTutorialBeats], {
      onComplete: () => completeTutorial(puzzle.id),
      skippable: false,
    });
  } else if (onEnterBeats.length) {
    dialogue.play(onEnterBeats); // snake greeting slides in on enter
  }

  // --- TEARDOWN: undo EVERYTHING this room created, so nothing bleeds into the next. ---
  teardown.add(() => window.removeEventListener("resize", onResize));
  teardown.add(() => viewport.removeEventListener("keydown", onKeydown));
  teardown.add(() => viewport.removeEventListener("pointerdown", onPointerDown));
  teardown.add(() => {
    // every timer/interval the room can have running
    dialogue.clearTimers();                              // autoTimer + talkTimer (interval)
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = 0; }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
    settings.cancelCapture();                            // drop any pending rebind-capture timer
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; } // pending hub-warp flash
  });
  // Dropping all room DOM also detaches every element-scoped listener (settings + terminal
  // pointer handlers, buttons) — they GC with their nodes.
  teardown.add(() => { container.innerHTML = ""; });

  const handle: RoomHandle = {
    teardown: () => {
      teardown.run();
      if (activeRoomTeardown === handle.teardown) activeRoomTeardown = null;
    },
  };
  activeRoomTeardown = handle.teardown;
  return handle;
}
