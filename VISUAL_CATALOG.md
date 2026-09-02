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
| `pickup` | `I` | `dw` | take the token under you | `.room-sparkle` |
| `inventory` | `E` | `E` | open/close the hotbar cursor | `.room-inventory.focused` |
| `place` | `P` | `P` | lay the held token into the puzzle | `.tile-placed` (module layer) |
| `drop` | `Q` | `Q` | throw the held token on the floor | `.room-dropped`, or `.room-ricochet`, or `.room-void-puff` — see §2 |
| `attack` | `F` | `F` | swing at the cell you face | `.room-attack-swipe` always; `.tile-monster.hurt` on a hit — see §2b, §2c |
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

**Solving a level** is the one "action" with no key: the moment a module reports it, the
LEVEL COMPLETE card (`.room-summary`, §4) opens over the room and takes the keyboard —
movement bindings drive its cursor, `Enter` travels, `Esc` dismisses it back into the room.
Whatever the run cost is scored there (`core/score.ts`), off four things the engine counts
for every puzzle type: elapsed time, steps walked, hint-giver lines served, and failed
solve attempts a module reported through `ctx.reportMiss()`.

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

The bob animation lives on `.room-dropped-label`, **not** on `.room-dropped` — the box's
`transform` is the cell POSITION, and an animation's transform outranks an inline one, so
animating the box parks every dropped item at the world origin. Same rule for `.expiring`.

---

## 2b. Monsters — the other token source

Feature-gated (`features: ["monsters"]` + a `monsters` table in the room). A monster is a
pile that walks: instead of standing on a token and pressing pickup, you fight the thing
carrying it. Lifecycle (`core/monsters.ts`, drawn by `systems/monsters.ts`):

```
 down ──(respawn_ms)──▶ telegraph ──(spawn_delay_ms)──▶ active ──(hp hits)──▶ down
```

| Phase | Hook | Solid? | Attackable? | Reads as |
|---|---|---|---|---|
| telegraph | `.tile-monster.telegraph` | **no** | **no** | a `!` pulsing on a floor cell — "something is arriving here" |
| active | `.tile-monster.active` | **yes** | **yes** | a body carrying a word, drifting a cell at a time |
| down | element `hidden` | — | — | nothing on screen; the slot is counting down to its next telegraph |

**The phase difference is a RULE, not decoration** — it is the whole content of the
indicator-then-delay promise, so the two states must never look alike.

Internals: `.tile-monster-glyph` (art/`!`), `.tile-monster-label` (the token it carries),
`.tile-monster-hp` (hearts, drawn only above 1 hp). `.tile-monster.hurt` flashes for
`MONSTER_HURT_MS` on a landed hit. The wander step is a CSS `transition` on `transform`,
so a monster slides between cells instead of teleporting.

**Body and accent are two separate reads** — three tokens declared on `.room-world` and
re-pointed by the host's `.room-theme-*`: `--mon-body` is the shared outer falloff every
monster in the room wears, and `--mon-carrier` / `--mon-hunt` are the two role accents that
fill the core. So "something is here" is one glance and "which kind" is the next, and both
belong to the room's world rather than to a fixed palette. Grove is the default the tokens
declare. Carrying is the deliberate exception: it reads gold in every skin (below).

**Attack** (`F`) always paints `.room-attack-swipe` on the faced cell — a miss has to read
as a miss, not as a dead key. Only an `active` monster on that cell takes damage.

**Defeat drops loot**: an ordinary `.room-dropped` item tagged `.room-loot`, with the
level's `loot_ttl_ms` instead of `DROP_TTL_MS`. Everything after landing (walk-over pickup,
the `.expiring` warn, despawn) is the §2 path unchanged. The drop also carries the accent of
the role it was fought off — `.room-loot-carrier` / `.room-loot-thief`, a thin ring in that
role's token — so it still reads as "came from that thing" once the body is gone. The role
travels from `systems/monsters.ts` out through `onLoot`'s `from` argument.

**Slots always respawn.** Piles are infinite, so no level can be stranded by a lost token;
monsters have to inherit that, because loot despawns and pits eat things. The respawn is
load-bearing — do not "fix" it away.

Everything above is `MonsterBehavior: "carrier"` (the default, unnamed in content). The other
behavior — `"thief"` — reuses this same phase machine but adds its own sub-state once active;
see §2c.

---

## 2c. Thieves — the monster that steals what you already placed

