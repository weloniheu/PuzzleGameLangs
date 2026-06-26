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
import { parseRoom, step, pileAt, type Cell } from "../room";
import { resetCodex, getUnlocks } from "../codex";
import { doorReaction, effectiveDoorState } from "../doors";
import { createTeardown } from "../teardown";
import { resolveFeatures, resolveInventorySlots } from "../roomFeatures";
import type { DestinationOption } from "../progression";
import { portalFlashColor } from "../portalColors";
import {
  run as runProgram,
  createBuildState,
  markBuilt,
  markDirty,
  tokensOnRow,
  evaluatedLines,
  type AnswerLine,
  type CheckReason,
} from "../codeGameLogic";
import {
  defaultBindings, actionsFor, normalizeKey, resolve, rebind, bindingGlyph,
  type SchemeId, type Bindings, type Key,
} from "../keybindings";

const SCHEME_LABELS: Record<SchemeId, string> = { standard: "Standard", vim: "Vim" };
const SCHEME_TABS: SchemeId[] = ["standard", "vim"];
const SEQ_WINDOW = 600;       // ms a pending gameplay sequence (e.g. d…) waits for its next key
const CAPTURE_WINDOW = 320;   // ms an in-progress capture waits before committing
const CAPTURE_MAX = 2;        // longest sequence the rebinder captures (covers dd/dw)
/** Movement actions → step vectors. */
const MOVE: Record<string, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
};

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
const TERM_FONT_MIN = 10;    // terminal font-size bounds (settings)
const TERM_FONT_MAX = 28;
const TERM_FONT_STEP = 2;

