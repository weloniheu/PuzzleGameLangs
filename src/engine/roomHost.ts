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

import type { DialogueBeat, DialogueConfig, DialogueSpeaker, Puzzle, TutorialBlock } from "../schema/types";
import {
  parseRoom, step, pileAt, isWalkable, resolveDropTarget, MOVE,
  type Cell, type Direction,
} from "./core/room";
import {
  resetCodex, getUnlocksSet, getTestMode, setTestMode,
  hasSeenTutorial, markTutorialSeen, resetSeenTutorials,
} from "./core/codex";
import { createTeardown } from "./core/teardown";
import { resolveFeatures, resolveInventorySlots } from "./core/roomFeatures";
import type { LadderData } from "./core/ladder";
import type { AchievementGroup } from "./core/achievements";
import { mulberry32, randomSeed, shufflePositions } from "./core/shuffle";
import { renderTileLayer } from "./systems/tileLayer";
import { computeTile, computeViewport } from "./systems/camera";
import { cameraOffset, createSlime, drawPlayer } from "./systems/player";
import { createDialogue } from "./systems/dialogue";
import { paintTaskOverlay, removeTaskOverlay } from "./systems/taskOverlay";
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
const DROP_TTL_MS = 8000;    // a dropped token despawns this long after it lands
const DROP_WARN_MS = 2000;   // ...and spends its last stretch visibly fading out first
const RICOCHET_MS = 400;     // flight time of a token with nowhere to land: thrown at a
                             // wall, it comes back to where you were standing. Stay put
                             // and you catch it; step away in time and it lands there.

/** A door transition target, or a solved-puzzle notification, bubbled up to the manager. */
export interface RoomCallbacks {
  /** An OPEN door / menu-portal selection → mount this target id (manager does teardown + mount). */
  onDoor?: (target: string) => void;
  /** The room's puzzle was solved → may earn an unlock (see RoomLayout.grants_unlock). */
  onSolved?: (puzzle: Puzzle) => void;
  /** When provided, this room is a LEVEL: a persistent MENU PORTAL sits at spawn, and this
   *  returns the LADDER data for this room's puzzle type (Language → Mechanic → Level),
   *  recomputed fresh on each open. Omitted for the hub (no menu portal). */
  menuLadder?: () => LadderData | null;
  /** A door's own ladder (e.g. a hub portal → its target type's languages). Returning
   *  data with levels makes the OPEN door open the drill-down instead of teleporting. */
  doorLadder?: (target: string) => LadderData | null;
  /** Resolve the teleport flash color for a target id (the manager has the registry).
   *  Used by hub PORTALS so their transition flashes in the destination's color. */
  flashColorFor?: (target: string) => string;
  /** Resolve a SHARED tutorial by id (the manager merges every pack's `tutorials` map).
   *  Used for the level's `tutorial_refs` first-encounter playback. */
  tutorialFor?: (id: string) => TutorialBlock | null;
  /** The ACHIEVEMENTS tracker's rows, recomputed fresh on each open so a key earned
   *  this session shows immediately. Omitted ⇒ settings hides the Achievements tab. */
  achievements?: () => AchievementGroup[];
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

  // AXIS-3 MODIFIERS (see schema Modifier) — read once at mount, dispatch-only.
  const modifiers = new Set(puzzle.modifiers ?? []);
  // randomized: permute the piles' spawn cells WITHIN the authored set (the pool is
  // exactly the cells content placed piles on — the engine never invents a cell).
  // Runtime seed, fresh each mount; shuffled COPIES so pack data is never mutated.
  // Board games shuffle their own movable tiles the same way (see each module).
  if (modifiers.has("randomized") && room.piles.length) {
    room.piles = shufflePositions(room.piles, mulberry32(randomSeed()));
  }

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
  const unlocks = getUnlocksSet();

  const invSlots = resolveInventorySlots(layout.inventory_slots, puzzle.puzzle_type);

