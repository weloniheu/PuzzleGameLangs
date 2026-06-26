# Modularization Plan — Code Game → Shared Room Engine + Per-Puzzle-Type Modules

**Status:** proposal for review. **No code changes** are part of this document.
**Goal:** restructure the room/world code game so the three upcoming puzzle types
(**logic, grammar, language**) plug into shared systems instead of each cloning the
1,682-line `roomRenderer.ts`.

**Non-negotiable constraints (baked into every step below):**

1. **Behavior-preserving.** This is reorganization, not redesign. Each move must keep
   the running game pixel-for-pixel identical.
2. **Always shippable.** Every step ends at a state that is playable (`npm run dev`),
   typechecks + builds (`npm run build`), passes `npm test`, and is committable on its own.
3. **No engine branching on puzzle type or language.** The README litmus test holds:
   never `if (puzzle_type === "code_build")` or `if (language === …)` in shared engine
   code. Dispatch happens through a **registry** (data → module), exactly like the
   existing renderer/validator registries.
4. **One step at a time.** We review, then execute a single step, commit, repeat.

---

## 0. Orientation — the two parallel systems (don't conflate them)

The repo currently has **two** puzzle paths:

| Path | Entry | Used by | Files |
|------|-------|---------|-------|
| **Card** (legacy) | `puzzleRunner.runPuzzle` → `renderers/` registry + `validators/` registry | `match`, `sentence_build`, `combine`, and the *card* `code_build` | `puzzleRunner.ts`, `renderers/{match,sentence,combine,code}Renderer.ts`, `renderers/gridArena.ts`, `validators/*` |
| **Room/world** (current focus) | `main.bootHub` → `roomManager` → `roomRenderer.renderRoom` | the **code game** (hub + coding levels) | `roomRenderer.ts` + the pure modules it imports |

`main.ts` routes a puzzle with a `room` field to the room path; everything else to the
card path. **This plan is about the room path only.** The three upcoming types will be
*room* experiences (a hub portal each), so they need to share the room engine — not the
card renderers, and not a copy of `roomRenderer`.

