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
  Puzzle, CodeBuildPayload, CodeBuildSolution, RoomControl, DialogueBeat, DialogueSpeaker,
} from "../../schema/types";
import { parseRoom, step, pileAt, inCodingArea, type Cell } from "../room";
import { keyToDirection, inputSettings, SCHEME_LABEL, SCHEME_ORDER } from "../input";
import { resetCodex } from "../codex";
import {
  run as runProgram,
  createBuildState,
  markBuilt,
  markDirty,
  type AnswerLine,
  type CheckReason,
} from "../codeGameLogic";

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
// Session-persistent room preferences (survive puzzle switches within a session).
const roomSettings = { roomSize: "fill" as RoomSize, termFontPx: 14 };

// Movement-key glyphs shown in the in-settings controls list, per scheme.
const SCHEME_KEYS: Record<string, string> = {
  arrows: "↑ ↓ ← →",
  wasd: "W A S D",
  vim: "H J K L",
};
const DEFAULT_INV_SLOTS = 5; // fallback when a room doesn't declare inventory_slots
const PICKUP_KEY = "i";
const PLACE_KEY = "p";
const DEBUG_KEY = "`";       // toggles the placed-line readout (no movement-scheme clash)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A token placed into the coding area at a cell. */
interface Placed { token: string; x: number; y: number; }

// Only one room is mounted at a time. Track its resize handler at module scope so a
// re-render (switching puzzles) tears the old listener down instead of stacking them.
let activeResizeHandler: (() => void) | null = null;

