// ---------------------------------------------------------------------------
// Settings panel (shared engine system). Extracted VERBATIM from roomRenderer — same
// tab structure, same capture timing, same conflict-block behavior, same Display controls.
//
// Owns: the gear button, the overlay (menu / Controls / Display tabs), the rebind capture
// machine, terminal-font control, and the session-persistent `roomSettings`.
//
// Boundaries (injected, not entangled): `relayout`, `applyTermFont`, `resetCodex`, and
// the focus/esc hooks (`onBeforeOpen` = drop room focus, `onClose` = refocus room,
// `onEscape` = the esc ladder). The panel never reaches into roomRenderer internals.
// ---------------------------------------------------------------------------

import {
  defaultBindings, actionsFor, normalizeKey, rebind, bindingGlyph, resolve,
  type SchemeId, type Bindings, type Key,
} from "../core/keybindings";
import { renderAchievements, type AchievementGroup } from "../core/achievements";
import type { RoomSize } from "./camera";

const SCHEME_LABELS: Record<SchemeId, string> = { standard: "Standard", vim: "Vim" };
const SCHEME_TABS: SchemeId[] = ["standard", "vim"];
const TERM_FONT_MIN = 10;    // terminal font-size bounds (settings)
const TERM_FONT_MAX = 28;
const TERM_FONT_STEP = 2;
export const CAPTURE_WINDOW = 320; // ms an in-progress capture waits before committing
export const CAPTURE_MAX = 2;      // longest sequence the rebinder captures (covers dd/dw)
const SCROLL_STEP = 48;            // px one up/down press scrolls a read-only list

// Session-persistent room preferences (survive puzzle switches within a session): the
// active scheme + editable bindings for BOTH schemes, room size, terminal font.
export const roomSettings = {
  roomSize: "fill" as RoomSize,
  termFontPx: 14,
  scheme: "standard" as SchemeId,
  bindings: { standard: defaultBindings("standard"), vim: defaultBindings("vim") } as Record<SchemeId, Bindings>,
  /** When ON, SOLVING a level immediately opens its destination chooser (skip
   *  walking back to the portal). Off by default; toggle in Display. Entry never
   *  auto-opens the menu — this is a solve-time convenience only. */
  autoMenuOnSolve: false,
};

// --- rebind CAPTURE machine: buffer + commit timing (PURE of DOM; testable) ----------
// A single key commits after the inter-key WINDOW; a sequence commits as soon as it hits
// MAX length; cancel() drops the buffer with no commit. The caller supplies onCommit,
// which applies the buffer via keybindings.rebind (already tested).
export interface CaptureMachine {
  start(): void;
  key(k: string): void;
  cancel(): void;
  active(): boolean;
}
export function createCaptureMachine(opts: {
  max: number;
  window: number;
  onCommit: (buffer: Key[]) => void;
}): CaptureMachine {
  let buf: Key[] | null = null; // null = inactive
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearT = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  function commit() {
    if (buf === null) return;
    const b = buf;
    clearT();
    buf = null;
    opts.onCommit(b);
  }
  return {
    active: () => buf !== null,
    start() { clearT(); buf = []; },
    key(k) {
      if (buf === null) return;
      buf.push(normalizeKey(k));
      clearT();
      if (buf.length >= opts.max) { commit(); return; } // sequence reached max → commit now
      timer = setTimeout(commit, opts.window);          // else wait the inter-key window
    },
    cancel() { clearT(); buf = null; },
  };
}

