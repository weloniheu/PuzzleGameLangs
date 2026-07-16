// ---------------------------------------------------------------------------
// Coding area (the coding MODULE's play objects): the tinted placement zone,
// token placement + indent, the Build/Run controls, the order-check flow
// (calls codeGameLogic — compare, never execute), the debug readout, and the
// vim editing ops (dd/dw). Extracted from roomRenderer; behavior unchanged.
//
// Everything specific stays CONTENT (the answer, beats text, terminal flavor)
// — injected in. The pure run→feedback routing is exported for tests.
// ---------------------------------------------------------------------------

import type { DialogueBeat, RoomControl } from "../../schema/types";
import { pileAt, type Cell } from "../../engine/core/room";
import type { EngineContext } from "../../engine/puzzleModule";
import {
  runAny as runProgram,
  createBuildState,
  markBuilt,
  markDirty,
  tokensOnRow,
  evaluatedLines,
  type AnswerLine,
  type CheckResult,
} from "./codeGameLogic";
import type { TermState } from "./terminal";

/** A token placed into the coding area at a cell. */
export interface Placed { token: string; x: number; y: number; }

// --- PURE run→feedback routing (testable): terminal echo + beat selection ----
export interface RunFeedback {
  term: { lines: string[]; state: TermState };
  /** A first-time teaching trigger to TRY before the reason beat (failures only). */
  firstTrigger: "first_run_no_build" | "first_wrong_order" | null;
  /** The beat key to play ("success" or the failure reason). */
  beatReason: string;
}

/** Route a Run result: the terminal transcript (flavor) + which beat should speak.
 *  A first-time teaching beat (run-before-build, or the first wrong order) takes
 *  precedence the FIRST time it happens; afterwards the normal reason beat plays. */
export function runFeedback(
  res: CheckResult,
  termCmds: { run: string },
  output: string,
): RunFeedback {
  if (res.ok) {
    return { term: { lines: [termCmds.run, output], state: "success" }, firstTrigger: null, beatReason: "success" };
  }
  const err =
    res.reason === "build-first" ? "error: nothing built" :
    res.reason === "extra-code" ? "error: unexpected extra code" : "(no output)";
  const firstTrigger =
    res.reason === "build-first" ? "first_run_no_build" :
    res.reason === "wrong-order" ? "first_wrong_order" : null;
  return { term: { lines: [termCmds.run, err], state: "error" }, firstTrigger, beatReason: res.reason };
}

// --- the coding area itself ---------------------------------------------------

export interface CodingAreaDeps {
  ctx: EngineContext;
  /** The accepted programs (order-checked; the placed program passes if it matches ANY —
   *  base tier may list several). `solution.lines` is sugar for one variant. CONTENT (Rule 2). */
  accepted: AnswerLine[][];
  /** The output echoed on success (CONTENT). */
  output: string;
  /** Punctuation tier: the order-checker keeps + requires punctuation tokens (see
   *  codeGameLogic.requiresPunctuation). Derived from the puzzle's mechanics. */
  requirePunctuation: boolean;
  /** Pretend shell command flavor (CONTENT). */
  termCmds: { build: string; run: string };
  /** Echo into the terminal; a room without one echoes nowhere (no-op). */
  termWrite(lines: string[], state: TermState): void;
  /** Wrap a beats-map entry as a snake portrait beat, or null when undefined (CONTENT). */
  snakeBeat(reason: string): DialogueBeat | null;
}

export interface CodingArea {
  /** Interact on a Build/Run control → activate. False when not on a control. */
  onInteract(cell: Cell): boolean;
  /** place / pickup(placed token) / debug / clearLine / deleteToken. */
  onAction(actionId: string): boolean;
  /** Rebuild the zone/controls/placed layers at the current tile size. */
  relayout(): void;
  /** Refresh the position-dependent debug readout (after each player draw). */
  drawDebug(): void;
}

