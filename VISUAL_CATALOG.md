# VISUAL_CATALOG.md — every surface CSS can style, and what turns it on

A reference for **visual work**: what the engine draws, the exact class hooks it draws
with, and what the player has to do to make it appear. Written so a styling pass can be
planned without re-reading the engine.

**Relationship to the other style docs**

| Doc | Scope |
|---|---|
| `src/STYLE_TARGET.md` | the *look* being aimed at, **`code_build` only** — palette, mood, syntax colors |
| **this file** | the *inventory* — every surface across all types, its hooks, its trigger |
| `CLAUDE.md` Rule 5 | the *constraint* — style is scoped per puzzle type; never leak across |

Keep this file in sync when adding a surface. It is a map, not a spec: it says what exists
and how to reach it, never what it should look like.

---

## 0. Ground rules for anything styled here

These are not suggestions — they are constraints the engine's behavior depends on.

- **Keyboard-only (CLAUDE.md Rule 4).** Gameplay surfaces must never *need* hover or click
  to be understood or operated. Cues like the tutorial's "Enter ▸" pill are **labels, not
  buttons**. Mouse is allowed only for the settings gear, terminal drag, and room focus.
  Several gameplay layers set `pointer-events: none` deliberately — leave it.
- **Motion is `transform` / `opacity` only.** No layout thrash; the tile grid is re-laid on
  every resize and the camera translates the world wholesale.
- **Respect `prefers-reduced-motion`.** Where motion carries *meaning* (a token in flight is
  still catchable), keep the state visible and drop only the travel — see `.room-ricochet`.
- **Scope per puzzle type.** The room container carries `room-type-<puzzle_type>`; use it to
  keep a look from leaking into another type's renderer.
- **Timing constants are shared with JS.** Any animation that has to line up with a real
  deadline (despawn, ricochet) must match the constant in §6, or the visuals lie.

---

## 1. Player actions → what appears

All bindings are **rebindable** except where noted. Two schemes ship (`standard`, `vim`);
the table gives standard first. Bindings live in `src/engine/core/keybindings.ts`.

| Action | Standard | Vim | Purpose | What it draws |
|---|---|---|---|---|
| `up` `down` `left` `right` | arrows **and** WASD | `hjkl` | walk | `.slime[data-facing]` flips, `.slime.moving` squish, `.room-dust` at the departed cell |
| `pickup` | `E` | `dw` | take a token / toggle inventory focus | `.room-sparkle`, `.room-inventory.focused` |
| `place` | `P` | `P` | lay the held token into the puzzle | `.tile-placed` (module layer) |
| `drop` | `Q` | `Q` | throw the held token on the floor | `.room-dropped`, or `.room-ricochet`, or `.room-void-puff` — see §2 |
| `interact` | `Enter` | `Enter` | Build / Run / talk / doors | terminal write, dialogue, `.room-destmenu` |
| `task` | `T` | `T` | show/hide the goal prompt | `.task-overlay-scrim` (freezes the board) |
| `help` | `?` | `?` | reveal a meaning (vocab) | `.vocab-help` |
| `undo` | `U` | `U` | undo a board move | board re-render |
| `reset` | `R` | `R` | reset the board | board re-render |
| `debug` | `` ` `` | `` ` `` | position readout | `.room-debug` |
| `clearLine` | — | `dd` | clear the current code row | `.tile-placed` removed |
| `deleteToken` | — | `x` | delete the placed token under you | `.tile-placed` removed |
| **slot select** | **`1`–`9`** | **`1`–`9`** | choose the held hotbar slot | `.room-inventory-slot.selected` moves |
| **menu / back** | **`Esc`** | **`Esc`** | the esc ladder | closes the topmost overlay, else opens settings |

`Esc` and the digits `1`–`9` are **fixed conventions, not rebindable** — `Esc` drives the
esc ladder (`RESERVED_KEYS`), and the digits are honored because the hotbar draws those
numbers on the slots themselves (`systems/inputDispatch.ts`).

**A pending vim sequence** (`d…`) waits `SEQ_WINDOW` for its next key. There is currently
no visual for "a sequence is pending" — a genuine gap if you want one.

---

## 2. The Q drop, in full

One keypress, four outcomes. Which one fires is decided by `resolveDropTarget`
(`src/engine/core/room.ts`) from the cell the slime **faces**.

| Outcome | When | Visual | Lifetime |
|---|---|---|---|
| **lands** | free floor ahead | `.room-dropped` + `.room-dropped-label`, small and bobbing | `DROP_TTL_MS`, then gone |
| **about to despawn** | `DROP_WARN_MS` left | `.room-dropped.expiring` blinks | until despawn |
| **void** | a pit or the room's edge ahead | `.room-void-puff` where it fell out of the world | one-shot |
| **bounce** | a wall ahead, free floor behind | `.room-dropped` lands *behind* the thrower | as "lands" |
| **ricochet** | nowhere to land at either end | `.room-ricochet` in flight, then caught or dropped | `RICOCHET_MS` |