// Room size: "fill" scales tiles to fill the window (responsive); the others are
// FIXED tile sizes (camera scrolls if the room is larger than the window).
type RoomSize = "fill" | "small" | "medium" | "large";
const ROOM_TILE: Record<Exclude<RoomSize, "fill">, number> = { small: 30, medium: 40, large: 56 };
// Session-persistent room preferences (survive puzzle switches within a session) — now
// including the active scheme and the editable bindings for BOTH schemes.
const roomSettings = {
  roomSize: "fill" as RoomSize,
  termFontPx: 14,
  scheme: "standard" as SchemeId,
  bindings: { standard: defaultBindings("standard"), vim: defaultBindings("vim") } as Record<SchemeId, Bindings>,
};

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
  const dialogue = payload.dialogue;
  const speakers: Record<string, DialogueSpeaker> = dialogue?.speakers ?? {};
  const onEnterBeats: DialogueBeat[] = dialogue?.on_enter ?? [];
  const hintLines = dialogue?.hints ?? [];
  const AUTO_LEN = 48;       // text shorter than this auto-advances when autoAdvance is unset
  const AUTO_PAUSE = 1700;   // ms an auto-advancing beat lingers

  const room = parseRoom(layout);
  let pos: Cell = { ...room.spawn };
  const inventory: string[] = [];
  const placed: Placed[] = [];
  let debugOn = false;
  let buildState = createBuildState(); // line is "dirty" until Built (see codeGameLogic)

  // Dialogue state. `dialogueQueue`/`dialogueIdx` drive the shared portrait presenter;
  // dialogueActive (idx >= 0) is a FOCUS STATE that suppresses gameplay until advanced.
  let dialogueQueue: DialogueBeat[] = [];
  let dialogueIdx = -1;
  let autoTimer = 0;
  let talkTimer = 0;
  let hintIdx = -1; // hint giver progresses one line per interaction, capped at the last

  // First-time event beats: tutorial rooms define `first_*` beats that fire ONCE the
  // first time each mechanic happens. Tracked per room-LOAD (this set lives in the
  // renderer closure), so re-entering / replaying the room teaches again. Non-tutorial
  // rooms simply don't define `first_*` beats, so nothing fires (see fireFirstTime).
  const firedFirstTimes = new Set<string>();

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
  const onHintGiver = (x: number, y: number) => !!hintGiver && hintGiver.pos.x === x && hintGiver.pos.y === y;

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

  // --- top bar: just the gear (controls now live INSIDE the settings panel). ---
  const topbar = document.createElement("div");
  topbar.className = "room-topbar";
  const gearBtn = document.createElement("button");
  gearBtn.type = "button";
  gearBtn.className = "room-gear";
  gearBtn.textContent = "⚙";
  gearBtn.title = "Settings & controls";
  gearBtn.setAttribute("aria-label", "Settings and controls");
  topbar.append(gearBtn);
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
  const slime = document.createElement("div");
  slime.className = "slime";
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

  // --- settings panel (MOUSE allowed: window management, not gameplay) ---
  const settingsEl = document.createElement("div");
  settingsEl.className = "room-settings-panel";
  settingsEl.tabIndex = -1;
  settingsEl.hidden = true;
  const settingsCard = document.createElement("div");
  settingsCard.className = "room-settings-card";
  settingsEl.appendChild(settingsCard);
  container.appendChild(settingsEl);

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

  // Which settings screen is showing (top menu vs a sub-tab). Closed = settingsEl.hidden.
  let settingsView: "menu" | "controls" | "display" = "menu";
  // Keybinding capture (rebind) state for the Controls tab.
  let capture: { action: string; slot: number; buffer: Key[]; timer: number } | null = null;
  let captureMsg = "";

  // -- builders (sub-tabs are rebuilt on navigation) -------------------------
  function settingsLabel(text: string) {
    const p = document.createElement("p");
    p.className = "room-settings-label";
    p.textContent = text;
    return p;
  }

  /** A sub-tab header: optional back arrow (→ top menu) + title. */
  function settingsHead(text: string, withBack: boolean) {
    const head = document.createElement("div");
    head.className = "room-settings-head";
    if (withBack) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "room-settings-back";
      back.textContent = "←";
      back.title = "Back to menu";
      back.onclick = () => { settingsView = "menu"; renderSettings(); };
      head.appendChild(back);
    }
    const t = document.createElement("p");
    t.className = "room-settings-title";
    t.textContent = text;
    head.appendChild(t);
    return head;
  }

  function buildMenu() {
    settingsCard.appendChild(settingsHead("Settings", false));
    const list = document.createElement("div");
    list.className = "room-settings-menu";
    const entries: [string, (() => void) | null][] = [
      ["Controls", () => { settingsView = "controls"; renderSettings(); }],
      ["Display", () => { settingsView = "display"; renderSettings(); }],
      ["Quit", null], // stub — wired in a later phase
    ];
    for (const [text, onClick] of entries) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "room-menu-entry";
      b.textContent = text;
      if (onClick) b.onclick = onClick;
      else {
        b.disabled = true;
        const soon = document.createElement("span");
        soon.className = "room-soon";
        soon.textContent = "coming soon";
        b.appendChild(soon);
      }
      list.appendChild(b);
    }
    settingsCard.appendChild(list);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "room-settings-close";
    close.textContent = "Close";
    close.onclick = () => closeSettings();
    settingsCard.appendChild(close);
  }

  function buildControls() {
    settingsCard.appendChild(settingsHead("Controls", true));

    // Two scheme SUB-TABS. The selected sub-tab is also the ACTIVE (live) scheme.
    const tabs = document.createElement("div");
    tabs.className = "room-settings-schemes";
    for (const s of SCHEME_TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-scheme-btn${roomSettings.scheme === s ? " active" : ""}`;
      b.textContent = SCHEME_LABELS[s];
      b.onclick = () => { roomSettings.scheme = s; captureCancel(); renderSettings(); };
      tabs.appendChild(b);
    }
    settingsCard.append(settingsLabel("Scheme (click to make active & edit)"), tabs);

    if (roomSettings.scheme === "standard") {
      const note = document.createElement("p");
      note.className = "room-settings-help-text";
      note.textContent = "Standard: arrows AND WASD both move you. Click a binding to remap it.";
      settingsCard.appendChild(note);
    }

    // Editable bindings for the viewed scheme.
    const list = document.createElement("div");
    list.className = "room-controls";
    const scheme = roomSettings.scheme;
    const binds = roomSettings.bindings[scheme];
    for (const def of actionsFor(scheme)) {
      const row = document.createElement("div");
      row.className = "room-control-row";
      const name = document.createElement("span");
      name.textContent = def.label;
      const chips = document.createElement("div");
      chips.className = "room-bind-chips";
      const slots = binds[def.id] ?? [];
      slots.forEach((b, slot) => {
        const chip = document.createElement("button");
        chip.type = "button";
        const capturing = capture && capture.action === def.id && capture.slot === slot;
        chip.className = `room-bind-chip${capturing ? " capturing" : ""}`;
        chip.textContent = capturing ? "press a key…" : bindingGlyph(b);
        chip.onclick = () => captureStart(def.id, slot);
        chips.appendChild(chip);
      });
      row.append(name, chips);
      list.appendChild(row);
    }
    settingsCard.append(settingsLabel("Keys — click to remap · Esc cancels"), list);

    // Reserved + conflict messages.
    const msg = document.createElement("p");
    msg.className = `room-settings-help-text${captureMsg ? " warn" : ""}`;
    msg.textContent = captureMsg || "Esc is reserved for the menu and can't be bound.";
    settingsCard.appendChild(msg);

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "room-settings-reset";
    reset.textContent = "🧹 Reset all progress";
    reset.title = "Erase ALL saved progress: discovered commands AND room unlocks";
    reset.onclick = () => {
      // Confirm before wiping — this clears the Codex AND every earned hub unlock.
      const ok = window.confirm(
        "Reset all progress?\n\nThis erases EVERYTHING saved: every discovered command AND all room unlocks. This cannot be undone.",
      );
      if (ok) resetCodex();
    };
    settingsCard.appendChild(reset);
  }

  function buildDisplay() {
    settingsCard.appendChild(settingsHead("Display", true));

    // Room size: Fill window / Small / Medium / Large.
    const sizeRow = document.createElement("div");
    sizeRow.className = "room-settings-schemes";
    const sizes: [RoomSize, string][] = [
      ["fill", "Fill window"], ["small", "Small"], ["medium", "Medium"], ["large", "Large"],
    ];
    for (const [val, text] of sizes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-scheme-btn${roomSettings.roomSize === val ? " active" : ""}`;
      b.textContent = text;
      // Deliberate tile-size change on user action (distinct from the no-breathing-on-dock rule).
      b.onclick = () => { roomSettings.roomSize = val; renderSettings(); relayout(); };
      sizeRow.appendChild(b);
    }
    settingsCard.append(settingsLabel("Room size"), sizeRow);

    // Terminal text size — only when this room HAS a terminal (else there's nothing to size).
    if (!hasTerminal) return;
    const presetRow = document.createElement("div");
    presetRow.className = "room-settings-schemes";
    for (const px of [12, 16, 20, 24]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-scheme-btn${roomSettings.termFontPx === px ? " active" : ""}`;
      b.textContent = String(px);
      b.onclick = () => setTermFont(px);
      presetRow.appendChild(b);
    }
    const stepRow = document.createElement("div");
    stepRow.className = "room-settings-font";
    const minus = document.createElement("button");
    minus.type = "button"; minus.className = "room-font-btn"; minus.textContent = "A−";
    minus.onclick = () => setTermFont(roomSettings.termFontPx - TERM_FONT_STEP);
    const readout = document.createElement("span");
    readout.className = "room-font-readout";
    readout.textContent = `${roomSettings.termFontPx}px`;
    const plus = document.createElement("button");
    plus.type = "button"; plus.className = "room-font-btn"; plus.textContent = "A+";
    plus.onclick = () => setTermFont(roomSettings.termFontPx + TERM_FONT_STEP);
    stepRow.append(minus, readout, plus);

    const sample = document.createElement("div");
    sample.className = "room-font-sample";
    sample.textContent = '>>> print("hello, world")';
    sample.style.fontSize = `${roomSettings.termFontPx}px`;

    settingsCard.append(settingsLabel("Terminal text size"), presetRow, stepRow, sample);
  }

  /** Render the current settings screen; keep focus on the panel so Esc lands here. */
  function renderSettings() {
    settingsCard.innerHTML = "";
    if (settingsView === "controls") buildControls();
    else if (settingsView === "display") buildDisplay();
    else buildMenu();
    settingsEl.focus({ preventScroll: true });
  }

  function setTermFont(px: number) {
    roomSettings.termFontPx = clamp(px, TERM_FONT_MIN, TERM_FONT_MAX);
    terminalApi?.applyFont(); // no-op without a terminal
    renderSettings(); // refresh active preset highlight + live sample
  }

  // --- keybinding capture (manual rebind) ---
  function captureCancel() {
    if (capture?.timer) clearTimeout(capture.timer);
    capture = null;
  }
  function captureStart(action: string, slot: number) {
    captureCancel();
    capture = { action, slot, buffer: [], timer: 0 };
    captureMsg = "";
    renderSettings(); // chip shows "press a key…"
  }
  function captureCommit() {
    if (!capture) return;
    const { action, slot, buffer } = capture;
    if (capture.timer) clearTimeout(capture.timer);
    capture = null;
    if (!buffer.length) { renderSettings(); return; }
    const res = rebind(roomSettings.bindings[roomSettings.scheme], action, slot, buffer);
    if (res.ok) {
      roomSettings.bindings[roomSettings.scheme] = res.bindings;
      captureMsg = "";
    } else if (res.reason === "reserved") {
      captureMsg = "That key is reserved (Esc). Binding unchanged.";
    } else if (res.reason === "conflict") {
      const label = actionsFor(roomSettings.scheme).find((a) => a.id === res.conflictAction)?.label ?? res.conflictAction;
      captureMsg = `Conflicts with “${label}”. Binding unchanged.`;
    } else {
      captureMsg = "No key captured. Binding unchanged.";
    }
    renderSettings();
  }
  /** Capture keystrokes while a chip is in rebind mode (single commits after a short
   *  window; a sequence commits at max length; Esc cancels). */
  function captureKey(e: KeyboardEvent) {
    if (!capture) return;
    if (e.key === "Escape") { captureCancel(); captureMsg = "Rebind cancelled."; renderSettings(); return; }
    capture.buffer.push(normalizeKey(e.key));
    if (capture.timer) clearTimeout(capture.timer);
    if (capture.buffer.length >= CAPTURE_MAX) { captureCommit(); return; }
    capture.timer = window.setTimeout(captureCommit, CAPTURE_WINDOW);
  }

  function openSettings() {
    settingsView = "menu";        // always enter at the top menu
    captureCancel();
    captureMsg = "";
    settingsEl.hidden = false;
    renderSettings();
  }
  function closeSettings() {
    captureCancel();
    settingsEl.hidden = true;
    viewport.focus({ preventScroll: true });
  }

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
    if (!settingsEl.hidden) {
      if (settingsView !== "menu") { settingsView = "menu"; renderSettings(); }
      else closeSettings();
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
    dropFocusToRoom();
    openSettings();
  }

  // Mouse-open: force room focus first (clear inventory/terminal), THEN open — so esc
  // from open settings unambiguously means "back out", never also "unfocus".
  gearBtn.onclick = () => {
    if (!settingsEl.hidden) { closeSettings(); return; }
    dropFocusToRoom();
    openSettings();
  };
  settingsEl.addEventListener("pointerdown", (e) => { if (e.target === settingsEl) closeSettings(); });
  // Click the backdrop (outside the card) to cancel the destination menu.
  destMenuEl.addEventListener("pointerdown", (e) => { if (e.target === destMenuEl) closeDestinationMenu(); });
  settingsEl.addEventListener("keydown", (e) => {
    if (capture) { e.preventDefault(); e.stopPropagation(); captureKey(e); return; } // rebind grabs all keys
    if (e.key === "Escape") { e.preventDefault(); handleEscape(); }
  });

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

  // --- dialogue surfaces -----------------------------------------------------
  // PORTRAIT path (a defined character — snake/hint — in a terminal room): avatar + name
  // + text, anchored to the terminal. NARRATOR path (default voice, any room): bare
  // transient text, no avatar/name. A beat routes by speaker (see showBeat).
  let dialogueEl: HTMLDivElement | null = null;
  let dlgPortrait: HTMLDivElement | null = null;
  let dlgName: HTMLDivElement | null = null;
  let dlgText: HTMLParagraphElement | null = null;
  let dlgCue: HTMLDivElement | null = null;
  if (hasTerminal) {
    dialogueEl = document.createElement("div");
    dialogueEl.className = "room-dialogue";
    dialogueEl.hidden = true;
    dlgPortrait = document.createElement("div");
    dlgPortrait.className = "room-dialogue-portrait";
    const dlgBox = document.createElement("div");
    dlgBox.className = "room-dialogue-box";
    dlgName = document.createElement("div");
    dlgName.className = "room-dialogue-name";
    dlgText = document.createElement("p");
    dlgText.className = "room-dialogue-text";
    dlgCue = document.createElement("div");
    dlgCue.className = "room-dialogue-cue";
    dlgBox.append(dlgName, dlgText, dlgCue);
    dialogueEl.append(dlgPortrait, dlgBox);
    container.appendChild(dialogueEl);
  }

  // Narrator: the DEFAULT voice surface (text only, no avatar/name). Always available —
  // it's the minimal text surface for rooms without a character (e.g. the hub). Placeholder;
  // real per-puzzle-type voices come later.
  const narratorEl = document.createElement("div");
  narratorEl.className = "room-narrator";
  narratorEl.hidden = true;
  container.appendChild(narratorEl);

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

    // Fixed sizes (small/medium/large) hold a constant tile and let the camera scroll,
    // regardless of window size. "fill" scales UP to the largest integer tile that
    // fits the WHOLE room — floor() => the tile only steps at true integer thresholds
    // (no continuous drift), and never below the comfortable floor.
    if (roomSettings.roomSize === "fill") {
      const fitTile = Math.floor(Math.min(fullW / room.width, fullH / room.height));
      tile = Math.max(FIXED_TILE, fitTile);
    } else {
      tile = ROOM_TILE[roomSettings.roomSize];
    }

    buildTiles();
    drawCodingZone();
    buildControlsLayer();
    buildDoors();
    buildMenuPortal();
    buildMarkers();
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
    // Docked steals dockedH from the visible height (camera crop); popped steals none.
    const effH = docked ? Math.max(tile, fullH - terminal.dockedH) : fullH;

    viewCols = Math.min(room.width, Math.max(1, Math.floor(fullW / tile)));
    viewRows = Math.min(room.height, Math.max(1, Math.floor(effH / tile)));

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
    positionDialogue(); // keep the portrait anchored to the terminal across dock/resize
    draw();
  }

  /**
   * Anchor the dialogue portrait ABOVE the terminal by default; if the docked band is
   * flush near the TOP (no room above it), render INSIDE the band so it's never clipped.
   */
  function positionDialogue() {
    const el = dialogueEl;                     // portrait surface — terminal rooms only
    if (!el || el.hidden) return;
    const areaTop = stage.getBoundingClientRect().top; // room area top (below the top bar)
    const portH = el.offsetHeight || 140;
    if (terminal.mode === "docked") {
      const bandTop = window.innerHeight - terminal.dockedH;
      const inside = bandTop - areaTop < portH + 16; // not enough room above → go inside the band
      el.classList.toggle("inside-terminal", inside);
      el.style.top = `${inside ? bandTop + 8 : bandTop - portH - 8}px`;
    } else {
      // Popped: the band isn't reserving the bottom, so float just above the HUD.
      el.classList.remove("inside-terminal");
      el.style.top = `${window.innerHeight - HUD_H - HUD_GAP - portH - 8}px`;
    }
  }

  /** (Re)build the static tile grid at the current tile size. */
  function buildTiles() {
    tileLayer.innerHTML = "";
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        const t = document.createElement("div");
        t.className = `tile-room tile-${room.grid[y][x]}`;
        t.style.width = `${tile}px`;
        t.style.height = `${tile}px`;
        t.style.transform = `translate(${x * tile}px, ${y * tile}px)`;
        tileLayer.appendChild(t);
      }
    }
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

  /** (Re)build the hint giver's "?" marker (the snake has none — it's portrait-only). */
  function buildMarkers() {
    markerLayer.innerHTML = "";
    if (!hintGiver) return;
    const el = document.createElement("div");
    el.className = "tile-room tile-hint-marker";
    el.style.width = `${tile}px`;
    el.style.height = `${tile}px`;
    el.style.transform = `translate(${hintGiver.pos.x * tile}px, ${hintGiver.pos.y * tile}px)`;
    const label = document.createElement("span");
    label.className = "tile-hint-label";
    label.textContent = hintGiver.marker ?? "?";
    label.style.fontSize = `${Math.round(tile * 0.5)}px`;
    el.appendChild(label);
    markerLayer.appendChild(el);
  }

  /** Briefly outline the hint marker (used by the "friend over there" enter beat). */
  function highlightMarker(on: boolean) {
    const el = markerLayer.firstElementChild as HTMLElement | null;
    if (el) el.classList.toggle("highlight", on);
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
    // Slime scales with the tile, inset a touch so the cell border shows.
    const inset = Math.max(4, Math.round(tile * 0.1));
    slime.style.width = `${tile - inset * 2}px`;
    slime.style.height = `${tile - inset * 2}px`;
    slime.style.transform = `translate(${pos.x * tile + inset}px, ${pos.y * tile + inset}px)`;

    // Camera follows the slime, clamped so it never shows past the room edges. When
    // the whole room is visible (viewCols === room.width) this is always 0.
    const camX = clamp(pos.x - Math.floor(viewCols / 2), 0, Math.max(0, room.width - viewCols));
    const camY = clamp(pos.y - Math.floor(viewRows / 2), 0, Math.max(0, room.height - viewRows));
    world.style.transform = `translate(${-camX * tile}px, ${-camY * tile}px)`;
    drawDebug(); // current-row readout depends on where the player is standing
  }

  /** Bloom the teleport flash in a CELL, in `color`, then run `onDone` (~flash duration).
   *  No-op-but-still-calls-onDone when there's no flash element (keeps callers' order intact). */
  function playFlash(cell: Cell, color: string, onDone?: () => void) {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    if (!flashEl) { onDone?.(); return; }
    flashEl.style.setProperty("--flash", color);
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
    playFlash(room.spawn, color, () => {
      // slime hops off the portal cell into the first open neighbor, then the pad vanishes
      for (const dir of [MOVE.down, MOVE.right, MOVE.left, MOVE.up]) {
        const next = step(room, pos, dir);
        if (next.x !== pos.x || next.y !== pos.y) { pos = next; draw(); break; }
      }
      portal.remove(); // self-consume — the transient portal is gone
    });
  }

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
    fireFirstTime("first_build"); // Build always succeeds → first Build is the first successful one
  }

  function doRun() {
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
      if (b) playSequence([b]);
      return;
    }
    // A first-time teaching beat (run-before-build, or the first wrong order) takes
    // precedence the FIRST time it happens; afterwards the normal reason beat plays.
    const firstTrigger =
      res.reason === "build-first" ? "first_run_no_build" :
      res.reason === "wrong-order" ? "first_wrong_order" : null;
    if (firstTrigger && fireFirstTime(firstTrigger)) return;
    const b = snakeBeat(res.reason as CheckReason);
    if (b) playSequence([b]);
  }

  function activateControl(c: RoomControl) {
    if (c.action === "build") doBuild();
    else doRun();
  }

  // -------------------------------------------------------------------------
  // Dialogue — shared portrait presenter for BOTH speakers (snake + hint giver).
  // dialogueIdx >= 0 is a focus state; the one keydown handler suppresses gameplay.
  // -------------------------------------------------------------------------
  const isDialogueActive = () => dialogueIdx >= 0;

  function clearDialogueTimers() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = 0; }
    if (talkTimer) { clearInterval(talkTimer); talkTimer = 0; }
  }

  function playSequence(seq: DialogueBeat[]) {
    if (!seq.length) return;
    dialogueQueue = seq;
    dialogueIdx = 0;
    showBeat();
  }

  /** Route a beat to a surface: a defined character (snake/hint) in a terminal room uses
   *  the PORTRAIT path; everything else (speaker "narrator", or no defined character) uses
   *  the bare NARRATOR text surface. */
  function showBeat() {
    clearDialogueTimers();
    const beat = dialogueQueue[dialogueIdx];
    const sp = speakers[beat.speaker];
    if (sp && dialogueEl && dlgPortrait && dlgName && dlgText && dlgCue) showPortraitBeat(beat, sp);
    else showNarratorBeat(beat);
  }

  function showPortraitBeat(beat: DialogueBeat, sp: DialogueSpeaker) {
    const el = dialogueEl!, portrait = dlgPortrait!, name = dlgName!, text = dlgText!, cue = dlgCue!;
    el.hidden = false;
    const side = sp.side === "right" ? "right" : "left";
    const frame1 = sp.portrait ?? "💬";
    const frame2 = sp.portrait2;
    el.classList.toggle("from-right", side === "right");
    el.classList.toggle("from-left", side !== "right");
    portrait.textContent = frame1;
    portrait.classList.add("talking");
    name.textContent = sp.name ?? beat.speaker;
    text.textContent = beat.text;
    highlightMarker(beat.highlight === "hint"); // outline the "?" on the relevant enter beat

    positionDialogue();
    requestAnimationFrame(() => el.classList.add("shown")); // slide in

    // Optional talking-mouth flicker between two frames (one frame is fine).
    if (frame2 && frame2 !== frame1) {
      let alt = false;
      talkTimer = window.setInterval(() => {
        alt = !alt;
        portrait.textContent = alt ? frame2 : frame1;
      }, 220);
    }

    // Advance mode: explicit autoAdvance wins; else short text auto-advances (length fallback).
    const auto = beat.autoAdvance === true || (beat.autoAdvance === undefined && beat.text.length < AUTO_LEN);
    cue.textContent = auto ? "" : "Enter ▸";
    if (auto) autoTimer = window.setTimeout(advanceDialogue, AUTO_PAUSE);
  }

  /** The narrator surface: transient text over the room, no avatar/name. Always
   *  auto-advances (with Enter able to skip via the dialogue keydown branch). */
  function showNarratorBeat(beat: DialogueBeat) {
    narratorEl.textContent = beat.text;
    narratorEl.hidden = false;
    requestAnimationFrame(() => narratorEl.classList.add("shown"));
    // Readable dwell that scales a little with length, then it clears itself.
    const dwell = Math.min(4000, Math.max(AUTO_PAUSE, beat.text.length * 45));
    autoTimer = window.setTimeout(advanceDialogue, dwell);
  }

  function advanceDialogue() {
    clearDialogueTimers();
    dialogueIdx++;
    if (dialogueIdx < dialogueQueue.length) showBeat();
    else endDialogue();
  }

  function endDialogue() {
    clearDialogueTimers();
    dialogueIdx = -1;
    dialogueQueue = [];
    highlightMarker(false);
    if (dialogueEl && dlgPortrait) {
      dlgPortrait.classList.remove("talking");
      dialogueEl.classList.remove("shown"); // slide out
      const el = dialogueEl;
      window.setTimeout(() => { if (dialogueIdx === -1) el.hidden = true; }, 260);
    }
    narratorEl.classList.remove("shown");
    window.setTimeout(() => { if (dialogueIdx === -1) narratorEl.hidden = true; }, 260);
    viewport.focus({ preventScroll: true });
  }

  /** Wrap a beats-map entry (a run reason like "build-first"/"success", or a "first_*"
   *  first-time trigger) as a SNAKE portrait beat. Returns null if the pack didn't
   *  define text for it. */
  function snakeBeat(reason: string): DialogueBeat | null {
    const text = beats[reason];
    if (!text) return null;
    return { id: `beat-${reason}`, speaker: "snake", text, trigger: reason };
  }

  /** Fire a one-shot first-time tutorial beat the FIRST time `trigger` happens this
   *  room-load, then never again. Reuses the existing dialogue presenter — a `first_*`
   *  beat is just a beat with a first-time trigger. No-op (and harmless) when the pack
   *  defines no such beat, so non-tutorial rooms are unaffected. Returns true iff a beat
   *  actually played, so callers can suppress a competing normal beat (run/build-first). */
  function fireFirstTime(trigger: string): boolean {
    if (firedFirstTimes.has(trigger)) return false;
    firedFirstTimes.add(trigger); // mark on first occurrence, whether or not a beat exists
    const b = snakeBeat(trigger);
    if (!b) return false;
    playSequence([b]);
    return true;
  }

  /** Hint giver: shows the NEXT hint per interaction, capped at the last. Tags ignored. */
  function talkToHint() {
    if (!hintLines.length) return;
    hintIdx = Math.min(hintIdx + 1, hintLines.length - 1);
    const line = hintLines[hintIdx];
    playSequence([{ id: `hint-${hintIdx}`, speaker: "hint", text: line.text, trigger: "hint" }]);
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
    fireFirstTime("first_pickup");
    if (inventory.length >= invSlots) fireFirstTime("first_inventory_full");
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
    fireFirstTime("first_place");
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
      pos = step(room, pos, dir);
      draw();
    }
  }
  function doInteract() {
    if (invFocused) { if (invDrop) confirmDrop(); return; }
    const c = controlAt(pos.x, pos.y);             // stand on Build / Run → activate
    if (c) { activateControl(c); return; }
    if (onMenuPortal(pos.x, pos.y)) { openDestinationMenu(); return; } // stand on the menu portal → chooser
    const d = doorAt(pos.x, pos.y);                // stand on a door → transition or blocked beat
    if (d) { activateDoor(d); return; }
    if (onHintGiver(pos.x, pos.y)) talkToHint();   // stand on "?" → next hint beat
  }

  /** Hub PORTALS — one mechanic, data-driven reaction (see engine/doors.ts): open → the
   *  teleport-away sequence (flash in the destination's color → remove slime → change map),
   *  same as the menu portal; locked / coming_soon → fire the beat and stay put. */
  function activateDoor(d: RoomDoor) {
    const reaction = doorReaction(d, unlocks);
    if (reaction.kind === "transition") {
      const color = callbacks.flashColorFor?.(reaction.target)
        ?? portalFlashColor({ puzzleType: puzzle.puzzle_type });
      playFlash(pos, color, () => {
        slime.remove();                      // remove the slime before the map changes
        callbacks.onDoor?.(reaction.target); // manager tears THIS room down + mounts target
      });
      return;
    }
    // Blocked-portal reactions speak as the NARRATOR (no character) — works in terminal-less rooms like the hub.
    if (d.beat) playSequence([{ id: `door-${reaction.reason}`, speaker: "narrator", text: d.beat, trigger: "door" }]);
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
    // Dialogue showing is a FOCUS STATE: advance on Enter/Space, skip on Esc, and
    // suppress all gameplay until it ends. Same handler — just another branch on state.
    if (isDialogueActive()) {
      e.preventDefault();
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") advanceDialogue();
      else if (e.key === "Escape") endDialogue();
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
    playHubArrival(callbacks.transientArrivalColor);
  }
  if (onEnterBeats.length) playSequence(onEnterBeats); // snake greeting slides in on enter

  // --- TEARDOWN: undo EVERYTHING this room created, so nothing bleeds into the next. ---
  teardown.add(() => window.removeEventListener("resize", onResize));
  teardown.add(() => viewport.removeEventListener("keydown", onKeydown));
  teardown.add(() => viewport.removeEventListener("pointerdown", onPointerDown));
  teardown.add(() => {
    // every timer/interval the room can have running
    clearDialogueTimers();                               // autoTimer + talkTimer (interval)
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = 0; }
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
    if (capture?.timer) { clearTimeout(capture.timer); }
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