export function createCodingArea(deps: CodingAreaDeps): CodingArea {
  const { ctx, accepted, termCmds } = deps;
  const room = ctx.room;
  const hasCodingArea = ctx.features.has("coding_area");
  const dialogue = ctx.dialogue;

  const placed: Placed[] = [];
  let debugOn = false;
  let buildState = createBuildState(); // line is "dirty" until Built (see codeGameLogic)

  const placedAt = (x: number, y: number) => placed.find((p) => p.x === x && p.y === y) ?? null;
  // Build / Run objects belong to the coding_area feature — without it, none exist.
  const controls: RoomControl[] = hasCodingArea ? (ctx.layout.controls ?? []) : [];
  const controlAt = (x: number, y: number) => controls.find((c) => c.pos.x === x && c.pos.y === y) ?? null;

  // Coding-area visuals (zone tint + Build/Run layer) exist ONLY when the feature is on.
  let zoneEl: HTMLDivElement | null = null;
  let controlLayer: HTMLDivElement | null = null;
  if (hasCodingArea) {
    zoneEl = document.createElement("div"); // tinted/outlined coding-area zone
    zoneEl.className = "room-coding-zone";
    zoneEl.hidden = !room.codingArea;
    controlLayer = document.createElement("div"); // Build / Run objects
    controlLayer.className = "room-control-layer";
    ctx.addLayer(zoneEl, "under");
    ctx.addLayer(controlLayer, "under");
  }
  const placedLayer = document.createElement("div");
  placedLayer.className = "room-placed-layer";
  ctx.addLayer(placedLayer, "over");

  // --- debug readout (toggle with `) : the placed line on the player's row + indent ---
  const debugEl = document.createElement("div");
  debugEl.className = "room-debug";
  debugEl.hidden = true;
  ctx.container.appendChild(debugEl);

  /** Position the tinted coding-area zone (a single rectangle over those cells). No-op
   *  when the coding_area feature is off (the element was never created). */
  function drawCodingZone() {
    if (!zoneEl) return;
    const a = room.codingArea;
    if (!a) { zoneEl.hidden = true; return; }
    const tile = ctx.tile();
    zoneEl.hidden = false;
    zoneEl.style.width = `${a.width * tile}px`;
    zoneEl.style.height = `${a.height * tile}px`;
    zoneEl.style.transform = `translate(${a.x * tile}px, ${a.y * tile}px)`;
  }

  /** (Re)build the Build / Run objects: labeled tiles, distinct from piles/tokens. No-op
   *  when the coding_area feature is off (no layer, no controls). */
  function buildControlsLayer() {
    if (!controlLayer) return;
    const tile = ctx.tile();
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
    const tile = ctx.tile();
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
    const pos = ctx.pos();
    const line = lineOnRow(pos.y).map((p) => p.token);
    const indent = indentOnRow(pos.y);
    const status = buildState.built ? "built" : "dirty";
    debugEl.textContent = `row ${pos.y}: [${line.join(", ")}]  indent=${indent ?? "—"}  ·  ${status}  ·  tile=${ctx.tile()}px`;
  }

  // -------------------------------------------------------------------------
  // Build / Run — order-check against the pack answer (NO execution; see codeGameLogic)
  // -------------------------------------------------------------------------

  /** The program Build/Run evaluates: EVERY occupied row inside the coding area (placement
   *  is free, but tokens outside the zone are silently ignored). */
  function currentProgram() {
    return evaluatedLines(placed, room.codingArea);
  }

  /** Placing/removing a token re-dirties the line (must Build again before Run). */
  function dirtyLine() {
    buildState = markDirty(buildState);
    drawDebug();
  }

  function doBuild() {
    buildState = markBuilt(buildState);
    deps.termWrite([termCmds.build, "compiled main.py ✓ — ready to Run"], "neutral");
    drawDebug();
    // GUIDED TUTORIAL first (advance past the waiting step), THEN any first-time beat —
    // the reverse order would leave a satisfied step waiting forever behind the beat.
    dialogue.notify("build");
    dialogue.fireFirstTime("first_build"); // Build always succeeds → first Build is the first successful one
  }

  function doRun() {
    dialogue.notify("run"); // GUIDED TUTORIAL: satisfies a step waiting on "run" (any attempt)
    const res = runProgram(buildState, currentProgram(), accepted, deps.requirePunctuation);
    // Terminal = pretend shell transcript (flavor); the SNAKE portrait delivers the beat.
    const fb = runFeedback(res, termCmds, deps.output);
    deps.termWrite(fb.term.lines, fb.term.state);
    if (res.ok) {
      ctx.onSolved(); // may earn an unlock (e.g. open the next door in the hub)
      const b = deps.snakeBeat("success");
      if (b) dialogue.play([b]);
      return;
    }
    // A first-time teaching beat takes precedence the FIRST time; then the reason beat.
    if (fb.firstTrigger && dialogue.fireFirstTime(fb.firstTrigger)) return;
    const b = deps.snakeBeat(fb.beatReason);
    if (b) dialogue.play([b]);
  }

  function activateControl(c: RoomControl) {
    if (c.action === "build") doBuild();
    else doRun();
  }

  /** Pick a placed token back into inventory; if full, the drop/cancel flow (the
   *  token is lifted off the board and restored on cancel). */
  function tryPickPlaced(p: Placed) {
    const inv = ctx.inventory;
    if (!inv) return; // a coding room always declares "inventory"; nowhere to put it otherwise
    if (inv.isFull()) {
      placed.splice(placed.indexOf(p), 1); // lift it off; restored on cancel, kept on drop
      inv.pickupToken(p.token, () => {
        placed.push(p); // un-lift
        drawPlaced();
        buildState = markDirty(buildState);
      });
      drawPlaced();
      dirtyLine(); // the line changed → must Build again
      return;
    }
    inv.pickupToken(p.token, null);
    placed.splice(placed.indexOf(p), 1);
    drawPlaced();
    dirtyLine();
  }

  /** Place inventory[index] onto ANY empty cell here (CONSUMED, one-use). Placement is
   *  free anywhere in the room; only the coding-area region is read by Build/Run. */
  function placeToken(index: number) {
    const inv = ctx.inventory;
    if (!inv || inv.itemAt(index) === undefined) return; // empty slot → nothing to place
    const pos = ctx.pos();
    if (placedAt(pos.x, pos.y) || pileAt(room, pos.x, pos.y) || controlAt(pos.x, pos.y)) return; // empty, non-pile cell
    const token = inv.removeAt(index)!;
    placed.push({ token, x: pos.x, y: pos.y });
    drawPlaced();
    dirtyLine(); // a freshly placed token → line is dirty until Built
    dialogue.notify("place"); // GUIDED TUTORIAL first (see doBuild), then first-time beats
    dialogue.fireFirstTime("first_place");
  }

  /** 'p': inventory focus → place SELECTED slot; room focus → place FIFO (front). */
  function pressPlace() {
    placeToken(ctx.inventory?.focused() ? ctx.inventory.selected() : 0);
  }

  function vimClearLine() {            // dd — clear the player's CURRENT row only (any column,
    const row = tokensOnRow(placed, ctx.pos().y); //  in or out of the coding area); other rows stay.
    if (!row.length) return;
    for (const p of row) placed.splice(placed.indexOf(p), 1);
    drawPlaced();
    dirtyLine();
  }
  function vimDeleteToken() {          // dw — delete the placed token under the player (current line)
    const pos = ctx.pos();
    const p = placedAt(pos.x, pos.y);
    if (!p) return;
    placed.splice(placed.indexOf(p), 1);
    drawPlaced();
    dirtyLine();
  }

  return {
    onInteract(cell) {
      const c = controlAt(cell.x, cell.y); // stand on Build / Run → activate
      if (!c) return false;
      // GUIDED TUTORIAL: satisfies a step waiting on "interact" BEFORE the control acts
      // (so a following step waiting on "build"/"run" can advance in the same press).
      dialogue.notify("interact");
      activateControl(c);
      return true;
    },
    onAction(actionId) {
      if (actionId === "place") { pressPlace(); return true; }
      if (actionId === "pickup") {
        const pos = ctx.pos();
        const p = placedAt(pos.x, pos.y);
        if (!p) return false; // not on a placed token — the engine tries piles next
        tryPickPlaced(p);
        return true;
      }
      if (actionId === "debug") { debugOn = !debugOn; drawDebug(); return true; }
      if (actionId === "clearLine") { vimClearLine(); return true; }
      if (actionId === "deleteToken") { vimDeleteToken(); return true; }
      return false;
    },
    relayout() {
      drawCodingZone();
      buildControlsLayer();
      drawPlaced();
    },
    drawDebug,
  };
}