> Out of scope (call out, don't touch now): eventually the card renderers
> (`combine/sentence/match`) and the card `codeRenderer` likely fold into room modules
> too, but that's a later reconciliation. This plan extracts the **room** engine first.

---

## 1. Current state — what `roomRenderer.ts` owns

`renderRoom()` is one closure holding ~50 inner functions + module-scope constants and a
shared mutable `roomSettings`. Responsibilities, tagged **[S]** shared-by-all-room-types
vs **[C]** coding-specific:

### Shared infrastructure (already pure, already extracted — DOM-free, tested)
These are imported by `roomRenderer` and are in good shape:

- `room.ts` **[S]** — parse tiles → grid, spawn (bottom-default), `step`/collision, `pileAt`, `inCodingArea`.
- `keybindings.ts` **[S]** — bindings-as-data, `resolve()` (single keys + dd/dw sequences), `rebind`, conflicts.
- `roomFeatures.ts` **[S]** — `resolveFeatures` (terminal/coding_area), `resolveInventorySlots` (room-first → type → fallback).
- `doors.ts` **[S]** — `doorReaction(door, unlocks)` (open/locked/coming_soon).
- `progression.ts` **[S]** — `destinationMenu(levels, unlocks)` (Hub + unlocked levels).
- `portalColors.ts` **[S]** — `portalFlashColor({hub,puzzleType,override})`.
- `teardown.ts` **[S]** — the undo registry.
- `codex.ts` **[S]** — discovered commands + unlocks persistence (localStorage).
- `codeGameLogic.ts` **[C]** — build/run state machine + order-checker (the coding validator core).

### Responsibilities still living *inside* `roomRenderer.ts` (the monolith to split)

| # | Responsibility | Tag | Key functions / state |
|---|----------------|-----|------------------------|
| 1 | **Camera & sizing** | **[S]** | `relayout`, `applyViewport`, `tile`/`viewCols`/`viewRows`/`fullW`/`fullH`, `ROOM_TILE`, fill/small/medium/large |
| 2 | **Tile render** | **[S]** | `buildTiles` |
| 3 | **Player movement** | **[S]** | `pos`, `moveOrCursor` (move half), `draw` (slime + camera follow) |
| 4 | **Inventory + HUD** | **[S]** | `drawInventory`, `invFocused/invSel/invDrop`, `tryPickup`, `tryPickPlaced`, `enterInventory`, `enterDrop`, `confirmDrop`, `pressI` |
| 5 | **Piles** (pickup sources) | **[S]** | `buildPiles`, `pileAt` |
| 6 | **Focus model + esc ladder** | **[S]** | `handleEscape`, `dropFocusToRoom`, `exitInventory`, focus states (inventory / terminal / settings / dialogue / dest-menu) |
| 7 | **Input dispatch** | **[S]** | `onKeydown`, `dispatchAction`, `pendingKeys`/`seqTimer`, `activeBindings`, `clearPending`/`armPendingTimer` |
| 8 | **Settings panel** | **[S]** | `buildMenu`/`buildControls`/`buildDisplay`/`renderSettings`, rebind capture (`captureStart/Commit/Key`), `setTermFont`, `roomSettings` |
| 9 | **Dialogue presenter** | **[S]** | `playSequence`/`showBeat`/`showPortraitBeat`/`showNarratorBeat`/`advanceDialogue`/`endDialogue`, portrait + narrator surfaces, `clearDialogueTimers`, `positionDialogue` |
| 10 | **Hint giver marker** | **[S]** | `buildMarkers`, `highlightMarker`, `talkToHint`, `onHintGiver` |
| 11 | **Portals & transitions** | **[S]** | `buildDoors`, `buildMenuPortal`, `activateDoor`, destination menu (`openDestinationMenu`/`renderDestMenu`/`moveDestSel`/`selectDestination`), `playFlash`, `playHubArrival`, `doorAt`/`onMenuPortal` |
| 12 | **Teardown wiring** | **[S]** | the `teardown.add(...)` block + `activeRoomTeardown` self-guard |
| 13 | **Terminal overlay** | **[C]** (feature-gated) | `buildTerminal` → `TerminalApi` (dock/pop/drag/resize), `termSet`, font |
| 14 | **Coding area** | **[C]** | `drawCodingZone`, `placeToken` (+ indent), `drawPlaced`, `lineOnRow`/`indentOnRow`, `pressPlace` |
| 15 | **Build / Run + validation** | **[C]** | `doBuild`, `doRun`, `currentProgram`, `dirtyLine`, `activateControl`, `buildState`, `buildControlsLayer` |
| 16 | **Code editing ops** | **[C]** | `vimClearLine` (dd), `vimDeleteToken` (dw) |
| 17 | **Debug readout** | **[C]** | `drawDebug`, `debugOn` |
| 18 | **First-time tutorial beats** | **[C]→S]** | `fireFirstTime`, `firedFirstTimes`, `snakeBeat` — the *mechanism* is shareable; the *triggers* (`first_pickup`, `first_run_no_build`, …) are coding events |

**Reading:** ~12 of 18 responsibilities are shared. The coding-specific ones (13–17) are
exactly what a puzzle-type module should own. #18 is a shared mechanism fed by
type-specific events. Movement/camera/tiles/inventory/focus/dispatch/settings/dialogue/
portals/teardown are the **engine**.

---

## 2. Target structure — shared engine + pluggable modules

```
src/
  schema/                       ← unchanged (the contract)
  engine/
    core/                       ← PURE, DOM-free (relocate today's pure modules here)
      room.ts  keybindings.ts  roomFeatures.ts  doors.ts
      progression.ts  portalColors.ts  teardown.ts  codex.ts
    systems/                    ← SHARED DOM systems (extracted from roomRenderer)
      camera.ts                 ← sizing math + viewport/camera apply (#1, #3 camera half)
      tileLayer.ts              ← tile grid render (#2)
      player.ts                 ← slime element + move/draw (#3)
      inventoryHud.ts           ← slots, HUD, pickup/drop focus (#4, #5 pickup side)
      dialogue.ts               ← portrait + narrator presenter (#9, #10, #18 mechanism)
      settingsPanel.ts          ← gear + tabs + rebind capture (#8)
      portals.ts                ← doors, menu portal, dest menu, flash, transitions (#11)
      inputDispatch.ts          ← key→action, pending sequences (#7)
      focus.ts                  ← esc ladder + focus-state machine (#6)
      panel.ts                  ← generic dock/pop overlay primitive (terminal reuses it)
    roomHost.ts                 ← the SHELL: builds world, wires systems, mounts a module
    roomManager.ts              ← unchanged (resolves id → puzzle, calls roomHost)
    packLoader.ts               ← unchanged
    renderers/ validators/      ← legacy CARD path (untouched by this plan)
  puzzles/                      ← PER-TYPE modules (the pluggable part)
    coding/
      index.ts                  ← the module: implements RoomPuzzleModule, registered by puzzle_type
      codeGameLogic.ts          ← (moved from engine/) pure build/run + order-check
      terminal.ts               ← build/run transcript on systems/panel.ts (#13)
      codingArea.ts             ← zone + placement + indent + Build/Run + validation (#14,#15,#16,#17)
    logic/ grammar/ language/   ← future modules, same interface
  main.ts                       ← unchanged entry
```