`MonsterBehavior: "thief"` (`schema/types.ts`, `core/monsters.ts`). Same telegraph/active
phase machine as §2b, but an active thief adds its own sub-state instead of just wandering:
it spawns EMPTY-HANDED, hunts a cell the room MODULE offers up (e.g. an unlocked placed code
token — `MountedPuzzle.stealTargets`), and reaching one takes it off the board.

```
active (thief) ──reaches a target──▶ carrying ──(digest_ms)──▶ digested
         ▲                              │ killed mid-carry            │
         └──────(steal_cooldown_ms)─────┴──── drops loot ─────────────┘
```

| Sub-state | Hook | Reads as |
|---|---|---|
| hunting | `.tile-monster.hunting` + `.room-steal-target` on every at-risk cell | prowling — announces BEFORE anything is taken, never after |
| the grab | `.room-steal-flash` on the robbed cell, one-shot | something was taken from HERE |
| carrying | `.tile-monster.carrying` + the stolen token drawn on the monster (not an authored name) | what you're rescuing, and that it's rescuable |
| the clock | `.tile-monster-digest` → `-fill` (a draining bar) | how long you have — `digest_ms`, made visible |
| digested | `.room-digest-puff` where it was carried, same "gone" language as `.room-void-puff` | that object is gone, not misplaced — but always re-fetchable from its ORIGINAL source |

**The announce-before-take rule is load-bearing, not decoration**: `.hunting` (and the
`.room-steal-target` markers) must be visible for at least one tick before a steal can land
— see core/monsters.ts's `advance()`. A styling pass must never make the hunting state
subtler than the carrying state; the whole fairness of the mechanic depends on the player
being able to see it coming.

**A thief that is merely hunting drops NOTHING when killed** — only a *carrying* thief pays
out, and only what it actually stole (`lootOf` in `core/monsters.ts`). Killing empty-handed
thieves must never become the efficient way to farm tokens.

**Frozen during blocked input**: while a dialogue beat, a tutorial step, the task overlay, or
the destination menu has taken over input, every thief's hunt/steal/digest clock stops for
that tick (`MonstersDeps.inputBlocked`) — a theft or a digest must never land while the player
literally cannot respond. Telegraphs, spawns, and carrier wandering are unaffected; this is
thief-only fairness, not a general room freeze.

The target markers and the two transients live in the SAME `.room-monster-layer` as §2b —
there is no separate thief layer.

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
| `.room-dropped-layer` | Q-dropped tokens **and** monster loot (`.room-loot`) | §2, §2b |
| `.room-monster-layer` | monsters | `.tile-monster` + `-glyph -label -hp -digest -digest-fill`, `.room-steal-target`; §2b, §2c |
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
| `.room-summary` (+ `-card`) | **a level is SOLVED** | yes — outranks everything, dialogue included |
| `.room-settings-panel` → `.room-settings-card` | gear or `Esc` on a plain room | yes (owns its own key handler) |

Tutorial card internals: `-head -badge -module -demo -caption -foot -dots -dot -skip -pill`.
Task overlay internals: `-head -desc -output-label -output -foot`.

**LEVEL COMPLETE card** (`systems/levelSummary.ts`) — the surface that opens the moment a
level room reports solved (only LEVEL rooms: it needs a ladder, so the hub never gets one).
Internals: `-banner -title -grade -seal -seal-shine -letter -stars -points -stats -row
-label -value -penalty -actions -btn -hint`. The grade is a pressed wax **seal**
(`.room-summary-seal`, a 76px medallion with `.room-summary-seal-shine` looping across it)
with the letter stamped into it; the stars are the second glance under it and the points
drop to a mono footnote. Its colour is `--sum-grade-ink`, one of five skin tokens
(`--sum-card --sum-border --sum-ink --sum-foot --sum-grade-ink`) declared on
`.room-summary-card` and re-pointed by the `.room-theme-*` the host already stamps on the
container — grove wood by default, then tropical teal/coral, library dark-academic, tech
blue-black. The stats read as a ledger, not chips: one hairline top and bottom, label left,
value right in mono digits, and a row only renders `.room-summary-penalty` when it actually
cost points, so a clean run has no red on it.
Buttons: the next rung of the ladder (or `⌂ Return to hub` when the ladder has nothing left
open) as `.primary` (a firmer border, so the headline choice still reads once the cursor
moves off it), then Play again / Choose a level / Return to hub. `.selected` — the gold
fill — is the keyboard cursor; hover is CSS-only, a faint lift on unselected rows
(`:hover:not(.selected)`) that never moves it. Esc dismisses back into the solved
room. It sits at z 61, one above `.room-destmenu` (z 60), because its own `☰` button opens
that chooser underneath it. Card entry: `@keyframes summary-pop`, 260ms.