The **ricochet flight is the mechanic, not decoration**: for `RICOCHET_MS` the token is in
the air, and that window is exactly the player's chance to step aside and make it land on
the cell they vacated. It must stay visible for the whole window. Custom properties
`--rx` / `--ry` carry the half-tile throw vector, set per throw by `roomHost.ricochet`.

**Walking over a `.room-dropped` reclaims it** with no keypress (fires `.room-sparkle`).

---

## 3. Persistent surfaces (always on screen in a room)

| Hook | Purpose | Notes |
|---|---|---|
| `.game-root`, `body.fullscreen-game` | the fullscreen host | `position: fixed; inset: 0` |
| `.room-topbar` | wooden HUD bar | holds the title and the gear |
| `.room-hud-title` | `metadata.concept` | the level's name |
| `.room-gear` | settings button | **the one mouse affordance in-room** |
| `.room-stage` → `.room-viewport` → `.room-world` | camera stack | viewport crops, world translates |
| `.room-tile-layer` | the floor grid | one div per cell |
| `.room-marker-layer` | hint-giver `?` | `.tile-hint-marker`, `.tile-hint-label` |
| `.room-pile-layer` | token sources | `.tile-pile`, `.tile-pile-label` |
| `.room-dropped-layer` | Q-dropped tokens | §2 |
| `.room-door-layer` | portals | `.tile-portal`, `-disc -glow -glyph -img -ring -swirl -label` |
| `.room-control-layer` | Build / Run | `.tile-control`, `.tile-control-<action>` |
| `.room-placed-layer` | placed code tokens | `.tile-placed`, `.tile-prefilled` |
| `.room-coding-zone` | the code region outline | only where a `coding_area` is declared |
| `.slime`, `.slime-body` | the player | `data-facing` = `up`/`down`/`left`/`right` |
| `.room-inventory` | the hotbar | `.room-inventory-slot`, `.room-inventory-num` |
| `.room-lowlight` | vision falloff | `lowlight` modifier only; vars `--lowlight-x/-y/-clear/-fall` |
| `.room-debug` | readout | `debug` action toggles |