### The boundary

**What the engine (roomHost) exposes to a module** — an `EngineContext` of *services*,
never type-aware:

- `world` container + `addLayer()` (positioned, camera-tracked, torn down with the room)
- `tile()` current px, `cellAt`/`pos()` reads, and a `redraw()` / `markDirty()` hook
- `dialogue.play(beats)` — portrait or narrator, routed by speaker (engine decides surface)
- `inventory` — `slots`, `take(token)`, `peek`, `removeSelected`, focus state (read-only to the module)
- `portals.requestTransition(targetId)` + `flash(cell, color, onDone)` (the away sequence)
- `panel.create(opts)` — a dock/pop overlay primitive (terminal builds on it)
- `settings` — register a Display/Controls section; read `roomSettings`
- `codex` — `discover`, `getUnlocks` (already pure)
- `teardown.add(fn)` — register the module's own undo
- `onRelayout(tile => …)` — rebuild the module's layers at a new tile size

**What a module must implement** — `RoomPuzzleModule`:

```ts
interface RoomPuzzleModule {
  puzzleType: PuzzleType;                 // registry key (dispatch, not branching)
  // Build play objects (coding area, terminal, …) into the world; return live hooks.
  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle;
}
interface MountedPuzzle {
  // Player pressed interact while standing on `cell`. Return true if the module handled it
  // (Build/Run/etc.); false lets the engine try portals/hint-giver next.
  onInteract(cell: Cell): boolean;
  // Optional extra in-room actions bound via keybindings (e.g. dd/dw). Engine routes the
  // action id here if the module claims it.
  onAction?(actionId: string): boolean;
  relayout(): void;                       // rebuild own layers at the current tile size
  teardown(): void;                       // engine also clears world DOM; this is for non-DOM
}
```

A registry `puzzles/index.ts` maps `puzzle_type → RoomPuzzleModule` (mirrors
`renderers/index.ts`). `roomHost` looks the module up by `puzzle.puzzle_type`, mounts it,
and routes interact/relayout/teardown to it. **The host never names a type.**

### How the upcoming types plug in

- **logic** (combine): module owns its "ingredient tiles + mix" objects + `combine_match`.
- **grammar** (sentence_build): module owns the "structure slots" + `sequence_match`.
- **language** (match): module owns the Sokoban push board (or a tile-select variant).

Each reuses movement, camera, inventory/HUD, dialogue, portals, settings, focus, input
dispatch from `engine/systems/` — and declares which **features** it wants
(`roomFeatures` already models `terminal`/`coding_area`; we extend the closed set as
needed, e.g. `push_board`).

---

## 3. Extraction order — safest → riskiest

Each step is one commit. "Behavior unchanged" is verified by `npm run build` + `npm test`
+ a manual `npm run dev` smoke of the affected surface.

### Phase A — relocate pure modules (near-zero risk)
**A1.** Create `engine/core/` and move the already-pure, already-tested modules
(`room, keybindings, roomFeatures, doors, progression, portalColors, teardown, codex`)
into it. Pure path/import change only.
*Deps:* everything imports these. *Breaks if:* an import path is missed → caught by build.
*Test:* existing unit tests move with the files; green build proves it.

**A2.** Move `codeGameLogic.ts` → `puzzles/coding/` (it's coding's validator core).
*Same risk profile as A1.*

### Phase B — extract self-contained DOM systems (low risk)
Order chosen so each extracted system depends only on already-extracted ones.

