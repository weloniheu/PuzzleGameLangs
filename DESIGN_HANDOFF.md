# DESIGN_HANDOFF.md — the next visual pass

For whoever picks up **design work** on this game next. It tells you what is queued, what
the code already promises, and which of your choices the engine will silently overrule.

The engineering is not the constraint here — every surface below already has stable class
hooks, its behaviour is covered by tests, and the game is playable end to end. What is
missing is a **look** for the newest surfaces, and one large one (monsters) that never had
one at all.

---

## 0. Read these first, in this order

| Doc | What it gives you | When |
|---|---|---|
| `CLAUDE.md` Rules 4 & 5 | the two constraints that can fail a change outright | before you touch CSS |
| `VISUAL_CATALOG.md` §0 | ground rules every styled surface depends on | before you touch CSS |
| `VISUAL_CATALOG.md` §1–§8 | the inventory: every hook, what turns it on, what it must not stop saying | look up your surface |
| `src/STYLE_TARGET.md` | the intended look — **`code_build` rooms only** | when styling the coding game |
| this file | what is queued, and the traps | now |

`VISUAL_CATALOG.md` is the map and it is kept current — trust it. This file is the
worklist and does not repeat it.

**Where the CSS actually lives** — this catches people out:

| Surface | File |
|---|---|
| Shared chrome (room frame, HUD, dialogue, menus, settings, the summary card) and the **coding** rooms | `src/style.css` — one file, sectioned by surface, search by class name |
| The **vocab** board | `ROOM_STYLE` template string at the top of `src/puzzles/vocab/index.ts` |
| The **grammar** board | same, `src/puzzles/grammar/index.ts` |
| The **logic** board | same, `src/puzzles/logic/index.ts` |

Each board module injects its own `<style>` on mount and drops it on teardown — that is
how Rule 5 scoping is enforced structurally for those three types. So `.vocab-tile` is
**not** in `style.css`, and a global change in `style.css` does not reach a board's own
classes. DOM is built in `src/engine/systems/*.ts` (shared) and `src/puzzles/<type>/*.ts`
(boards). No framework, no CSS-in-JS beyond those three strings, no build step past Vite.

---

## 1. Job one — the LEVEL COMPLETE card

### What it is

The window that opens **the instant a level is solved**, in every track (coding, vocab,
grammar, logic). It shows how the run went and hands the player the next level. It
replaced a settings toggle that used to pop the level chooser on a win.

This is the emotional peak of the loop — the only moment the game says "you did it" — and
right now it is wearing borrowed clothes. It is first on this list not because it is the
biggest job (the monsters are, see §2) but because it is small, self-contained, fully
covered by tests, and badly mismatched to the moment it serves.

### Where

| | |
|---|---|
| DOM | `src/engine/systems/levelSummary.ts` (`build()`) |
| CSS | `src/style.css`, search `LEVEL COMPLETE card` |
| Data | `src/engine/core/score.ts` — `ScoreCard { points, grade, stars, lines[] }` |
| Opened by | `src/engine/roomHost.ts` → `openSummary()` |
| Catalogued | `VISUAL_CATALOG.md` §4 |

### Honest state

Placeholder. It borrows the settings/chooser language wholesale — same wood gradient, same
chip rows, same pill buttons — because that was the fastest way to ship it working. The
result reads as a **preferences dialog**, not a reward. Nothing about the current look is
precious; only the DOM structure below is.

### The brief

Make it land as a *reward*, in this read order:

1. **the grade** — the thing the player looks at first and remembers;
2. **what the run cost** — four rows: time, steps, hints used, failed runs;
3. **where next** — the buttons, with the next level leading.

Things worth exploring: the grade arriving with weight (a stamp, a seal, a pressed
medallion) rather than sitting as text; the stat rows reading as a receipt or a ledger
rather than as settings chips; a card silhouette that is not the same rounded rectangle as
every menu in the game.

### Hooks — what you may and may not change

Every class here is written by `levelSummary.ts`, so renaming one **in CSS alone** does not
fail anything — the styling just silently stops applying. Rename in both places, or not at
all. `.selected` additionally carries meaning for the keyboard, and the rows below that say
*asserted* are checked by tests. Text content comes from TS, never from CSS.