> **Removed with it:** the Display tab's "Open menu on solve" toggle
> (`roomSettings.autoMenuOnSolve`). It existed to skip the walk back to the portal; the card
> does that job now, unconditionally, and offers the chooser as one of its buttons.

**Both `.room-destmenu-card` and `.room-settings-card` cap their height and scroll their
middle**, not the whole card: the title (destmenu) / head (settings) and the trailing hint
stay pinned; only the row list (`.room-destmenu-list`, inside `.room-destmenu-list-wrap`) or
the view body (`.room-settings-body`, inside `.room-settings-body-wrap`) scrolls. The
keyboard cursor drags that scroll with it (`scrollIntoView` on every cursor move — see
`systems/settingsPanel.ts` `paintNav()` and `systems/portals.ts` `renderDestMenu()`), and a
`.room-scroll-fade-top` / `-bottom` pair (`systems/scrollFade.ts`) fades in on whichever edge
is actually cut off, so a long list never silently looks like it simply ends. Both cards grew
this because their content is genuinely open-ended: the settings Controls tab is one row per
bindable action (16 and counting — attack/inventory are the newest), and the destination
chooser's level rung is one row per level in a track.

**Settings → Quit** is its own sub-screen (`view: "quit"`), not a click-through: the top menu
row opens a confirm ("Cancel" / "Quit to title") before `onQuit` ever fires, so a stray Enter
can never discard an in-progress room. Disabled ("coming soon") unless the host supplies
`onQuit` (main.ts wires it; other embedders of `mountRoom` may not).

**The `.tdemo-*` family** is the tutorial card's mini-demos — one per `TutorialDemo` kind
(`move interact pickup place drop attack steal build run enter_door push combine prefilled
loop indent function argument shuffle lowlight`). Each is a small self-animating diagram;
adding a kind means adding both a `buildDemo` case and its CSS. `steal` has no matching
`TutorialWaitFor` — the follow-up step that waits for the player to act reuses `attack`
(killing the thief that just took something IS the response).

---

## 5. Transient effects (fire and forget, self-removing)

| Hook | Fires on | Duration |
|---|---|---|
| `.room-dust` | every completed step | 600ms |
| `.room-sparkle` | a successful pickup (manual or walk-over) | 700ms |
| `.room-void-puff` | a token lost to a pit or the edge | 700ms |
| `.room-ricochet` | a token with nowhere to land | `RICOCHET_MS` |
| `.room-attack-swipe` | every `attack` press (hit or miss) | `ATTACK_SWIPE_MS` |
| `.tile-monster.hurt` | a hit that landed on an active monster | `MONSTER_HURT_MS` |
| `.room-steal-flash` | a thief's steal actually lands (§2c) | `STEAL_FLASH_MS` |
| `.room-digest-puff` | a thief's rescue window runs out (§2c) | `DIGEST_PUFF_MS` |
| `.room-summary-card` (`summary-pop`) | the level-complete card opening | 260ms |
| `.room-summary-seal-shine` (`summary-seal-shine`) | while the level-complete card is up | 2400ms, loops |
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
| `ATTACK_SWIPE_MS` | 220 | `systems/monsters.ts` | the swing mark's lifetime |
| `MONSTER_HURT_MS` | 200 | `systems/monsters.ts` | hit flash |
| `MONSTER_TICK_MS` | 100 | `systems/monsters.ts` | lifecycle clock resolution |
| `STEAL_FLASH_MS` | 260 | `systems/monsters.ts` | the grab flash's lifetime |
| `DIGEST_PUFF_MS` | 700 | `systems/monsters.ts` | the digest puff's lifetime |
| `MONSTER_DEFAULTS` | 1200 / 5000 / 700 / 20000 / 6000 / 2500 | `core/monsters.ts` | spawn delay · respawn · wander/chase step · loot TTL · **digest window · steal cooldown** (thief only) — each overridable per level (`MonsterConfig`: `digest_ms`, `steal_cooldown_ms`), so CSS must not hardcode them |
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
  Closed set: `grove` · `tropical` · `library` · `tech`. It tints the floor tiles and the
  viewport frame, and re-points two other token sets: the LEVEL COMPLETE card's `--sum-*`
  (§4) and the monsters' `--mon-*` body/role accents (§2b).