**B1. `systems/tileLayer.ts`** (#2) — `buildTiles(layer, room, tile)`. Pure inputs → DOM.
*Breaks if:* tile px or transform math drifts. *Test:* snapshot the emitted cell
count/positions (pure helper) before moving.

**B2. `systems/camera.ts`** (#1 + camera half of #3) — split the *math* (`computeTile`,
`computeViewport`) as pure functions (testable) from the thin DOM apply.
*Deps:* room dims, settings.roomSize. *Breaks if:* fill/scroll thresholds change.
*Test:* unit-test the pure sizing math (fit tile, viewCols/Rows, docked crop) — **new tests**.

**B3. `systems/player.ts`** (#3) — slime element + `draw(pos)` + camera-follow apply.
*Deps:* camera. *Breaks if:* inset/transform changes. *Test:* manual smoke (movement).

**B4. `systems/dialogue.ts`** (#9, #10, #18 mechanism) — portrait + narrator presenter,
speaker→surface routing, beat queue/advance, hint-giver marker, `fireFirstTime` mechanism
(triggers stay in the coding module and are passed in). Self-contained except it needs
"is the terminal docked?" for portrait anchoring → take that as an injected getter.
*Deps:* panel/terminal anchor (inject), focus (to suppress gameplay). *Breaks if:* auto-advance
timing or focus-suppression changes. *Test:* extract beat-queue advance logic as a pure
reducer and unit-test it; **characterization test** for "dialogue active ⇒ gameplay
suppressed."

**B5. `systems/settingsPanel.ts`** (#8) — gear, Controls/Display tabs, rebind capture.
Depends on `keybindings` (pure) + callbacks (`relayout`, `applyTermFont`, `resetCodex`).
*Breaks if:* the rebind capture state machine changes. *Test:* `keybindings.rebind` is
already tested; add a **characterization test** for the capture buffer/commit timing.

### Phase C — extract the shared mechanics that carry game state (medium risk)
**C1. `systems/inventoryHud.ts`** (#4, pickup side of #5) — slots, HUD render, pickup/drop
focus + the full-inventory drop flow. Placement *into a coding area* is NOT here (that's
coding); the HUD exposes `take/peek/removeSelected`.
*Deps:* player draw, focus. *Breaks if:* FIFO order, drop/cancel restore, or slot cursor
changes. *Test:* extract inventory state transitions (push/full→drop/confirm/cancel) as a
pure reducer and unit-test — **new tests** (this logic is currently untested).

**C2. `systems/panel.ts`** + **`puzzles/coding/terminal.ts`** (#13) — generalize the
dock/pop/drag/resize overlay into a reusable `panel`, then rebuild the coding terminal on
top of it. Terminal is already feature-gated, which de-risks this.
*Deps:* camera (docked crop), settings (font). *Breaks if:* dock geometry / camera crop
changes. *Test:* manual smoke (dock/pop/drag/resize); pure clamp math can be unit-tested.

**C3. `puzzles/coding/codingArea.ts`** (#14, #15, #16, #17) — zone render, placement +
indent, Build/Run controls, `doBuild`/`doRun` (calls `codeGameLogic`), debug readout, dd/dw.
This is the first real **module** assembled behind `RoomPuzzleModule`.
*Deps:* inventory (take/place), dialogue (`play`), codex, terminal, codeGameLogic.
*Breaks if:* the order-check, first-time-beat gating, or terminal echo changes.
*Test:* `codeGameLogic` already covers the check; add a **characterization test** for the
`doRun` reason→beat routing (success / build-first / extra-code / first-time).

### Phase D — the interconnected machinery (high risk) — LAST
**D1. `systems/portals.ts`** (#11) — doors, menu portal, destination chooser, flash,
`playHubArrival`, transitions via `requestTransition`. Highly stateful, talks to the
manager and dialogue, owns the teleport-away sequence ordering.
*Deps:* doors, progression, portalColors (pure), dialogue, manager callbacks, player.
*Breaks if:* the strict away order (flash → remove slime → change map), transient hub
portal, or destination-menu nav changes. *Test:* **characterization tests** required
first — the destination-menu nav (a pure selection reducer) and the away-sequence ordering
(assert flash-before-teardown via injected fakes).

**D2. `systems/focus.ts`** (#6) — the esc ladder + focus-state machine
(room/inventory/terminal/settings/dialogue/dest-menu). Touches every overlay.
*Breaks if:* any esc branch order changes. *Test:* extract `handleEscape` into a **pure
state→next-state function** and unit-test every branch BEFORE moving the wiring.

**D3. `systems/inputDispatch.ts`** (#7) — keydown → `resolve()` → action, pending-sequence
buffering, then dispatch to movement / inventory / module / portals / focus. The spine.
*Breaks if:* sequence restart, preventDefault, or dispatch precedence changes.
*Test:* `keybindings.resolve` is tested; add a **characterization test** for the dispatch
*precedence* (dialogue > dest-menu > esc > bindings) and the pending-buffer restart, via a
pure dispatch function over fakes.

**D4. `roomHost.ts`** — the shell that wires B–D systems + the module registry, replacing
`renderRoom`'s orchestration. At this point `roomRenderer.ts` becomes a thin
`renderRoom = roomHost(codingModule-by-registry)` or is deleted in favor of `roomManager`
calling `roomHost` directly.
*Breaks if:* mount/teardown ordering or the `activeRoomTeardown` self-guard changes.
*Test:* a jsdom **smoke test** that mounts the hub then a level then back, asserting no
duplicate listeners and a clean teardown (the teardown registry is already unit-tested).

> **Rule of thumb honored:** pure/self-contained first (A,B), state-carrying next (C),
> input/focus/transitions LAST (D) — they are the most interconnected and least tested.

---

## 4. Test strategy

**Already safe (pure, unit-tested):** `room, keybindings, doors, progression,
portalColors, teardown, codeGameLogic, roomFeatures, codex`. Moving these (Phase A) is
proven by a green build + their existing tests.

**Currently UNTESTED systems that MUST get characterization tests before/with their move
(flagged):**

| System | Why risky | Test to add first |
|--------|-----------|-------------------|
| Input dispatch (#7) | precedence + sequence buffering, all DOM | pure `dispatch(state, key)` over fakes: precedence (dialogue/dest-menu/esc/bindings), dd/dw restart |
| Focus / esc ladder (#6) | branchy state machine | pure `nextEsc(state)` covering every branch |
| Transitions / portals (#11, D1) | strict ordering, manager coupling | assert **flash → slime removed → transition** order via injected fakes; dest-menu selection reducer |
| Dialogue (#9) | timers + focus suppression | beat-queue advance reducer; "active ⇒ gameplay suppressed" |
| Inventory (#4) | FIFO + full-drop/restore | pure inventory reducer (push/full/drop/confirm/cancel) |
| Camera sizing (#1) | fill/scroll thresholds | pure `computeTile`/`computeViewport` |

**Approach that fits the current setup:** vitest runs in **node (no jsdom)** today. Prefer
**extracting a pure core** from each risky system and testing *that* (keeps the no-jsdom
simplicity and gives the strongest behavior lock). Add **jsdom** only for the final
`roomHost` smoke test (D4) where DOM wiring itself is the thing under test. Each extraction
PR includes its characterization test in the same commit, written against the **pre-move**
behavior so it must stay green across the move.

---

## 5. Suspected dead / duplicate code — **DO NOT REMOVE NOW** (post-restructure pass)

Listed for a later, deliberate cleanup. Removing during restructuring risks conflating
two changes.

- **`engine/input.ts`** — `SCHEMES`, `keyToDirection`, `inputSettings`, `cycleScheme`,
  `SCHEME_ORDER`, `SCHEME_LABEL`, `MovementScheme` are superseded by `keybindings.ts`.
  Only the `Direction` interface still appears used (by `room.ts`). Suspect: the whole
  scheme machinery is dead; verify no importer before removing, and relocate `Direction`
  to `core/room.ts`.
- **`MOVE` in `roomRenderer.ts`** — duplicates `input.ts`'s `UP/DOWN/LEFT/RIGHT` vectors.
  Collapse to one source (in `core/`) during B3.
- **Card `codeRenderer.ts`** — may be unreachable now that code puzzles route through the
  room path (the hub's Coding portal → a *room* level; `open-003` has no room and isn't
  linked). Confirm it's never dispatched before treating as dead.
- **`.dpad` CSS** (`style.css`) — the on-screen D-pad. CLAUDE.md says it predates the
  keyboard-only rule. Still referenced by `gridArena.ts` (card games), so NOT dead while
  the card path lives — flag for the eventual card/room reconciliation, not now.
- **`validators/index.ts`** — the commented-out `setMatch` import (the file is already
  deleted). Dead comment line.
- **Possible unused `keybindings` exports** (e.g. `bindingsGlyph`) — verify usage before
  pruning.

---

## Execution checklist (per step)

- [ ] Characterization test added (for D-tier / untested systems) and green against current behavior
- [ ] Move/extract; update imports
- [ ] `npm run build` clean (tsc `noUnusedLocals`/`noUnusedParameters` will catch orphans)
- [ ] `npm test` green
- [ ] `npm run dev` manual smoke of the touched surface
- [ ] No new `if (puzzle_type === …)` / `if (language === …)` in `engine/`
- [ ] Commit (one step = one commit)