// --- keyboard NAVIGATION cursor (PURE of DOM; testable) ----------------------
// The panel is a grid of rows: most rows hold one control, but an option strip
// (scheme tabs, room size, font presets, a binding's chips) holds several side by
// side. Up/down always change row. Left/right step WITHIN a multi-control row and
// clamp at its ends; on a single-control row they fall through to up/down, so the
// four movement keys alone reach everything.
export interface Cursor { row: number; col: number }
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** @param widths how many controls each row holds, top to bottom. */
export function moveCursor(widths: number[], cur: Cursor, action: string): Cursor {
  if (!widths.length) return { row: 0, col: 0 };
  const row = clampN(cur.row, 0, widths.length - 1);
  const col = clampN(cur.col, 0, widths[row] - 1);
  const toRow = (delta: number) => ({ row: clampN(row + delta, 0, widths.length - 1), col: 0 });
  switch (action) {
    case "up": return toRow(-1);
    case "down": return toRow(1);
    case "left": return widths[row] > 1 ? { row, col: clampN(col - 1, 0, widths[row] - 1) } : toRow(-1);
    case "right": return widths[row] > 1 ? { row, col: clampN(col + 1, 0, widths[row] - 1) } : toRow(1);
    default: return { row, col };
  }
}

// --- the panel -------------------------------------------------------------
export interface SettingsPanelDeps {
  container: HTMLElement;
  hasTerminal: boolean;
  relayout: () => void;       // Display "Room size" change re-tiles
  applyTermFont: () => void;  // push the terminal font size onto the terminal
  resetCodex: () => void;     // "Reset all progress"
  /** The ACHIEVEMENTS tracker's rows, recomputed on every open (a key earned this
   *  session shows immediately). Omitted ⇒ the Achievements entry isn't offered. */
  achievements?: () => AchievementGroup[];
  onBeforeOpen: () => void;   // drop inventory/terminal focus before opening
  onClose: () => void;        // return focus to the room on close
  onEscape: () => void;       // the esc ladder (handles esc while the panel is open)
}

export interface SettingsPanel {
  gearButton: HTMLButtonElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  escBack(): void;        // sub-tab → menu → close (the esc-within-settings step)
  cancelCapture(): void;  // drop any in-flight rebind capture (clears its pending timer) — for teardown
}