| Hook | Holds | Yours to change? |
|---|---|---|
| `.room-summary` | fixed backdrop, z 61 | style freely; **keep `[hidden] { display: none }`** |
| `.room-summary-card` | the card box | freely |
| `.room-summary-banner` | the words `LEVEL COMPLETE` | style freely; text is asserted |
| `.room-summary-title` | the level's ladder name | freely |
| `.room-summary-grade` + `grade-S\|A\|B\|C\|D` | sets `--grade-ink` | recolour freely; **keep one class per grade** |
| `.room-summary-letter` | the grade letter | freely; text asserted as `[SABCD]` |
| `.room-summary-stars` | `★★☆` | freely |
| `.room-summary-points` | `NNN pts` | freely; format asserted |
| `.room-summary-stats` / `-row` / `-label` / `-value` | the four cost rows | freely; **row order and labels are asserted** |
| `.room-summary-penalty` | `−N`, rendered **only when that row cost something** | freely; keep the "clean run shows no red" rule |
| `.room-summary-actions` / `-btn` | the destination buttons | freely; **order and label text are asserted** |
| `.room-summary-btn.primary` | the headline choice | freely |
| `.room-summary-btn.selected` | **the keyboard cursor** | see below |
| `.room-summary-hint` | `↑↓ choose · Enter go · Esc stay here` | freely |

### Rules, not taste

- **`.selected` is the cursor, and hover must never imitate it.** Arrows move the
  selection; the mouse is secondary everywhere in this game (CLAUDE.md Rule 4). If hover
  and selection look alike, the player loses track of where Enter will go.
- **The way out has to stay on the card.** Esc dismisses back into the solved room. The
  hint line is currently how that is promised; if you drop the line, promise it another way.
- **The grade must not rely on colour alone.** The letter is the redundancy — keep it.
- **It can open on top of a talking character.** A module's success beat (z 50) is often
  still playing underneath (card is z 61). The card has to read as *over* the room, not as
  a second panel beside the dialogue.
- **It must survive four rows of any width** — "Failed runs" can read `12`, time can read
  `1:02:05`.

### Open questions (my recommendation, take or leave)

1. **Three encodings of the same thing** — letter, stars, points. *Recommend:* let the
   letter and stars carry it, demote points to a small footnote. Right now all three
   compete at similar weight.
2. **Penalty chips.** They only appear on rows that cost points, so a perfect run is
   silent. *Recommend:* keep that, and consider a positive tell for a zero-penalty row —
   the absence currently reads as "nothing happened" rather than "clean".
3. **Entrance motion.** One 260ms `summary-pop` today. *Recommend:* keep a single
   entrance; avoid per-row staggering — the tests drive this surface with fake timers, and
   `prefers-reduced-motion` has to fall back to instant (§0).
4. **Does the card want the level's theme?** The room underneath carries
   `room-theme-<skin>` (grove / tropical / library / tech). The card currently ignores it,
   so a win looks identical in every track. Themed would be richer; uniform is a stronger
   "this is the game speaking, not the level". Either is defensible — pick deliberately.

### Seeing it in 30 seconds

```
npm run dev
```

1. In the hub press **Esc** → Settings → **Controls** → **Test Mode: On** (unlocks every
   portal and every level; it is independent of Reset, so flip it back off to see real
   progress again).
2. Esc back out, walk to the 🌺 Language portal, Enter, then Enter through
   ʻŌlelo Hawaiʻi → Base → Tutorial.
3. **Esc** once more to skip the room's greeting and guided tutorial.
4. Solve it in eight presses: **↑ ← ← ← ↑ → → →**

The card opens on the last press. `↻ Play again` re-runs it for another look.

---

## 2. Standing queue, ranked

`VISUAL_CATALOG.md` §10 lists 13 real gaps. Ranked by what I would do after the card:

1. **Monsters, then thieves** (§10.6, .10, .11, .12, .13). The largest surface in the game
   with nothing designed behind it: emoji glyphs on tinted pads. Five sub-surfaces
   (telegraph/active, hunting/carrying, digest bar, steal target, loot) that currently
   share no visual family. Two things must survive any pass: **telegraph and active have
   to stay unmistakably different** (that pair is the fairness promise — the game warns
   before it spawns), and **`.hunting` must stay distinct from `.carrying`** (the thief
   announces before it takes). Everything else is open.
2. **Syntax colouring by token role** (§10.1, .2). Already fully specified in
   `STYLE_TARGET.md` — five roles, five hexes, neutral off the board and coloured once
   placed — and simply not implemented. The cheapest large win in the coding rooms, and it
   also closes gap §10.1: a token placed outside the coding area is ignored by Build/Run
   but looks identical to one inside it.
3. **Piles look finite but are infinite** (§10.3). A rule with nothing on screen saying so.
   Players ration a resource that cannot run out.
4. **Quit vs Reset** (§10.9). "Leave to title" and "erase all progress" currently wear the
   same red. A real hazard wearing a styling bug.