  container.innerHTML = "";
  // Per-game room class keyed by puzzle_type — the engine's one allowed dispatch axis.
  const themeClass = `room-type-${puzzle.puzzle_type}`;
  container.classList.add(themeClass);
  // Visual skin (STYLE axis): the pack may declare `theme` — a token from the CLOSED
  // skin set (see RoomTheme). The language→look mapping is content's decision; the
  // engine only dispatches on the token. Undeclared → the default warm-sand look.
  const skinClass = layout.theme ? `room-theme-${layout.theme}` : null;
  if (skinClass) container.classList.add(skinClass);

  // --- top bar (3d): a wooden HUD bar — title in the centre, gear on the right
  //     (the gear is created by the settings panel, appended below). ---
  const topbar = document.createElement("div");
  topbar.className = "room-topbar";
  const hudTitle = document.createElement("div");
  hudTitle.className = "room-hud-title";
  hudTitle.textContent = puzzle.metadata?.concept ?? "";
  topbar.appendChild(hudTitle);
  // Goal display (CONTENT): the desired output / plain-language description — NEVER the target
  // code (no tier reveals the answer; see MechanicsConfig.goalSpec). Generic: any room puzzle
  // may declare a goalSpec; the engine never branches on type. Omitted ⇒ the "task" action
  // (default key T) is a no-op — this is how the Baba-style logic_rules rooms end up with NO
  // task prompt at all: the rule tiles ARE the goal, so their packs never set goalSpec.
  //
  // Shown as an on-demand PROMPT (task overlay), not a persistent HUD line: it used to be a
  // topbar chip, but a single-line ellipsis truncated every description longer than ~40
  // chars, and the coding levels genuinely need both a description AND the target output
  // shown clearly — there was no room for that in the old chip. See systems/taskOverlay.ts.
  const goalSpec = puzzle.mechanics?.goalSpec;
  const hasTask = !!(goalSpec && (goalSpec.description || goalSpec.output));
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
  // Q-dropped tokens (transient, auto-repickup, self-despawning) — their own layer so a
  // relayout can reposition them without disturbing piles or the module's placed tokens.
  const droppedLayer = document.createElement("div");
  droppedLayer.className = "room-dropped-layer";
  const slime = createSlime();

  viewport.appendChild(world);
  stage.appendChild(viewport);
  container.appendChild(stage);