**Tile kinds** on `.tile-room`: `.tile-floor` `.tile-wall` `.tile-door` `.tile-pit`, plus
`.tile-void` on any cell that swallows a thrown token (an authored pit **or** a wall on the
room's outermost ring). `.tile-void` must read as a *hole*, not a surface — it is the only
signal distinguishing "bounces back" from "gone forever."

**Token variants** on piles/placed: `.tile-token-punct` (punctuation bead),
`.tile-token-decoy` (tray-only distractor tell).

---

## 4. Overlays — surfaces that take over

Ordered by z-index. Each states what suppresses gameplay input while it is up.

| Hook | Trigger | Freezes board? |
|---|---|---|
| `.room-dialogue` (+ `-portrait -box -name -text -cue`) | a speaker beat | yes, unless the beat has `waitFor` |
| `.room-narrator` (+ `-cue`) | a narrator beat | same |
| `.tutorial-card-scrim` → `.tutorial-card` | a `guided_tutorial` beat | yes; `.tutorial-card-scrim--live` on a `waitFor` step docks it **undimmed** so the player can see the mechanic |
| `.task-overlay-scrim` → `.task-overlay-card` | `task` action (`T`) | **yes** — total freeze |
| `.room-destmenu` (+ `-card -title -tag -hint`) | door / menu portal | yes |
| `.room-settings-panel` → `.room-settings-card` | gear or `Esc` on a plain room | yes (owns its own key handler) |

Tutorial card internals: `-head -badge -module -demo -caption -foot -dots -dot -skip -pill`.
Task overlay internals: `-head -desc -output-label -output -foot`.

**The `.tdemo-*` family** is the tutorial card's mini-demos — one per `TutorialDemo` kind
(`move interact pickup place drop build run enter_door push combine prefilled loop indent
function argument shuffle lowlight`). Each is a small self-animating diagram; adding a kind
means adding both a `buildDemo` case and its CSS.

---

## 5. Transient effects (fire and forget, self-removing)

| Hook | Fires on | Duration |
|---|---|---|
| `.room-dust` | every completed step | 600ms |
| `.room-sparkle` | a successful pickup (manual or walk-over) | 700ms |
| `.room-void-puff` | a token lost to a pit or the edge | 700ms |
| `.room-ricochet` | a token with nowhere to land | `RICOCHET_MS` |
| `.slime.moving` | during a step | 140ms |
| `.slime.arriving` | room entry (portal pop) | 600ms |
| `.room-dialogue-portrait.talking` | while a portrait beat "speaks" | ~length of the line |

---

## 6. Timing constants — keep CSS in sync

Animations tied to these must match, or the visuals misreport the rules.

| Constant | Value | Where | Governs |
|---|---|---|---|
| `DROP_TTL_MS` | 8000 | `roomHost.ts` | dropped-token lifetime |
| `DROP_WARN_MS` | 2000 | `roomHost.ts` | how long `.expiring` blinks first |
| `RICOCHET_MS` | 400 | `roomHost.ts` | flight time **and** the dodge window |
| `AUTO_PAUSE` | 1700 | `systems/dialogue.ts` | auto-advancing beat dwell |
| `AUTO_LEN` | 48 | `systems/dialogue.ts` | chars under which a beat auto-advances |
| `SEQ_WINDOW` | 600 | `systems/inputDispatch.ts` | pending vim sequence |
| `CAPTURE_WINDOW` | 320 | `systems/settingsPanel.ts` | rebind capture commit |
| `RESIZE_DEBOUNCE` | 120 | `roomHost.ts` | relayout coalescing |
| `FIXED_TILE` | 40 | `roomHost.ts` | minimum tile px |
| `HUD_H` / `HUD_GAP` | 48 / 10 | `roomHost.ts` | hotbar strip geometry |
| `TERM_DOCKED_H` | 200 | `puzzles/coding/terminal.ts` | docked terminal band |

Tile size is **computed from the window** and passed into every layer — never assume 40px.
Font sizes inside tiles are set inline as a fraction of the live tile.

---

## 7. Content-driven variation

The engine never derives a look from a language (Rule 1). These are the only axes:

- **Puzzle type** — `room-type-<puzzle_type>` on the container. Closed set.
- **Theme skin** — `room-theme-<theme>` when the pack declares one.
  Closed set: `grove` · `tropical` · `library` · `tech`.
- **Modifiers** — `randomized` re-deals tile positions (no class); `lowlight` mounts
  `.room-lowlight`.
- **Token kind** — `punctuation` / `decoy` add the classes in §3.

---

## 8. Per-type board surfaces

Room modules, all reachable in the shipped game:

| Type | Hooks |
|---|---|
| `logic_rules` | `.logic-board-layer` `.logic-cell` `.logic-cell-box` `.logic-word` `.logic-room-banner` `.logic-hud` `.logic-moves-chip` `.logic-stars` |
| `grammar_build` | `.grammar-word-layer` `.grammar-slot-layer` `.grammar-word` `.grammar-slot` `.grammar-slot-label` `.grammar-banner` `.grammar-hud-chip` `.grammar-stars` |
| `vocab_match` | `.vocab-tile-layer` `.vocab-help-layer` `.vocab-cell` `.vocab-prop` `.vocab-prop-sign` `.vocab-prop-glyph` `.vocab-banner` `.vocab-hud-chip` `.vocab-stars` |
| `code_build` | the coding layers in §3 + `.room-terminal*` |

---

## 9. Legacy / dev-only — check before styling

`src/engine/renderers/` holds the original **card** renderers (`matchRenderer`,
`combineRenderer`, `sentenceRenderer`, `codeRenderer`) with their own class families
(`.arena` `.play-area` `.block` `.slot` `.combine-bowl` `.code-editor` `.dpad`, and the
state classes `here` `press` `step` `eject` `seated` `dud` `solved` `flash`).

**These are not reachable in normal play.** Every hub portal leads to a room-based puzzle;
the card path is behind the `DEV`-only, Alt-modified switcher in `main.ts`. Styling effort
spent here is probably wasted — confirm the surface is reachable first.

Also legacy: `#app .stage`, the card-layout shell, wired only to that same dev switcher.

---

## 10. Known gaps (candidates for visual work)

Real holes, each one a place where a rule exists but nothing on screen says so:

1. **A placed token outside the coding area is silently ignored by Build/Run** but renders
   identically to one inside it. `currentProgram()` filters by `room.codingArea`; the
   renderer does not. `STYLE_TARGET.md` already prescribes the fix — neutral off the zone,
   syntax-colored inside it.
2. **Syntax coloring by token role is unimplemented.** `.tile-placed` uses one brown for
   every role; `STYLE_TARGET.md` specifies five.
3. **Piles look finite but are infinite** — `tryPickup` never consumes one. Nothing says
   "there is more here."
4. **A pending vim sequence has no indicator** (see §1).
5. **`EnvClue` is a schema hook with no rendering at all** (`schema/types.ts`).