5. **Small change, real clarity:** the scroll-edge fade matching its gradient (§10.8), and
   an indicator for a pending vim sequence (§10.4).

---

## 3. Three ways a change fails

- **Scope leak (CLAUDE.md Rule 5).** A look for one puzzle type must not reach another.
  The container carries `room-type-<puzzle_type>`; scope with it. Shared chrome (settings,
  chooser, dialogue, the summary card) is deliberately shared — changing it changes every
  track, so do that on purpose.
- **An unsynced catalog.** Adding or changing a hook, a state class, a `@keyframes`, or a
  timing constant means updating `VISUAL_CATALOG.md` **in the same change**. A Stop hook
  (`.claude/hooks/check-visual-catalog.sh`) checks the diff and will tell you — but the
  obligation is the rule, not the hook.
- **A mouse-only affordance.** Nothing in gameplay may *require* hover or click. Cues like
  the tutorial's "Enter ▸" pill are labels, not buttons.

---

## 4. Traps — things that look like styling and are not

1. **`transform` is POSITION on every cell-positioned box.** Tiles, piles, placed tokens,
   monsters and dropped items are placed with `translate(x*tile, y*tile)` inline. A CSS
   animation with a `transform` outranks the inline one and **parks the element at the
   world origin**. Animate a child instead — `.room-dropped` already learned this the hard
   way (its bob lives on `.room-dropped-label`).
2. **Font sizes inside tiles are set inline, in JS, as a fraction of the live tile size.**
   A `font-size` in CSS will be overridden. Change the fraction in the module that draws it.
3. **Tile size is computed from the window** (`systems/camera.ts`). Never assume 40px, and
   never hardcode a pixel size that has to line up with a cell.
4. **Some timing is shared with JS** (`VISUAL_CATALOG.md` §6). A despawn blink that
   disagrees with `DROP_TTL_MS`, or a ricochet that ends before `RICOCHET_MS`, makes the
   visuals *lie* about the rules — those two in particular are gameplay-critical windows.
5. **`[hidden]` needs help.** Any rule that sets `display: flex/grid` on a surface that
   hides via the `hidden` attribute must also ship `&[hidden] { display: none }`, or it
   never hides.
6. **The overlay ladder is load-bearing:**

   | z | Surface |
   |---|---|
   | 50 | `.room-dialogue`, `.room-narrator` |
   | 58 | `.tutorial-card-scrim`, `.task-overlay-scrim` |
   | 60 | `.room-settings-panel`, `.room-destmenu` |
   | 61 | `.room-summary` — above the chooser, because its own ☰ button opens it |
   | 100 | `.title-screen` |

   These match the input precedence in `systems/inputDispatch.ts`. If a surface looks like
   it is on top but does not own the keyboard, the two have drifted apart.
7. **Theme skins are content's call.** A pack declares `theme`, the engine stamps
   `room-theme-<token>` (`grove` · `tropical` · `library` · `tech`). Style the token; never
   branch on a language or a level.
8. **The card renderers in `src/engine/renderers/` are unreachable** in normal play
   (`VISUAL_CATALOG.md` §9). Confirm a surface is reachable before spending a day on it.

---

## 5. Verifying a pass

```
npm run build     # typecheck + build; never hand off red
npm test          # 937 tests, ~20s
npm run dev       # play it — the only way to judge a look
```

**Tests assert on DOM, not on appearance.** Colours, sizes, spacing, motion and shape are
entirely yours. What some tests do pin: element structure, a handful of class names, the
state classes that carry rules (`.selected`, `.matched`, `.telegraph`, `.active`,
`.expiring`), and text content.

Note the asymmetry: a class renamed **in the TS** fails loudly; a class renamed **in the
CSS only** fails silently — the rule just stops matching. So grep both sides first:

```
grep -rn "your-class-name" src --include="*.test.ts"
```

Two suites are worth knowing about because they drive real surfaces end to end:
`src/engine/roomHost.smoke.test.ts` (mounts real packs and plays with real key events) and
`src/puzzles/*/levelCompletion.test.ts` (solves every level in the game).

---

## 6. Done means

- it looks right in `npm run dev`, at more than one window size (the tile size follows the
  window, so a look that only works at one size is not finished);
- `npm run build` and `npm test` are green;
- `VISUAL_CATALOG.md` is updated in the same change — new hooks, new state classes, new
  keyframes, new timing constants;
- `prefers-reduced-motion` still leaves every state legible;
- and if the pass changed what a surface *promises* (not just how it looks), the rule it
  encodes is still readable on screen — that is the one thing in this codebase that is
  never a style decision.
