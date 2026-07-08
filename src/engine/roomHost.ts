// ---------------------------------------------------------------------------
// Room host — the SHELL. Builds the world (tiles, player, piles), wires the
// shared systems (camera, inventory HUD, dialogue, settings, portals, focus,
// input dispatch), then mounts the puzzle-type MODULE looked up by registry
// (puzzles/index.ts). The host never names a type (CLAUDE.md Rule 1); modules
// see only the EngineContext services (engine/puzzleModule.ts).
//
// SIZING: the tile size is computed from the window so the room uses the whole
// available space (see systems/camera). `tile` is the single source of truth
// for cell pixels — module layers read it live so everything stays in sync.
//
// Styling is scoped to .room-* classes. Mouse is used ONLY for the settings
// button, panel dragging, and to focus the room for keyboard (Rule 4).
// ---------------------------------------------------------------------------

import type { DialogueBeat, DialogueConfig, DialogueSpeaker, Puzzle } from "../schema/types";
import { parseRoom, step, pileAt, MOVE, type Cell, type Direction } from "./core/room";
import {
  resetCodex, resetTutorials, getUnlocks, hasCompletedTutorial, completeTutorial,
} from "./core/codex";
import { createTeardown } from "./core/teardown";
import { resolveFeatures, resolveInventorySlots } from "./core/roomFeatures";
import type { DestinationOption } from "./core/progression";
import { renderTileLayer } from "./systems/tileLayer";
import { computeTile, computeViewport } from "./systems/camera";
import { createSlime, drawPlayer } from "./systems/player";
import { createDialogue } from "./systems/dialogue";
import { createSettingsPanel, roomSettings } from "./systems/settingsPanel";
import { createInventoryHud } from "./systems/inventoryHud";
import { createPortals } from "./systems/portals";
import { resolveEscape } from "./systems/focus";
import { createInputDispatch } from "./systems/inputDispatch";
import type { EngineContext, MountedPuzzle } from "./puzzleModule";
import { moduleFor } from "../puzzles";

const FIXED_TILE = 40;       // comfortable tile px used when the room is larger than the window
const HUD_H = 48;            // inventory HUD height (px)
const HUD_GAP = 10;          // consistent gap between the HUD and its lower neighbour
                             // (the docked panel's top edge, or the window's bottom edge).
const SIDE_RESERVE = 8;      // px breathing room so the room never butts against the window edge
const RESIZE_DEBOUNCE = 120; // ms

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
}
/** Handle to a mounted room. `teardown()` destroys EVERYTHING the room created. */
export interface RoomHandle {
  teardown: () => void;
}

// Only one room is mounted at a time. Track the WHOLE teardown at module scope so a
// direct re-render (or a missed manager teardown) tears the old room down completely
// instead of leaking its listeners/timers into the next one.
let activeRoomTeardown: (() => void) | null = null;