- **Modifiers** — `randomized` changes the layout (no class, nothing to style): coding
  piles and vocab/grammar word-tiles are RE-DEALT among their authored cells, while a
  rule board is MIRRORED whole instead (`mechanics.variants` — see
  `puzzles/logic/boardTransform.ts`), because its word tiles are the rules and a re-deal
  can strand them. `lowlight` mounts `.room-lowlight`.
- **Features** — a room builds only what it declares. `monsters` mounts
  `.room-monster-layer` (§2b); without it there is no layer and no clock at all.
- **Token kind** — `punctuation` / `decoy` add the classes in §3.
- **Frame labels** (`grammar_build`) — `.grammar-slot-label` is drawn only for a slot
  whose pack gave it a `label` ("who?", "does what?"). A pack that teaches its word
  order from the room tutorial and the task target instead (`grammar.room.haw`) ships
  slots with **no** label, and the frame draws as bare dashed boxes. Either way the
  label disappears once a word occupies the slot.

---

## 8. Per-type board surfaces

Room modules, all reachable in the shipped game:

| Type | Hooks |
|---|---|
| `logic_rules` | `.logic-board-layer` `.logic-cell` `.logic-cell-box` `.logic-word` `.logic-room-banner` `.logic-hud` `.logic-moves-chip` `.logic-stars` |
| `grammar_build` | `.grammar-word-layer` `.grammar-slot-layer` `.grammar-word` `.grammar-slot` `.grammar-slot-label` (content-optional — §7) `.grammar-banner` `.grammar-hud-chip` `.grammar-stars` |
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
6. **Monsters are placeholder art** (§2b): an emoji glyph, a tinted radial pad, and hearts.
   The hooks and phase classes are final; the LOOK is not — this is the largest surface in
   the catalog with nothing designed behind it. Two things must survive a styling pass:
   telegraph and active have to stay unmistakably different, and the carried token has to
   stay readable (it is the reason to fight the thing).
7. **A monster and the token it drops share no visual language** — `.tile-monster-label`
   and `.room-loot` are styled independently, so "that drop came off that monster" is
   currently inferred from timing alone.
8. **The scroll-edge fade (`.room-scroll-fade-top`/`-bottom`, §4) approximates its
   background instead of matching it.** It fades to `var(--panel-wood-hi)` /
   `--panel-wood-lo` (the CARD's gradient endpoints), which is close but not pixel-exact
   at every scroll position against a gradient background — fine as a functional tell,
   not yet a finished look.
9. **The Quit confirm screen (§4) borrows existing button classes** (`.room-menu-entry`
   for Cancel, `.room-settings-reset`'s red for "Quit to title") rather than having its
   own — functional, but "quit" and "erase all progress" currently look identical.
10. **Thieves (§2c) are placeholder art on top of placeholder art.** A carrier already had
    no finished look (gap 6); a thief adds `.hunting` (a brightness pulse), `.carrying` (a
    gold outline), the digest bar, `.room-steal-target`, `.room-steal-flash`, and
    `.room-digest-puff` — six more surfaces with real hooks and no design pass. The one
    constraint that MUST survive a redesign: `.hunting` has to stay legible and distinct
    from `.carrying` — that pair is the whole "announces before it takes" fairness rule
    (§2c), not a look either state can quietly lose.
11. **A carrier and a thief share no visual family beyond `.tile-monster`.** Nothing yet
    says "these are both monsters, just different jobs" at a glance — a carrier's warm-red
    glow versus a thief's cool-violet one is the only current distinction, chosen for
    contrast, not for a considered "monster taxonomy" look.
12. **The digest bar is a plain fill, not a ring or a clock face** — functionally clear
    (drains left-to-right over `digest_ms`) but the crudest possible rendering of "a
    countdown."
13. **`.room-steal-target` tints EVERY currently-offered cell**, not specifically the one
    cell the nearest hunting thief is actually beelining for — simpler to compute (see
    `systems/monsters.ts` `drawTargets`), and arguably fine (everything it marks really is
    at risk right now), but a future pass might want the "primary" target to read as more
    urgent than the rest.