export function renderRoom(container: HTMLElement, puzzle: Puzzle): void {
  if (activeResizeHandler) {
    window.removeEventListener("resize", activeResizeHandler);
    activeResizeHandler = null;
  }

  const layout = puzzle.room!; // main only routes room puzzles here
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
  const controls: RoomControl[] = layout.controls ?? [];
  const controlAt = (x: number, y: number) => controls.find((c) => c.pos.x === x && c.pos.y === y) ?? null;
  const hintGiver = layout.hint_giver ?? null; // the ONLY in-room dialogue marker (snake has none)
  const onHintGiver = (x: number, y: number) => !!hintGiver && hintGiver.pos.x === x && hintGiver.pos.y === y;

  // Inventory + HUD state. The HUD is ALWAYS visible. `invFocused` is the focus state:
  // room focus → arrows move the slime (HUD slightly dimmed); inventory focus → arrows
  // move the slot cursor (`invSel`), slime is parked, HUD brightened. `invDrop` holds a
  // full-inventory pickup awaiting a drop/cancel decision (reusing the SAME slot cursor);
  // its `restore` is a placed token lifted off the board, put back if the player cancels.
  const invSlots = layout.inventory_slots ?? DEFAULT_INV_SLOTS;
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
  const zoneEl = document.createElement("div"); // tinted/outlined coding-area zone
  zoneEl.className = "room-coding-zone";
  zoneEl.hidden = !room.codingArea;
  const controlLayer = document.createElement("div"); // Build / Run objects
  controlLayer.className = "room-control-layer";
  const markerLayer = document.createElement("div"); // hint giver's "?" marker
  markerLayer.className = "room-marker-layer";
  const pileLayer = document.createElement("div");
  pileLayer.className = "room-pile-layer";
  const placedLayer = document.createElement("div");
  placedLayer.className = "room-placed-layer";
  const slime = document.createElement("div");
  slime.className = "slime";
  world.append(tileLayer, zoneEl, controlLayer, markerLayer, pileLayer, placedLayer, slime);

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

  // Which settings screen is showing (top menu vs a sub-tab). Closed = settingsEl.hidden.
  let settingsView: "menu" | "controls" | "display" = "menu";

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

    // Movement scheme (the selector lives here now).
    const schemeRow = document.createElement("div");
    schemeRow.className = "room-settings-schemes";
    for (const s of SCHEME_ORDER) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-scheme-btn${inputSettings.scheme === s ? " active" : ""}`;
      b.textContent = SCHEME_LABEL[s];
      b.onclick = () => { inputSettings.scheme = s; renderSettings(); }; // keys list reflects it live
      schemeRow.appendChild(b);
    }

    // Key bindings (Move reflects the active scheme).
    const list = document.createElement("div");
    list.className = "room-controls";
    const rows: [string, string][] = [
      ["Move", SCHEME_KEYS[inputSettings.scheme] ?? "—"],
      ["Pick up / inventory", "I"],
      ["Place token", "P"],
      ["Build / Run (stand on it)", "Enter"],
      ["Debug readout", "`"],
      ["Settings", "Esc"],
    ];
    for (const [action, keys] of rows) {
      const row = document.createElement("div");
      row.className = "room-control-row";
      const a = document.createElement("span");
      a.textContent = action;
      const k = document.createElement("kbd");
      k.className = "room-control-keys";
      k.textContent = keys;
      row.append(a, k);
      list.appendChild(row);
    }

    const help = document.createElement("p");
    help.className = "room-settings-help-text";
    help.textContent =
      "Walk around with the movement keys. Stand on a word pile and press i to take a word into your inventory. Step into the tinted coding area and press p to lay words out in order — distance from the left wall sets the indent. Press i on a placed word to pick it back up. Then stand on Build and press Enter, then stand on Run.";

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "room-settings-reset";
    reset.textContent = "🧹 Reset Codex";
    reset.title = "Forget all discovered commands (fresh playthrough)";
    reset.onclick = () => { resetCodex(); };

    settingsCard.append(settingsLabel("Movement scheme"), schemeRow, settingsLabel("Keys"), list, settingsLabel("How to play"), help, reset);
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

    // Terminal font: presets + stepper + a LIVE sample line.
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

    settingsCard.append(
      settingsLabel("Room size"), sizeRow,
      settingsLabel("Terminal text size"), presetRow, stepRow, sample,
    );
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
    applyTermFont();
    renderSettings(); // refresh active preset highlight + live sample
  }

  function openSettings() {
    settingsView = "menu";        // always enter at the top menu
    settingsEl.hidden = false;
    renderSettings();
  }
  function closeSettings() {
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
    if (terminalEl.contains(document.activeElement)) {
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
  settingsEl.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); handleEscape(); } });

  // --- terminal overlay (MOUSE allowed: dock/pop, drag, resize — window management) ---
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

  // --- dialogue presenter (shared by both speakers — portrait only, slides in/out) ---
  const dialogueEl = document.createElement("div");
  dialogueEl.className = "room-dialogue";
  dialogueEl.hidden = true;
  const dlgPortrait = document.createElement("div");
  dlgPortrait.className = "room-dialogue-portrait";
  const dlgBox = document.createElement("div");
  dlgBox.className = "room-dialogue-box";
  const dlgName = document.createElement("div");
  dlgName.className = "room-dialogue-name";
  const dlgText = document.createElement("p");
  dlgText.className = "room-dialogue-text";
  const dlgCue = document.createElement("div");
  dlgCue.className = "room-dialogue-cue";
  dlgBox.append(dlgName, dlgText, dlgCue);
  dialogueEl.append(dlgPortrait, dlgBox);
  container.appendChild(dialogueEl);

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
    buildMarkers();
    buildPiles();
    drawPlaced();
    clampTerminal();                              // keep a popped window on-screen after resize
    if (terminal.mode === "popped") placePopped();
    applyViewport();
  }

  /**
   * CAMERA pass — sets the visible viewport (rows/cols) and the docked terminal band.
   * Called by relayout AND on dock/undock. Reads `tile` but NEVER changes it, so
   * docking only crops the camera; there is no tile "breathing" on toggle.
   */
  function applyViewport() {
    const top = stage.getBoundingClientRect().top;
    const docked = terminal.mode === "docked";
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

    if (docked) {
      // Band anchored to the WINDOW bottom, full width; the HUD sits a GAP above it.
      terminalEl.style.left = "0px";
      terminalEl.style.top = `${window.innerHeight - terminal.dockedH}px`;
      terminalEl.style.width = `${container.clientWidth}px`;
      terminalEl.style.height = `${terminal.dockedH}px`;
    }
    positionDialogue(); // keep the portrait anchored to the terminal across dock/resize
    draw();
  }

  /**
   * Anchor the dialogue portrait ABOVE the terminal by default; if the docked band is
   * flush near the TOP (no room above it), render INSIDE the band so it's never clipped.
   */
  function positionDialogue() {
    if (dialogueEl.hidden) return;
    const areaTop = stage.getBoundingClientRect().top; // room area top (below the top bar)
    const portH = dialogueEl.offsetHeight || 140;
    if (terminal.mode === "docked") {
      const bandTop = window.innerHeight - terminal.dockedH;
      const inside = bandTop - areaTop < portH + 16; // not enough room above → go inside the band
      dialogueEl.classList.toggle("inside-terminal", inside);
      dialogueEl.style.top = `${inside ? bandTop + 8 : bandTop - portH - 8}px`;
    } else {
      // Popped: the band isn't reserving the bottom, so float just above the HUD.
      dialogueEl.classList.remove("inside-terminal");
      dialogueEl.style.top = `${window.innerHeight - HUD_H - HUD_GAP - portH - 8}px`;
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

  /** Position the tinted coding-area zone (a single rectangle over those cells). */
  function drawCodingZone() {
    const a = room.codingArea;
    if (!a) { zoneEl.hidden = true; return; }
    zoneEl.hidden = false;
    zoneEl.style.width = `${a.width * tile}px`;
    zoneEl.style.height = `${a.height * tile}px`;
    zoneEl.style.transform = `translate(${a.x * tile}px, ${a.y * tile}px)`;
  }

  /** (Re)build the Build / Run objects: labeled tiles, distinct from piles/tokens. */
  function buildControlsLayer() {
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
      label.style.fontSize = `${Math.round(tile * 0.32)}px`;
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

  /** Placed tokens on a given row, left-to-right (the "line" for that row). */
  function lineOnRow(y: number): Placed[] {
    return placed.filter((p) => p.y === y).sort((a, b) => a.x - b.x);
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

  /** The single line under construction: the first occupied row's tokens + its indent. */
  function currentLine(): { content: string[]; indent: number } {
    const rows = [...new Set(placed.map((p) => p.y))].sort((a, b) => a - b);
    if (!rows.length) return { content: [], indent: 0 };
    const row = lineOnRow(rows[0]);
    return { content: row.map((p) => p.token), indent: indentOnRow(rows[0]) ?? 0 };
  }

  /** Placing/removing a token re-dirties the line (must Build again before Run). */
  function dirtyLine() {
    buildState = markDirty(buildState);
    drawDebug();
  }

  /** Echo flavor text into the EXISTING terminal (nothing executes). */
  function termSet(lines: string[], state: "neutral" | "success" | "error") {
    termBody.textContent = lines.join("\n");
    termBody.classList.toggle("term-success", state === "success");
    termBody.classList.toggle("term-error", state === "error");
  }

  function doBuild() {
    buildState = markBuilt(buildState);
    termSet([termCmds.build, "compiled main.py ✓ — ready to Run"], "neutral");
    drawDebug();
  }

  function doRun() {
    const line = currentLine();
    const res = runProgram(buildState, line.content, line.indent, answer);
    // Terminal = pretend shell transcript (flavor); the SNAKE portrait delivers the beat.
    if (res.ok) {
      termSet([termCmds.run, solution.output], "success");
    } else {
      termSet([termCmds.run, res.reason === "build-first" ? "error: nothing built" : "(no output)"], "error");
    }
    const b = snakeBeat(res.ok ? "success" : (res.reason as CheckReason));
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
    dialogueEl.hidden = false;
    showBeat();
  }

  function showBeat() {
    clearDialogueTimers();
    const beat = dialogueQueue[dialogueIdx];
    const sp = speakers[beat.speaker];
    const side = sp?.side === "right" ? "right" : "left";
    const frame1 = sp?.portrait ?? "💬";
    const frame2 = sp?.portrait2;
    dialogueEl.classList.toggle("from-right", side === "right");
    dialogueEl.classList.toggle("from-left", side !== "right");
    dlgPortrait.textContent = frame1;
    dlgPortrait.classList.add("talking");
    dlgName.textContent = sp?.name ?? beat.speaker;
    dlgText.textContent = beat.text;
    highlightMarker(beat.highlight === "hint"); // outline the "?" on the relevant enter beat

    positionDialogue();
    requestAnimationFrame(() => dialogueEl.classList.add("shown")); // slide in

    // Optional talking-mouth flicker between two frames (one frame is fine).
    if (frame2 && frame2 !== frame1) {
      let alt = false;
      talkTimer = window.setInterval(() => {
        alt = !alt;
        dlgPortrait.textContent = alt ? frame2 : frame1;
      }, 220);
    }

    // Advance mode: explicit autoAdvance wins; else short text auto-advances (length fallback).
    const auto = beat.autoAdvance === true || (beat.autoAdvance === undefined && beat.text.length < AUTO_LEN);
    dlgCue.textContent = auto ? "" : "Enter ▸";
    if (auto) autoTimer = window.setTimeout(advanceDialogue, AUTO_PAUSE);
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
    dlgPortrait.classList.remove("talking");
    dialogueEl.classList.remove("shown"); // slide out
    window.setTimeout(() => { if (dialogueIdx === -1) dialogueEl.hidden = true; }, 260);
    viewport.focus({ preventScroll: true });
  }

  /** Wrap a phase-4 run reason ("build-first"/…/"success") as a SNAKE portrait beat. */
  function snakeBeat(reason: string): DialogueBeat | null {
    const text = beats[reason];
    if (!text) return null;
    return { id: `run-${reason}`, speaker: "snake", text, trigger: reason };
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
    const label = document.createElement("span");
    label.className = "room-inventory-label";
    label.textContent = invDrop
      ? "Full! ← → pick a slot · Enter drop · Esc cancel"
      : `Inventory ${inventory.length}/${invSlots}`;
    invStrip.appendChild(label);
    for (let s = 0; s < invSlots; s++) {
      const slot = document.createElement("span");
      const filled = s < inventory.length;
      const selected = invFocused && s === invSel;
      slot.className = `room-inventory-slot${filled ? "" : " empty"}${selected ? " selected" : ""}`;
      slot.textContent = filled ? inventory[s] : "·";
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

  /** Place inventory[index] into an empty coding-area cell here (CONSUMED, one-use). */
  function placeToken(index: number) {
    if (index < 0 || index >= inventory.length) return; // empty slot → nothing to place
    if (!inCodingArea(room, pos.x, pos.y)) return;        // only inside the coding area
    if (placedAt(pos.x, pos.y) || pileAt(room, pos.x, pos.y) || controlAt(pos.x, pos.y)) return; // cell must be empty
    const [token] = inventory.splice(index, 1);
    placed.push({ token, x: pos.x, y: pos.y });
    invSel = clamp(invSel, 0, Math.max(0, inventory.length - 1));
    drawInventory();
    drawPlaced();
    dirtyLine(); // a freshly placed token → line is dirty until Built
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

  // ONE focus-aware input handler. Arrows mean slime-move OR slot-cursor depending on
  // `invFocused`; 'i'/'p' are context-decided; esc routes to the single esc ladder.
  viewport.addEventListener("keydown", (e) => {
    // Dialogue showing is a FOCUS STATE: advance on Enter/Space, skip on Esc, and
    // suppress all gameplay until it ends. Same handler — just another branch on state.
    if (isDialogueActive()) {
      e.preventDefault();
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") advanceDialogue();
      else if (e.key === "Escape") endDialogue();
      return;
    }

    if (e.key === "Escape") { e.preventDefault(); handleEscape(); return; }

    if (e.key === DEBUG_KEY) { e.preventDefault(); debugOn = !debugOn; drawDebug(); return; }

    if (e.key === PICKUP_KEY || e.key === PICKUP_KEY.toUpperCase()) { e.preventDefault(); pressI(); return; }

    if (e.key === PLACE_KEY || e.key === PLACE_KEY.toUpperCase()) { e.preventDefault(); pressPlace(); return; }

    if (e.key === "Enter") {
      e.preventDefault();
      if (invFocused && invDrop) { confirmDrop(); return; }   // drop-mode: confirm the drop
      if (!invFocused) {
        const c = controlAt(pos.x, pos.y);                     // stand on Build / Run → activate
        if (c) { activateControl(c); return; }
        if (onHintGiver(pos.x, pos.y)) talkToHint();           // stand on "?" → next hint beat
      }
      return;
    }

    const dir = keyToDirection(e.key);
    if (!dir) return;
    e.preventDefault(); // stop arrow-key page scroll
    if (invFocused) {
      // Arrows move the slot cursor (single row: any horizontal/vertical = ±1).
      if (dir.dx < 0 || dir.dy < 0) invSel = Math.max(0, invSel - 1);
      else invSel = Math.min(invSlots - 1, invSel + 1);
      drawInventory();
    } else {
      pos = step(room, pos, dir); // room focus: arrows move the slime
      draw();
    }
  });
  // Mouse may focus the room (room⇄terminal focus switch); it does nothing else in-room.
  viewport.addEventListener("pointerdown", () => viewport.focus({ preventScroll: true }));

  // Debounced resize: recompute the layout but coalesce bursts of resize events.
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, RESIZE_DEBOUNCE);
  };
  activeResizeHandler = onResize;
  window.addEventListener("resize", onResize);

  applyTerminalMode(); // terminal starts docked (bottom band)
  applyTermFont();     // apply the persisted terminal font size
  relayout();
  drawInventory();
  viewport.focus({ preventScroll: true });
  if (onEnterBeats.length) playSequence(onEnterBeats); // snake greeting slides in on enter
}