  // lowlight (5e): a soft radial vision falloff pinned to the player's SCREEN cell —
  // transparent at the center, near-opaque at the edge. A later sibling of the world
  // inside the (overflow-clipped) viewport, so it dims every layer but never the HUD
  // or dialogue. Purely a challenge/visual layer; repositioned in draw().
  const lowlightEl = modifiers.has("lowlight") ? document.createElement("div") : null;
  if (lowlightEl) {
    lowlightEl.className = "room-lowlight";
    viewport.appendChild(lowlightEl);
  }

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
    resetSeenTutorials,
    getTestMode,
    setTestMode,
    achievements: callbacks.achievements,
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
    // GUIDED TUTORIAL card badge (see systems/tutorialCard.ts). These MUST be this room's
    // own identity: the card names the module the player is standing in, and tutorialCard's
    // "hub" sentinel keys off the id.
    puzzleType: puzzle.puzzle_type,
    puzzleId: puzzle.id,
  });

  // --- portals & transitions (system): doors, menu portal, chooser, flash ----
  const portals = createPortals({
    container,
    room,
    doors,
    unlocks,
    puzzleType: puzzle.puzzle_type,
    hasMenuPortal: !!callbacks.menuLadder,
    tile: () => tile,
    pos: () => pos,
    dialogue,
    removePlayer: () => slime.remove(), // remove the slime before the map changes
    focusRoom,
    menuLadder: callbacks.menuLadder,
    doorLadder: callbacks.doorLadder,
    flashColorFor: callbacks.flashColorFor,
    onTransition: (target) => callbacks.onDoor?.(target), // manager tears THIS room down + mounts target
  });

  // Order matters for stacking; module layers slot in around these (see addLayer).
  world.append(tileLayer, portals.doorLayer);
  if (portals.menuPortalEl) world.append(portals.menuPortalEl); // below the slime, which spawns on top of it
  world.append(markerLayer, pileLayer, droppedLayer, slime);

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
    movePlayer: (cell) => {
      // Board modules (logic/grammar/vocab) drive the slime through here — give
      // their moves the same juice as engine walking (3j/3i): eyes track the travel
      // direction, the body squishes for the slide, dust puffs at the departed cell.
      const dx = Math.sign(cell.x - pos.x);
      const dy = Math.sign(cell.y - pos.y);
      if (dx || dy) {
        faceDirection({ dx, dy });
        squishForStep();
        puffDust(pos);
      }
      pos = { ...cell };
      draw();
    },
    dialogue,
    inventory: inv,
    onSolved: () => {
      callbacks.onSolved?.(puzzle);
      // AUTO-MENU ON SOLVE (toggleable): the moment a level is completed, open its
      // destination chooser so the player can move on without walking back to the
      // portal. Only level rooms have a chooser. Generic — no puzzle-type branching.
      if (roomSettings.autoMenuOnSolve && callbacks.menuLadder) portals.openDestinationMenu();
    },
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
      tutorialActive: dialogue.isActive() && dialogue.canSkip(),
    });
    switch (resolution) {
      case "close-dest-menu": portals.escBack(); return; // pop one rung (closes at the top)
      case "settings-back": settings.escBack(); return;   // back out (sub-tab → menu → closed)
      case "exit-inventory": exitInventory(); focusRoom(); return; // does NOT open settings
      case "refocus-room": focusRoom(); return;
      case "skip-tutorial": dialogue.end(); return;       // the player's way out of teaching
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
    drawDropped();
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
      // Token VISUAL classification (CONTENT — see RoomPile): punctuation renders as a
      // purple bead (5b); decoys get the dashed tray-only distractor tell (6a).
      if (pile.kind === "punctuation") p.classList.add("tile-token-punct");
      if (pile.decoy || pile.kind === "decoy") p.classList.add("tile-token-decoy");
      // Long tokens (e.g. "hello world") span multiple tiles so they stay readable instead of
      // truncating. The pile is still ONE logical cell — pickup is on its anchor (pile.pos); the
      // box just extends to the right. ~6 monospace chars fit one tile at the label size.
      const span = Math.max(1, Math.ceil(pile.token.length / 6));
      p.style.width = `${span * tile}px`;
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
    if (lowlightEl) {
      // Center the falloff on the player's SCREEN cell (world cell minus the camera).
      // Radii scale with the tile (1.5 / 2.25 tiles = the spec's 60/90px at a 40px tile).
      const { camX, camY } = cameraOffset(pos, viewCols, viewRows, room.width, room.height);
      lowlightEl.style.setProperty("--lowlight-x", `${(pos.x + 0.5 - camX) * tile}px`);
      lowlightEl.style.setProperty("--lowlight-y", `${(pos.y + 0.5 - camY) * tile}px`);
      lowlightEl.style.setProperty("--lowlight-clear", `${Math.round(tile * 1.5)}px`);
      lowlightEl.style.setProperty("--lowlight-fall", `${Math.round(tile * 2.25)}px`);
    }
    mounted?.onPlayerDraw?.(); // position-dependent readouts (e.g. the debug line)
  }

  // -------------------------------------------------------------------------
  // Gameplay actions (bindings-driven; see systems/inputDispatch for the routing)
  // -------------------------------------------------------------------------

  /** Facing drives the eye rule (3j): down = 2 dots, left/right = 1 offset, up = 0.
   *  Kept as DATA too (not just the dataset attribute) because the Q drop throws the
   *  token at the cell in front of the slime — see dropTargetCell(). */
  let facing: Direction = MOVE.down; // rooms spawn the slime facing the camera
  function faceDirection(dir: Direction) {
    facing = dir;
    slime.dataset.facing =
      dir.dx < 0 ? "left" : dir.dx > 0 ? "right" : dir.dy < 0 ? "up" : "down";
  }

  /** Squish lengthwise for the slide, relax to the normal pose on arrival (3j). */
  let moveSquishTimer = 0;
  function squishForStep() {
    slime.classList.add("moving");
    clearTimeout(moveSquishTimer);
    moveSquishTimer = window.setTimeout(() => slime.classList.remove("moving"), 140);
  }

  /** A little dust puff kicked up at the departed cell (3i). Self-removing. */
  function puffDust(cell: Cell) {
    for (const dx of [-0.18, 0.18]) {
      const d = document.createElement("div");
      d.className = "room-dust";
      d.style.left = `${(cell.x + 0.5 + dx) * tile}px`;
      d.style.top = `${(cell.y + 1) * tile - 7}px`;
      world.appendChild(d);
      window.setTimeout(() => d.remove(), 600);
    }
  }

  /** A collect sparkle over a cell (3i) — fired on a successful pickup. Self-removing. */
  function sparkleAt(cell: Cell) {
    const s = document.createElement("div");
    s.className = "room-sparkle";
    s.textContent = "✦";
    s.style.left = `${(cell.x + 0.5) * tile}px`;
    s.style.top = `${(cell.y + 0.4) * tile}px`;
    s.style.fontSize = `${Math.round(tile * 0.5)}px`;
    world.appendChild(s);
    window.setTimeout(() => s.remove(), 700);
  }

  function moveOrCursor(dir: Direction) {
    if (inv?.focused()) {
      inv.moveCursor(dir.dx < 0 || dir.dy < 0 ? -1 : 1);
    } else {
      const before = pos;
      faceDirection(dir); // eyes track travel direction even on a wall bump
      pos = step(room, pos, dir);
      draw();
      // GUIDED TUTORIAL: a step waiting on "move" needs an ACTUAL move — bumping a wall doesn't count.
      if (pos.x !== before.x || pos.y !== before.y) {
        squishForStep();
        puffDust(before);
        autoPickupAt(pos); // walked onto a dropped token → it comes back with you
        dialogue.notify("move");
      }
    }
  }

  /** Take one copy of `token` from a pile. Full inventory does NOT silently fail: it
   *  shifts to inventory focus with a drop/cancel prompt (same slot cursor). */
  function tryPickup(inventory: NonNullable<typeof inv>, token: string) {
    if (!inventory.pickupToken(token, null)) return; // full → the drop prompt opened instead
    sparkleAt(pos); // collect sparkle (3i)
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

  // --- DROPPED ITEMS (Q): transient tokens lying on the floor ------------------
  //
  // Distinct from a PLACED token (which is a module's business — permanent, and inside a
  // coding area it counts as code). A dropped token is engine-level and temporary: it
  // lands on the cell the slime FACES, is picked back up just by walking over it, and
  // despawns on its own after DROP_TTL_MS so a room can't silt up with abandoned tokens.
  //
  // Nothing here is scarce — piles are infinite sources (tryPickup never consumes one) —
  // so a despawn can't strand a level. If piles ever become finite, this timer becomes a
  // soft-lock risk and should be revisited.
  interface DroppedItem { token: string; x: number; y: number; timer: number; el: HTMLElement; }
  const dropped: DroppedItem[] = [];
  // Tokens mid-ricochet (thrown with nowhere to land). Tracked so teardown can cancel a
  // flight that would otherwise resolve into a room that no longer exists.
  const inFlight: { el: HTMLElement; timer: number }[] = [];

  const droppedAt = (x: number, y: number) => dropped.find((d) => d.x === x && d.y === y) ?? null;

  /** Remove a dropped item from the world (its timer + its element). */
  function clearDropped(d: DroppedItem) {
    clearTimeout(d.timer);
    d.el.remove();
    const i = dropped.indexOf(d);
    if (i >= 0) dropped.splice(i, 1);
  }

  /** Can a thrown token come to rest on this cell? Floor with nothing already on it —
   *  a pile, a door, the menu portal, the hint giver, another dropped token, or the
   *  module's own furniture (a placed token, Build/Run) all rule it out. */
  function freeForDrop(c: Cell): boolean {
    if (!isWalkable(room, c.x, c.y)) return false;
    if (pileAt(room, c.x, c.y) || droppedAt(c.x, c.y)) return false;
    if (portals.doorAt(c.x, c.y) || portals.onMenuPortal(c.x, c.y)) return false;
    if (dialogue.onHintGiver(c.x, c.y)) return false;
    return !mounted?.occupies?.(c);
  }

  /** Throw the held token — the selected hotbar slot, same one `place` uses — at the cell
   *  the slime faces. Where it ends up is resolveDropTarget's call (see core/room):
   *  open floor keeps it, a wall bounces it back behind you, a pit or the room's edge
   *  eats it. Only "blocked" leaves the token in hand.
   *
   *  Inert while the full-inventory prompt is up: that prompt already owns the decision. */
  function pressDrop() {
    if (!inv || inv.hasPendingDrop()) return;
    const index = inv.selected();
    if (inv.itemAt(index) === undefined) return; // empty slot → nothing in hand
    const target = resolveDropTarget(room, pos, facing, freeForDrop);
    const token = inv.removeAt(index)!;          // it leaves your hand either way
    if (target.kind === "void") voidPuff();      // over the edge / into the pit — gone
    else if (target.kind === "blocked") ricochet(token, { ...pos }); // nowhere to land
    else spawnDropped(token, target.cell);
    dialogue.notify("drop");                     // GUIDED TUTORIAL: satisfies a "drop" step
  }

  /** Walled in front AND behind: the token has nowhere to land, so it rebounds off the
   *  wall back toward the cell it was thrown from. It is in the AIR for RICOCHET_MS —
   *  stand your ground and you catch it back into the inventory (as if you had dropped
   *  and re-taken it); step off that cell in time and it lands there instead, an ordinary
   *  dropped token you can come back for. */
  function ricochet(token: string, origin: Cell) {
    const el = document.createElement("div");
    el.className = "room-ricochet";
    el.textContent = token;
    el.style.left = `${(origin.x + 0.5) * tile}px`;
    el.style.top = `${(origin.y + 0.5) * tile}px`;
    el.style.fontSize = `${Math.round(tile * 0.2)}px`;
    // How far, and which way, the token flies before rebounding (half a tile at the wall).
    el.style.setProperty("--rx", `${facing.dx * tile * 0.5}px`);
    el.style.setProperty("--ry", `${facing.dy * tile * 0.5}px`);
    world.appendChild(el);

    const timer = window.setTimeout(() => {
      el.remove();
      const i = inFlight.findIndex((f) => f.timer === timer);
      if (i >= 0) inFlight.splice(i, 1);
      land(token, origin);
    }, RICOCHET_MS);
    inFlight.push({ el, timer });
  }

  /** Where a ricocheting token ends up once its flight is over. Caught if the player
   *  never left (and still has room); otherwise it drops onto the cell they vacated. The
   *  last two fallbacks only fire if that cell got occupied mid-flight — vanishingly rare,
   *  but the token should never silently evaporate. */
  function land(token: string, origin: Cell) {
    const stayedPut = pos.x === origin.x && pos.y === origin.y;
    if (stayedPut && inv && !inv.isFull()) { inv.pickupToken(token, null); sparkleAt(origin); return; }
    if (freeForDrop(origin)) { spawnDropped(token, origin); return; }
    if (inv && !inv.isFull()) { inv.pickupToken(token, null); return; }
    voidPuffAt(origin); // nowhere left at all
  }

  /** A token going into a pit or over the edge isn't just silently deleted — it gets the
   *  same courtesy the despawn fade does, a brief puff where it fell out of the world. */
  function voidPuff() {
    voidPuffAt({ x: pos.x + facing.dx, y: pos.y + facing.dy });
  }
  function voidPuffAt(cell: Cell) {
    const el = document.createElement("div");
    el.className = "room-void-puff";
    el.style.left = `${(cell.x + 0.5) * tile}px`;
    el.style.top = `${(cell.y + 0.5) * tile}px`;
    el.style.fontSize = `${Math.round(tile * 0.4)}px`;
    el.textContent = "···";
    world.appendChild(el);
    window.setTimeout(() => el.remove(), 700);
  }

  /** Put `token` on the floor at `cell` and start its despawn countdown. */
  function spawnDropped(token: string, cell: Cell) {
    const el = document.createElement("div");
    el.className = "room-dropped";
    const label = document.createElement("span");
    label.className = "room-dropped-label";
    label.textContent = token;
    el.appendChild(label);
    droppedLayer.appendChild(el);
    const d: DroppedItem = { token, x: cell.x, y: cell.y, timer: 0, el };
    // Warn before it goes: the last stretch fades/blinks so a despawn is never a silent
    // disappearance the player only notices afterwards.
    const warn = window.setTimeout(() => el.classList.add("expiring"), DROP_TTL_MS - DROP_WARN_MS);
    d.timer = window.setTimeout(() => { clearTimeout(warn); clearDropped(d); }, DROP_TTL_MS);
    dropped.push(d);
    drawDropped();
  }

  /** Position every dropped item at the current tile size (also called from relayout). */
  function drawDropped() {
    for (const d of dropped) {
      d.el.style.width = `${tile}px`;
      d.el.style.height = `${tile}px`;
      d.el.style.transform = `translate(${d.x * tile}px, ${d.y * tile}px)`;
      const label = d.el.firstElementChild as HTMLElement | null;
      if (label) label.style.fontSize = `${Math.round(tile * 0.22)}px`;
    }
  }

  /** Walking onto a dropped token picks it back up — no keypress. A FULL inventory simply
   *  leaves it lying there (it keeps counting down); the drop/cancel prompt is for a
   *  DELIBERATE pickup, and firing it on a walk-over would ambush the player mid-stride. */
  function autoPickupAt(cell: Cell) {
    const d = droppedAt(cell.x, cell.y);
    if (!d || !inv || inv.isFull()) return;
    clearDropped(d);
    inv.pickupToken(d.token, null);
    sparkleAt(cell);
    dialogue.notify("pickup");
    dialogue.fireFirstTime("first_pickup");
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

  // TASK overlay (systems/taskOverlay.ts) — the goalSpec prompt. Its own concern, not
  // the mounted module's, so it's checked BEFORE the module gets first claim below: no
  // module needs to know the "task" action exists. Opening/closing repaints the same
  // scrim; the board-freeze is a SEPARATE flag (taskOverlayOpen) fed to inputDispatch,
  // same mechanism dialogue.blocksInput() already uses (see systems/inputDispatch.ts).
  let taskOpen = false;
  function openTask() {
    if (!hasTask || taskOpen) return;
    taskOpen = true;
    paintTaskOverlay(container, { description: goalSpec!.description, output: goalSpec!.output });
  }
  function closeTask() {
    if (!taskOpen) return;
    taskOpen = false;
    removeTaskOverlay(container);
  }

  function dispatchAction(action: string) {
    if (action === "task") { openTask(); return; }
    // The module gets FIRST CLAIM on every action — a board module claims movement
    // (the player drives the board, not the slime), coding claims place/dd/dw and a
    // pickup on a placed token. A declined action falls through to the engine.
    if (mounted?.onAction?.(action)) return;
    if (MOVE[action]) { moveOrCursor(MOVE[action]); return; }
    if (action === "pickup") { pressPickup(); return; }
    if (action === "drop") { pressDrop(); return; }
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
      taskOverlayOpen: taskOpen,
    }),
    onDialogueAdvance: () => dialogue.advance(),
    onDialogueSkip: () => dialogue.end(),
    onDestEscape: () => handleEscape(),
    onDestSelect: () => portals.selectDestination(),
    onDestMove: (delta) => portals.moveDestSel(delta),
    onEscape: () => handleEscape(),
    onTaskClose: () => closeTask(),
    onSlot: (index) => inv?.selectSlot(index), // hotbar 1-9; no inventory ⇒ nothing to select
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
  // Portal travel, arrival half (3h): the slime pops out of the spawn portal with a
  // small bounce. The class only swaps the body animation; position math is untouched.
  slime.classList.add("arriving");
  const arriveTimer = window.setTimeout(() => slime.classList.remove("arriving"), 600);
  // Entering a room: on_enter (story, if any) + the guided tutorial, as ONE sequence.
  // Entering a room NEVER auto-opens the menu — the auto-menu is a solve-time reward
  // (see ctx.onSolved), so the first room plays normally.
  //
  // Teaching plays ONCE per tutorial, ever (persisted — see core/codex.ts's seen-tutorial
  // store), then stays quiet: a SHARED tutorial (tutorial_refs id) is seen once across the
  // whole game; the room's OWN guided_tutorial is seen once for that room (`room:<id>`).
  // Either way, watching it to the end OR skipping it with Escape both count as "seen" —
  // dialogue.end() fires onComplete on both paths (see systems/dialogue.ts). The story
  // on_enter beats are NOT gated this way — they're flavor, not teaching, and replay every
  // visit. "Replay Tutorials" in Settings (resetSeenTutorials) is the deliberate way back in.
  //
  // WHOLE-UNIT for whatever's left to show (always the same, never partial): the UNSEEN
  // shared tutorials the level references (in order), then the room's own guided_tutorial
  // if that hasn't been seen either — never a tutorial cut short partway through.
  //
  // `guarded` (not `skippable: false`) is what protects the run: an interjection — an error
  // beat, a blocked door, a hint — stashes over it and the tutorial resumes at the same step,
  // while Escape still belongs to the player.
  const teaching: DialogueBeat[] = [];
  const unseenRefIds: string[] = [];
  for (const refId of puzzle.tutorial_refs ?? []) {
    if (hasSeenTutorial(refId)) continue;
    const block = callbacks.tutorialFor?.(refId);
    if (block?.dialogue?.length) { teaching.push(...block.dialogue); unseenRefIds.push(refId); }
  }
  const roomTutorialId = `room:${puzzle.id}`;
  const showRoomOwnTutorial = guidedTutorialBeats.length > 0 && !hasSeenTutorial(roomTutorialId);
  if (showRoomOwnTutorial) teaching.push(...guidedTutorialBeats);
  if (teaching.length) {
    dialogue.play([...onEnterBeats, ...teaching], {
      guarded: true,
      skippable: true,
      onComplete: () => {
        for (const refId of unseenRefIds) markTutorialSeen(refId);
        if (showRoomOwnTutorial) markTutorialSeen(roomTutorialId);
      },
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
    clearTimeout(moveSquishTimer);        // pending move-squish relax
    clearTimeout(arriveTimer);            // pending arrival-pop cleanup
    for (const d of [...dropped]) clearDropped(d);            // dropped-token despawn timers
    for (const f of inFlight) { clearTimeout(f.timer); f.el.remove(); } // mid-air ricochets
    inFlight.length = 0;
    settings.cancelCapture();             // drop any pending rebind-capture timer
  });
  teardown.add(() => {
    container.classList.remove(themeClass); // the container outlives the room
    if (skinClass) container.classList.remove(skinClass);
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