export function mountRoom(
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
  // inventory HUD) are not features.
  const features = resolveFeatures(layout);
  const hasTerminal = features.has("terminal");

  // Dialogue CONTENT (engine hardcodes none): speakers, greeting, hint giver lines.
  // Read structurally off the payload — any room puzzle type may declare `dialogue`.
  const dialogueCfg = (puzzle.payload as { dialogue?: DialogueConfig }).dialogue;
  const speakers: Record<string, DialogueSpeaker> = dialogueCfg?.speakers ?? {};
  const onEnterBeats: DialogueBeat[] = dialogueCfg?.on_enter ?? [];
  const hintLines = dialogueCfg?.hints ?? [];
  // GUIDED TUTORIAL (content, cut-and-dry): plays ONCE ever, appended after the on_enter
  // beats, the first time this room's id is visited (see codex.ts tutorial tracking).
  const guidedTutorialBeats: DialogueBeat[] = dialogueCfg?.guided_tutorial ?? [];

  const room = parseRoom(layout);
  let pos: Cell = { ...room.spawn };

  // View sizing — recomputed by relayout(); everything pixel-based reads these.
  let tile = FIXED_TILE;
  let viewCols = room.width;
  let viewRows = room.height;
  // The room's FULL available pixels (window minus top bar + HUD). `tile` is sized
  // from these and is independent of any docked panel, so dock/undock never resizes it.
  let fullW = 0;
  let fullH = 0;

  const hintGiver = layout.hint_giver ?? null; // the ONLY in-room dialogue marker
  // Doors: stand-on-and-interact objects. Their reaction is resolved against the
  // player's earned unlocks, read ONCE at mount (fresh each time the room loads).
  const doors = layout.doors ?? [];
  const unlocks = new Set(getUnlocks());

  const invSlots = resolveInventorySlots(layout.inventory_slots, puzzle.puzzle_type);

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

  // Sub-layers, so a resize can rebuild the tile/pile/module layers at the new tile
  // size without disturbing the persistent slime element (and its focus/transition).
  const tileLayer = document.createElement("div");
  tileLayer.className = "room-tile-layer";
  const markerLayer = document.createElement("div"); // hint giver's "?" marker
  markerLayer.className = "room-marker-layer";
  const pileLayer = document.createElement("div");
  pileLayer.className = "room-pile-layer";
  const slime = createSlime();

  viewport.appendChild(world);
  stage.appendChild(viewport);
  container.appendChild(stage);

  const focusRoom = () => viewport.focus({ preventScroll: true });

  // --- inventory + HUD (FEATURE-GATED system): FIFO slots, drop/cancel flow, the
  //     always-visible strip. Rooms that carry tokens declare "inventory"; a room
  //     without it builds no HUD and no inventory interactions at all. ---
  const inv = features.has("inventory") ? createInventoryHud(container, invSlots) : null;

  /** Clear inventory/terminal focus back to the plain room (used on settings-open). */
  function dropFocusToRoom() {
    if (inv?.focused()) exitInventory();
    focusRoom(); // pulls focus off any panel control too
  }

  /** Leave inventory focus → room focus. Cancels a pending drop (restoring any lifted token). */
  function exitInventory() {
    inv?.exitFocus();
  }

  // --- settings panel (system): gear + Controls/Display tabs + rebind capture. Focus/esc
  //     and the relayout/panel-font/reset callbacks are INJECTED (not entangled). ---
  const settings = createSettingsPanel({
    container,
    hasTerminal,
    relayout: () => relayout(),
    applyTermFont: () => mounted?.panel?.applyFont?.(),
    resetCodex,
    resetTutorials,
    onBeforeOpen: () => dropFocusToRoom(), // clear inventory/panel focus before opening
    onClose: focusRoom,
    onEscape: () => handleEscape(),        // route esc through the room's esc ladder
  });
  topbar.append(settings.gearButton);

  // --- dialogue presenter (system) -------------------------------------------
  // Owns the portrait + narrator surfaces, the beat queue, the hint-giver marker, and the
  // first-time-once MECHANISM. Dock state + stage-top are INJECTED getters; the content
  // lookup for first-time triggers is the MODULE's (late-bound via `mounted`).
  const dialogue = createDialogue({
    container,
    markerLayer,
    speakers,
    hintGiver,
    hintLines,
    hasPortrait: hasTerminal,
    isTerminalDocked: () => mounted?.panel?.isDocked() ?? false,
    dockedH: () => mounted?.panel?.dockedH() ?? 0,
    stageTop: () => stage.getBoundingClientRect().top,
    hudH: HUD_H,
    hudGap: HUD_GAP,
    onEnd: focusRoom,
    firstTimeBeat: (trigger) => mounted?.firstTimeBeat?.(trigger) ?? null,
  });

  // --- portals & transitions (system): doors, menu portal, chooser, flash ----
  const portals = createPortals({
    container,
    room,
    doors,
    unlocks,
    puzzleType: puzzle.puzzle_type,
    hasMenuPortal: !!callbacks.menuDestinations,
    tile: () => tile,
    pos: () => pos,
    dialogue,
    removePlayer: () => slime.remove(), // remove the slime before the map changes
    focusRoom,
    menuDestinations: callbacks.menuDestinations,
    flashColorFor: callbacks.flashColorFor,
    onTransition: (target) => callbacks.onDoor?.(target), // manager tears THIS room down + mounts target
  });

  // Order matters for stacking; module layers slot in around these (see addLayer).
  world.append(tileLayer, portals.doorLayer);
  if (portals.menuPortalEl) world.append(portals.menuPortalEl); // below the slime, which spawns on top of it
  world.append(markerLayer, pileLayer, slime);

  // --- the puzzle-type MODULE: looked up by registry, mounted with engine services ---
  let mounted: MountedPuzzle | null = null;
  const ctx: EngineContext = {
    container,
    room,
    layout,
    features,
    tile: () => tile,
    fullH: () => fullH,
    pos: () => pos,
    addLayer: (el, slot) => {
      // "under" sits above the tiles, below doors; "over" sits above piles, below the player.
      if (slot === "under") world.insertBefore(el, portals.doorLayer);
      else world.insertBefore(el, slime);
    },
    reflow: () => applyViewport(),
    focusRoom,
    movePlayer: (cell) => { pos = { ...cell }; draw(); },
    dialogue,
    inventory: inv,
    onSolved: () => callbacks.onSolved?.(puzzle),
    teardown,
  };
  const module = moduleFor(puzzle.puzzle_type);
  mounted = module ? module.mount(ctx, puzzle) : null;

  /**
   * The ONE esc decision — the pure ladder lives in systems/focus; this is the wiring.
   * There is NO separate esc listener: the focus-routed keydown handlers (room /
   * inventory / settings) all forward esc here.
   */
  function handleEscape() {
    const resolution = resolveEscape({
      destMenuOpen: portals.isDestMenuOpen(),
      settingsOpen: settings.isOpen(),
      inventoryFocused: inv?.focused() ?? false,
      overlayFocused: mounted?.panel?.containsActive() ?? false,
    });
    switch (resolution) {
      case "close-dest-menu": portals.closeDestinationMenu(); return; // close it, stay in the room
      case "settings-back": settings.escBack(); return;   // back out (sub-tab → menu → closed)
      case "exit-inventory": exitInventory(); focusRoom(); return; // does NOT open settings
      case "refocus-room": focusRoom(); return;
      case "open-settings": settings.open();              // open() drops room focus first
    }
  }

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  /**
   * TILE-SIZING pass — runs ONLY on window resize (and first mount). Computes the
   * largest integer tile that fits the room in the FULL viewport (a docked panel is an
   * overlay and is deliberately ignored here, so docking never changes the tile).
   */
  function relayout() {
    // Bail on a stale debounced fire after the room was replaced or hidden (e.g. the
    // dev switcher moved to a card game): the fullscreen host is still in the DOM but
    // display:none, so measuring it would yield zeros.
    if (!container.isConnected || container.hidden) return;

    // Full room space: window width (minus a little) and the height between the top
    // UI bar and the window bottom. NOTHING is reserved for a docked panel here.
    const top = stage.getBoundingClientRect().top;
    fullW = Math.max(FIXED_TILE, (container.clientWidth || window.innerWidth) - SIDE_RESERVE);
    fullH = Math.max(FIXED_TILE, window.innerHeight - top);

    // Tile px from window+room+roomSize (see systems/camera): "fill" → largest integer
    // tile that fits (steps only at true thresholds), never below the floor; the fixed
    // sizes ignore the window and let the camera scroll.
    tile = computeTile({
      fullW, fullH, roomWidth: room.width, roomHeight: room.height,
      roomSize: roomSettings.roomSize, minTile: FIXED_TILE,
    });

    renderTileLayer(tileLayer, room, tile);
    portals.buildDoors();
    portals.buildMenuPortal();
    dialogue.buildMarker(tile);
    buildPiles();
    mounted?.relayout(); // module layers (zone, controls, placed, panel clamp)
    applyViewport();
  }

  /**
   * CAMERA pass — sets the visible viewport (rows/cols) and the docked panel band.
   * Called by relayout AND on dock/undock. Reads `tile` but NEVER changes it, so
   * docking only crops the camera; there is no tile "breathing" on toggle.
   */
  function applyViewport() {
    const top = stage.getBoundingClientRect().top;
    // No panel → nothing crops the camera, so the room uses the full height.
    const docked = !!mounted?.panel && mounted.panel.isDocked();
    const { effH, viewCols: cols, viewRows: rows } = computeViewport({
      fullW, fullH, tile, roomWidth: room.width, roomHeight: room.height,
      docked, dockedH: mounted?.panel?.dockedH() ?? 0,
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
    inv?.setTop(top + effH - HUD_H - HUD_GAP);

    // Band anchored to the WINDOW bottom, full width; the HUD sits a GAP above it.
    if (docked) mounted!.panel!.layoutDocked();
    dialogue.positionPortrait(); // keep the portrait anchored to the panel across dock/resize
    draw();
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
    mounted?.onPlayerDraw?.(); // position-dependent readouts (e.g. the debug line)
  }

  // -------------------------------------------------------------------------
  // Gameplay actions (bindings-driven; see systems/inputDispatch for the routing)
  // -------------------------------------------------------------------------

  function moveOrCursor(dir: Direction) {
    if (inv?.focused()) {
      inv.moveCursor(dir.dx < 0 || dir.dy < 0 ? -1 : 1);
    } else {
      const before = pos;
      pos = step(room, pos, dir);
      draw();
      // GUIDED TUTORIAL: a step waiting on "move" needs an ACTUAL move — bumping a wall doesn't count.
      if (pos.x !== before.x || pos.y !== before.y) dialogue.notify("move");
    }
  }

  /** Take one copy of `token` from a pile. Full inventory does NOT silently fail: it
   *  shifts to inventory focus with a drop/cancel prompt (same slot cursor). */
  function tryPickup(inventory: NonNullable<typeof inv>, token: string) {
    if (!inventory.pickupToken(token, null)) return; // full → the drop prompt opened instead
    dialogue.notify("pickup"); // GUIDED TUTORIAL first (see module build), then first-time beats
    dialogue.fireFirstTime("first_pickup");
    if (inventory.isFull()) dialogue.fireFirstTime("first_inventory_full");
  }

  /** pickup fallthrough (the module already declined): pile here → toggle focus. */
  function pressPickup() {
    if (!inv) return; // no inventory feature → nothing to pick up or focus
    const here = pileAt(room, pos.x, pos.y);
    if (here) { tryPickup(inv, here.token); return; }
    if (inv.focused()) { exitInventory(); } else { inv.enterFocus(); }
  }

  function doInteract() {
    if (inv?.focused()) { if (inv.hasPendingDrop()) inv.confirmDrop(); return; }
    if (mounted?.onInteract(pos)) return;          // stand on a module object (Build / Run) → activate
    const menuHere = portals.onMenuPortal(pos.x, pos.y); // stand on the menu portal → chooser
    const d = portals.doorAt(pos.x, pos.y);              // stand on a door → transition or blocked beat
    const hintHere = dialogue.onHintGiver(pos.x, pos.y); // stand on "?" → next hint beat
    // GUIDED TUTORIAL: satisfies a step waiting on "interact" — any of the above counts.
    if (menuHere || d || hintHere) dialogue.notify("interact");
    if (menuHere) { portals.openDestinationMenu(); return; }
    if (d) { portals.activateDoor(d); return; }
    if (hintHere) dialogue.talkToHint();
  }

  function dispatchAction(action: string) {
    // The module gets FIRST CLAIM on every action — a board module claims movement
    // (the player drives the board, not the slime), coding claims place/dd/dw and a
    // pickup on a placed token. A declined action falls through to the engine.
    if (mounted?.onAction?.(action)) return;
    if (MOVE[action]) { moveOrCursor(MOVE[action]); return; }
    if (action === "pickup") { pressPickup(); return; }
    if (action === "interact") doInteract();
  }

  // ONE focus-aware input handler (see systems/inputDispatch): esc + dialogue are
  // fixed; everything else resolves against the ACTIVE scheme's bindings.
  const input = createInputDispatch({
    bindings: () => roomSettings.bindings[roomSettings.scheme],
    context: () => ({
      dialogueBlocks: dialogue.blocksInput(),
      dialogueCanSkip: dialogue.canSkip(),
      destMenuOpen: portals.isDestMenuOpen(),
    }),
    onDialogueAdvance: () => dialogue.advance(),
    onDialogueSkip: () => dialogue.end(),
    onDestEscape: () => handleEscape(),
    onDestSelect: () => portals.selectDestination(),
    onDestMove: (delta) => portals.moveDestSel(delta),
    onEscape: () => handleEscape(),
    onAction: dispatchAction,
  });
  viewport.addEventListener("keydown", input.onKeydown);
  // Mouse may focus the room (room⇄panel focus switch); it does nothing else in-room.
  const onPointerDown = () => focusRoom();
  viewport.addEventListener("pointerdown", onPointerDown);

  // Debounced resize: recompute the layout but coalesce bursts of resize events.
  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(relayout, RESIZE_DEBOUNCE);
  };
  window.addEventListener("resize", onResize);

  relayout();
  inv?.draw();
  focusRoom();
  // First-ever visit to this room: on_enter (story, if any) + the guided tutorial, played
  // as ONE unskippable sequence, then marked seen (see codex.ts). Every later visit just
  // gets the normal on_enter greeting, exactly as before.
  if (guidedTutorialBeats.length && !hasCompletedTutorial(puzzle.id)) {
    dialogue.play([...onEnterBeats, ...guidedTutorialBeats], {
      onComplete: () => completeTutorial(puzzle.id),
      skippable: false,
    });
  } else if (onEnterBeats.length) {
    dialogue.play(onEnterBeats); // greeting slides in on enter
  }

  // --- TEARDOWN: undo EVERYTHING this room created, so nothing bleeds into the next. ---
  teardown.add(() => window.removeEventListener("resize", onResize));
  teardown.add(() => viewport.removeEventListener("keydown", input.onKeydown));
  teardown.add(() => viewport.removeEventListener("pointerdown", onPointerDown));
  teardown.add(() => {
    // every timer/interval the room can have running
    dialogue.clearTimers();               // autoTimer + talkTimer (interval)
    input.clearPending();                 // pending key-sequence timer
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
    settings.cancelCapture();             // drop any pending rebind-capture timer
  });
  teardown.add(() => mounted?.teardown()); // module non-DOM cleanup
  // Dropping all room DOM also detaches every element-scoped listener (settings + panel
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