export function createSettingsPanel(deps: SettingsPanelDeps): SettingsPanel {
  const settingsEl = document.createElement("div");
  settingsEl.className = "room-settings-panel";
  settingsEl.tabIndex = -1;
  settingsEl.hidden = true;
  const settingsCard = document.createElement("div");
  settingsCard.className = "room-settings-card";
  settingsEl.appendChild(settingsCard);
  deps.container.appendChild(settingsEl);

  let view: "menu" | "controls" | "display" | "achievements" = "menu";
  let captureTarget: { action: string; slot: number } | null = null;
  let captureMsg = "";
  const machine = createCaptureMachine({ max: CAPTURE_MAX, window: CAPTURE_WINDOW, onCommit: onCaptureCommit });

  // -- builders (sub-tabs are rebuilt on navigation) -----------------------
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
      back.onclick = () => setView("menu");
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
      // Offered only when the host supplies progression data (the tracker has nothing
      // to read otherwise) — same shape as the other feature-gated surfaces.
      ...(deps.achievements ? [["Achievements", () => setView("achievements")] as [string, () => void]] : []),
      ["Controls", () => setView("controls")],
      ["Display", () => setView("display")],
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
    close.onclick = () => closePanel();
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
      b.onclick = () => { roomSettings.scheme = s; cancelCapture(); render(); };
      tabs.appendChild(b);
    }
    settingsCard.append(settingsLabel("Scheme — ←→ to pick, ⏎ to make it active"), tabs);

    if (roomSettings.scheme === "standard") {
      const note = document.createElement("p");
      note.className = "room-settings-help-text";
      note.textContent = "Standard: arrows AND WASD both move you. Select a binding to remap it.";
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
        const capturing = captureTarget && captureTarget.action === def.id && captureTarget.slot === slot;
        chip.className = `room-bind-chip${capturing ? " capturing" : ""}`;
        chip.textContent = capturing ? "press a key…" : bindingGlyph(b);
        chip.onclick = () => startCapture(def.id, slot);
        chips.appendChild(chip);
      });
      row.append(name, chips);
      list.appendChild(row);
    }
    settingsCard.append(settingsLabel("Keys — ⏎ on a key to remap it · Esc cancels"), list);

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
      if (ok) deps.resetCodex();
    };
    settingsCard.appendChild(reset);
    // (No "Replay tutorials" button: tutorials replay on every room entry by themselves,
    //  so a control promising to make them replay would have nothing to do.)
  }

  /** The ACHIEVEMENTS tab — the same tracker the title screen shows, rendered by the
   *  shared renderer so the two surfaces can never drift apart. Read-only. */
  function buildAchievementsView() {
    settingsCard.appendChild(settingsHead("Achievements", true));
    const box = document.createElement("div");
    box.className = "room-settings-achievements";
    renderAchievements(box, deps.achievements?.() ?? []);
    settingsCard.appendChild(box);
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
      b.onclick = () => { roomSettings.roomSize = val; render(); deps.relayout(); };
      sizeRow.appendChild(b);
    }
    settingsCard.append(settingsLabel("Room size"), sizeRow);

    // Auto-open the level chooser the moment a puzzle is solved (opt-in).
    const autoRow = document.createElement("div");
    autoRow.className = "room-settings-schemes";
    for (const [val, text] of [[true, "On"], [false, "Off"]] as [boolean, string][]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-scheme-btn${roomSettings.autoMenuOnSolve === val ? " active" : ""}`;
      b.textContent = text;
      b.onclick = () => { roomSettings.autoMenuOnSolve = val; render(); };
      autoRow.appendChild(b);
    }
    settingsCard.append(settingsLabel("Open menu on solve"), autoRow);

    // Terminal text size — only when this room HAS a terminal (else there's nothing to size).
    if (!deps.hasTerminal) return;
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

  // --- keyboard navigation (Rule 4: the panel is driven by the MOVEMENT keys) ---
  // Rows are read back off the DOM after each render rather than declared by each
  // builder, so a new control is navigable the moment it's appended. Consecutive
  // buttons inside one option strip form a single left/right row.
  const STRIP = ".room-settings-schemes, .room-settings-font, .room-bind-chips";
  let navRows: HTMLButtonElement[][] = [];
  let cursor: Cursor = { row: 0, col: 0 };

  function collectNav() {
    navRows = [];
    let lastStrip: Element | null = null;
    for (const b of settingsCard.querySelectorAll<HTMLButtonElement>("button")) {
      if (b.disabled) continue; // a "coming soon" stub is not a destination
      const strip = b.closest(STRIP);
      if (strip && strip === lastStrip) navRows[navRows.length - 1].push(b);
      else navRows.push([b]);
      lastStrip = strip;
    }
  }
  /** Paint the cursor (clamping it into whatever the latest render produced). */
  function paintNav() {
    for (const row of navRows) for (const b of row) b.classList.remove("nav-cursor");
    if (!navRows.length) return;
    cursor = moveCursor(navRows.map((r) => r.length), cursor, "none");
    navRows[cursor.row][cursor.col].classList.add("nav-cursor");
  }
  function navMove(action: string) {
    // A read-only screen (Achievements) has one control — ← Back — and a long list
    // behind it, so up/down SCROLL it rather than fighting over a single row. Without
    // this the keyboard could never reach the bottom of the tracker.
    const scroller = settingsCard.querySelector<HTMLElement>(".room-settings-achievements");
    if (scroller && (action === "up" || action === "down")) {
      scroller.scrollTop += action === "down" ? SCROLL_STEP : -SCROLL_STEP;
      return;
    }
    cursor = moveCursor(navRows.map((r) => r.length), cursor, action);
    paintNav();
  }
  function navActivate() {
    navRows[cursor.row]?.[cursor.col]?.click();
  }
  /** Switch screens with the cursor back at the top (a new screen is a new list). */
  function setView(next: typeof view) {
    view = next;
    cursor = { row: 0, col: 0 };
    render();
  }

  /** Render the current settings screen; keep focus on the panel so Esc lands here. */
  function render() {
    settingsCard.innerHTML = "";
    if (view === "controls") buildControls();
    else if (view === "display") buildDisplay();
    else if (view === "achievements") buildAchievementsView();
    else buildMenu();
    const hint = document.createElement("p");
    hint.className = "room-settings-nav-hint";
    hint.textContent = "↑↓ move · ←→ adjust · ⏎ select · Esc back";
    settingsCard.appendChild(hint);
    collectNav();
    paintNav();
    settingsEl.focus({ preventScroll: true });
  }

  function setTermFont(px: number) {
    roomSettings.termFontPx = Math.max(TERM_FONT_MIN, Math.min(TERM_FONT_MAX, px));
    deps.applyTermFont();
    render(); // refresh active preset highlight + live sample
  }

  // --- keybinding capture (manual rebind) ---
  function cancelCapture() {
    machine.cancel();
    captureTarget = null;
  }
  function startCapture(action: string, slot: number) {
    cancelCapture();
    captureTarget = { action, slot };
    captureMsg = "";
    machine.start();
    render(); // chip shows "press a key…"
  }
  /** Apply the buffered keys for the active target via rebind. Called by the machine on
   *  commit (window elapsed or max length reached). */
  function onCaptureCommit(buffer: Key[]) {
    const target = captureTarget;
    captureTarget = null;
    if (!target || !buffer.length) { render(); return; }
    const res = rebind(roomSettings.bindings[roomSettings.scheme], target.action, target.slot, buffer);
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
    render();
  }
  /** Keystrokes while a chip is in rebind mode (single commits after a short window; a
   *  sequence commits at max length; Esc cancels). */
  function handleCaptureKey(e: KeyboardEvent) {
    if (e.key === "Escape") { cancelCapture(); captureMsg = "Rebind cancelled."; render(); return; }
    machine.key(e.key);
  }

  function openPanel() {
    deps.onBeforeOpen();          // drop inventory/terminal focus first
    cancelCapture();
    captureMsg = "";
    settingsEl.hidden = false;
    setView("menu");             // always enter at the top menu, cursor on its first row
  }
  function closePanel() {
    cancelCapture();
    settingsEl.hidden = true;
    deps.onClose();
  }
  function isOpen() {
    return !settingsEl.hidden;
  }
  /** Esc while the panel is open: back out one level (sub-tab → menu → closed). */
  function escBack() {
    if (view !== "menu") { setView("menu"); }
    else closePanel();
  }

  // --- gear button (top corner) ---
  const gearButton = document.createElement("button");
  gearButton.type = "button";
  gearButton.className = "room-gear";
  gearButton.textContent = "⚙";
  gearButton.title = "Settings & controls";
  gearButton.setAttribute("aria-label", "Settings and controls");
  // Mouse-open: open() drops room focus first — so esc from open settings unambiguously
  // means "back out", never also "unfocus".
  gearButton.onclick = () => { if (isOpen()) closePanel(); else openPanel(); };

  // --- listeners ---
  settingsEl.addEventListener("pointerdown", (e) => { if (e.target === settingsEl) closePanel(); });
  settingsEl.addEventListener("keydown", (e) => {
    if (captureTarget) { e.preventDefault(); e.stopPropagation(); handleCaptureKey(e); return; } // rebind grabs all keys
    if (e.key === "Escape") { e.preventDefault(); deps.onEscape(); return; }
    // Everything else is NAVIGATION, resolved against the player's ACTIVE scheme —
    // arrows/WASD in standard, hjkl in vim, or whatever they rebound movement to.
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault(); e.stopPropagation(); navActivate(); return;
    }
    const r = resolve(roomSettings.bindings[roomSettings.scheme], [normalizeKey(e.key)]);
    if (r.kind !== "fire") return;
    if (r.action === "interact") { e.preventDefault(); e.stopPropagation(); navActivate(); return; }
    if (["up", "down", "left", "right"].includes(r.action)) {
      e.preventDefault(); e.stopPropagation(); navMove(r.action);
    }
  });

  return { gearButton, open: openPanel, close: closePanel, isOpen, escBack, cancelCapture };
}
