# MONSTER_THIEF_PLAN.md — bugs that eat the code you already placed

## The mechanic

A second monster BEHAVIOR, alongside the existing loot-carrier (see `MONSTER_LOOT_PLAN.md`).
A **thief** does no damage to the player — there is no player health in this game, and there
still isn't. It damages your **program**:

1. it spawns and telegraphs like any monster (indicator → delay → attackable);
2. once active it **hunts a token you have placed**, walking toward it;
3. it **takes** that token off the board — your line is now broken and un-Built;
4. it carries the stolen token while a **digest timer** runs;
5. **kill it in time → it drops what it took**, as ordinary floor loot you can re-place;
6. **run out of time → the token is digested (gone)** and the thief goes after another one.

The pressure is the digest window. The punishment is never "you lost the level" — it is "you
have to fetch that word again", which is why respawning sources are load-bearing (§6).

Thematically these are **bugs**: something got into your code and is eating it. The engine
calls the behavior `thief` (mechanical, language-agnostic); content names the creature.

---

## 1. Lifecycle

The existing phases stay; the thief adds a carry state and two timers on top.

```
 down ──(respawn_ms)──▶ telegraph ──(spawn_delay_ms)──▶ active
                                                          │
                                        ┌─────────────────┴──────────────────┐
                                        │ hunting: walks toward the nearest   │
                                        │ stealable placed token             │
                                        └─────────────────┬──────────────────┘
                                                          │ reaches it
                                                          ▼
                                              carrying (digest_ms running)
                                                    │            │
                              killed ───────────────┘            └─── timer expires
                                    │                                        │
                            drops the stolen token                  DIGESTED — token gone
                            (ordinary floor loot)                           │
                                    │                             steal_cooldown_ms, then
                                    ▼                                   hunt again
                                  down ──▶ respawn
```

- A thief carries **one** token at a time.
- Killing it at ANY point in `carrying` returns the token — the whole window is a rescue window.
- Killing it while merely `hunting` drops nothing (it holds nothing). A thief's own `token`
  field becomes optional: an empty-handed thief is not a loot piñata.

---

## 2. The module seam (the part that must not break Rule 1)

Placed tokens belong to the **coding module**, not the engine. The engine's monster system
must never learn what a "placed token" is. So the theft goes through two new OPTIONAL methods
on the existing `MountedPuzzle` boundary (`src/engine/puzzleModule.ts`), siblings of `occupies`:

```ts
/** Cells holding an object a room hazard may TAKE. Omitted ⇒ the module offers none,
 *  and thieves in that room simply never find a target. */
stealTargets?(): Cell[];
/** Take the object at `cell`, returning its token, or null if it isn't takeable
 *  (already gone, locked scaffolding). The module updates its own board state. */
takeToken?(cell: Cell): string | null;
```

The coding module implements them over `placed[]` (`src/puzzles/coding/codingArea.ts`):

- **only unlocked tokens** — `locked` prefilled scaffolding is provided structure, and
  stealing it could make a `mixed`-tier level unsolvable (`codingArea.ts:312` already treats
  locked as untouchable for the player; the same rule applies to monsters);
- **only inside the coding area** — that is where a missing token actually costs you, and it
  keeps a staging pile of tokens parked on the floor safe;
- `takeToken` calls the existing `dirtyLine()`, so a robbed line must be **Built again**
  before it will Run. The theft changes the program, and the build state has to say so.

Any future room type gets thieves for free by implementing the two methods; a room that
doesn't (logic, vocab, grammar) is unaffected.

---

## 3. Schema (content-facing)

```ts
/** What a monster DOES. Closed set — the engine dispatches, content picks. */
export type MonsterBehavior = "carrier" | "thief";   // omitted ⇒ "carrier" (today's behavior)

interface MonsterDef {
  behavior?: MonsterBehavior;
  token?: string;        // now OPTIONAL: a thief may carry nothing of its own
  …                      // pos / hp / glyph / name / kind unchanged
}
interface MonsterConfig {
  digest_ms?: number;          // the rescue window (default 6000)
  steal_cooldown_ms?: number;  // after a theft or a digest, before it hunts again (default 2500)
  …                            // spawn_delay_ms / respawn_ms / move_ms / loot_ttl_ms unchanged
}
```

`MonsterDef.token` going optional is the only backward-compatibility risk; existing levels
set it, and the carrier path keeps requiring it (validated per behavior — §7).

---

## 4. Pure logic (`src/engine/core/monsters.ts`)

New state on `MonsterSlot`: `carrying: string | null`, `digestLeft: number`, `cooldownLeft: number`.

New pure functions, all DOM-free and tested:

- `chaseStep(from, targets, room, isFree, rng)` — one greedy step along the axis that closes
  the larger gap to the nearest target; falls back to `wanderStep` when boxed in or when
  there are no targets. Deliberately dumb: predictable is fair, and pathfinding is not the
  fun here.
- `stealableFrom(cell, targets)` — is a target ADJACENT (or under) this cell?
- `beginCarry(slot, token, timings)` / `digest(slot, timings)` — the two carry transitions.

`advance()` grows two events the DOM layer acts on: `{kind:"steal", slot, cell}` (the engine
then calls `takeToken`) and `{kind:"digested", slot, token}`.

---

## 5. Making it READ as a problem

This is the requirement that decides whether the mechanic is fun or infuriating. Every stage
gets a tell, and none of them is subtle:

| Stage | Hook | Must communicate |
|---|---|---|
| a thief at all | `.tile-monster-thief` | this one is not the same kind of thing as a loot carrier |
| hunting | `.tile-monster.hunting` + `.room-steal-target` on the tile it wants | **which token is about to go**, before it goes |
| the grab | `.room-steal-flash` on the robbed cell | something was taken from HERE |
| carrying | `.tile-monster.carrying` + the stolen token drawn on the monster | **what** it has, so you know what you're rescuing |
| the clock | `.tile-monster-digest` — a ring/bar draining over `digest_ms` | how long you have; must be readable at tile size |
| digested | `.room-digest-puff` | that token is gone, not misplaced |

Two more, because a robbed program is easy to miss while you are across the room:

- the build goes dirty on theft (mechanical, above) — the Run error already names it;
- a HUD tell while any thief is carrying (`.room-alert`), so "there is a problem right now"
  is visible without scanning the floor.

`VISUAL_CATALOG.md` gets a §2c with all of it, plus the new timing constants.

---

## 6. Fairness rules (write them down, or they get "optimized" away later)

1. **No theft while input is blocked.** If a dialogue/tutorial/task overlay is up, the player
   cannot respond — thieves hold. (Host already tracks all three states.)
2. **Locked/prefilled tokens are immune.** Scaffolding is not the player's to lose.
3. **Nothing is unrecoverable.** A digested token must be re-obtainable: piles are infinite,
   and monster slots respawn. A level whose only source of a token is a one-shot is a level a
   thief can softlock — §7 makes that a load-time error, not a playtest discovery.
4. **One token at a time**, and a cooldown after each theft/digest, so a single thief can't
   strip a finished program faster than a player can react.
5. **A thief announces before it takes** (`hunting` + the target marker), for at least one
   wander tick.
6. **Still no damage to the player.** No health, no knockback, no stun.

---

## 7. Validation (`src/generation/validateRepair.ts`)

Extend the monster checks:

- `behavior: "carrier"` (or omitted) still requires a non-empty `token`.
- A room declaring any thief must have, for **every token in every accepted solution
  variant**, a re-obtainable source: a pile, a respawning monster carrying it, or locked
  prefilled scaffolding. This is the softlock guard for rule 6.3.
- `digest_ms` / `steal_cooldown_ms` must be > 0 when set.

The existing `packPlaythrough` lint (already teaches "pile, monster loot, or scaffolded")
extends to assert the same thing from the content side.

---

## 8. Content

One new level, `py-code-bugs-000` ("Debugging", ladder rung `hunted`, opens after Pack Hunt):
tokens come from piles (so the fight is *about* the thieves, not about fetching), one or two
thieves patrol the coding area, and the program is long enough that losing a token stings
without being a restart. Plus a shared tutorial `mechanic:thieves`:

1. informational + demo — "something in here eats code, not you";
2. informational + demo — the hunting tell and the digest ring: kill it before the ring empties;
3. `waitFor: "attack"` — kill the one that just took your token and watch it drop.

That needs a new `TutorialDemo` kind (`steal`) and its `buildDemo` case + CSS.

---

## 9. Tests

- **Pure**: chase converges on a target; boxed-in falls back to wander; carry → digest empties
  and fires `digested`; kill mid-carry returns the token; cooldown gates the next hunt.
- **System** (jsdom + fake timers): steal calls `takeToken` exactly once; the stolen token is
  drawn on the monster; killing it spawns the loot; letting the timer run spawns the puff and
  no loot; a thief never targets a locked token.
- **Host e2e** (synthetic arena, `move_ms` frozen): place a token → thief takes it → the board
  shows one fewer `.tile-placed` and the build is dirty → kill it → loot on the floor → walk
  over → re-place → Build/Run solves.
- **Fairness**: no theft fires while a tutorial card is up.

## 10. Order of work

1. schema + pure model + its tests → 2. the `MountedPuzzle` seam + coding module impl →
3. system drawing/timers → 4. host wiring + input-blocked guard → 5. CSS + `VISUAL_CATALOG` →
6. validation + lints → 7. content level + tutorial → 8. `npm run build` + full suite.

---

# Part B — finish what's unfinished

Shipped alongside the thieves, because both are "the room is fighting you" surfaces and both
land in the same files. Each item below was verified in the code, not assumed.

## 11. Quit — currently a dead row

`settingsPanel.ts:186` ships `["Quit", null]` — a **disabled button wearing a "coming soon"
chip**. It is the only entry in the settings menu that does nothing, and the smoke test
pins that state (`roomHost.smoke.test.ts:302` expects the literal `"Quitcoming soon"`).

**Wanted:** Quit leaves the room and returns you to the **title screen** — the same landing
page `main.ts:288` shows at boot (`showTitleScreen(bootHub)`), with Start / Achievements.

The wiring, following the existing callback chain rather than reaching across layers:

1. `SettingsPanelDeps` gains `onQuit?: () => void`. Omitted ⇒ the row keeps its
   "coming soon" state, so any host that can't honour it degrades exactly as today.
2. `RoomCallbacks` (roomHost) gains `onQuit?: () => void`, passed straight through — the
   host does not decide what quitting means, same as `onDoor` / `onSolved`.
3. `roomManager` forwards it, and **tears the active room down** first: `activeRoomTeardown`
   already exists and must run, or the room's listeners/timers (including the monster clock)
   outlive the title screen.
4. `main.ts` supplies the real behaviour: teardown → hide the fullscreen host (`useCard()`
   already does the class/hidden juggling) → `showTitleScreen(bootHub)` again.

**Title screen re-entry is the risk.** `showTitleScreen` currently runs ONCE at boot; it
registers a `window` keydown listener and removes it in `start()`. Quitting twice must not
stack two listeners, so re-entry needs the same guard the room teardown uses: remove any
existing `.title-screen` node and its listener before building a new one.

**Confirm before quitting.** An in-room program is not persisted (unlocks are; placed tokens
are not), so a mis-keyed Quit silently discards work. Quit opens a two-row inline confirm
("Quit to title" / "Cancel") inside the same panel — keyboard-only, same nav rows, no
browser dialog.

**Also update:** the smoke test's menu assertion, and a new test that Quit tears the room
down (no `.room-world` left) and lands on `.title-screen`.

### Other unfinished things found in the same sweep

Listed for a decision, not silently included — each is a separate piece of work:

| Item | State | Verdict |
|---|---|---|
| `Quit` | disabled stub | **fix now** (above) |
| `EnvClue` / `mechanics.envClues` | schema hook, renders nothing (`types.ts:65`) | leave — needs a decor design pass first |
| `TutorialBlock.demoLevel` | schema hook, never read (`types.ts:423`) | leave |
| `execution_match` validator | deliberately unregistered (Rule 3) | leave — the rule says no execution |
| `locked_languages` (JS / SQL rows) | greyed by design, not a bug | leave |
| Legacy card renderers | dev-only, unreachable (`VISUAL_CATALOG` §9) | leave |

## 12. Overlays that can grow past the screen

Two full-screen chooser cards have **no `max-height` and no `overflow`**, so once their list
outgrows the window the extra rows render off-screen with no way to see them:

- **`.room-destmenu-card`** (`style.css:1020`) — the destination chooser ("Where to?" →
  language → mechanic → level). This is the one that bites first: the keyboard cursor still
  moves onto rows that are off-screen, so you can select a level you cannot see. Today's two
  hunt levels plus the new `Hunted` rung already lengthened it, and every future level adds a
  row.
- **`.room-settings-card`** (`style.css:455`) — the Controls tab lists every action × 2
  binding slots, and it just grew by two rows (`attack`, `inventory`).

**The fix, both surfaces:**

1. `max-height: min(78vh, …)` + `overflow-y: auto` on the scrolling region (the row list,
   not the card, so the title and the nav hint stay pinned while the middle scrolls).
2. **The cursor must drag the view with it** — gameplay is keyboard-only, so a scrollbar
   alone fixes nothing. `paintNav()` / the destination menu's cursor paint both call
   `scrollIntoView({ block: "nearest" })` on the focused row.
3. Replace the hardcoded scroller lookup at `settingsPanel.ts:417` (`.room-settings-achievements`)
   with a generic "the scrollable region of the current view", so every long sub-tab gets
   arrow-key scrolling instead of only the achievements tracker.
4. A top/bottom fade or a "▾ more" tell, so a cut-off list is visibly cut off rather than
   looking like it simply ends.
5. `VISUAL_CATALOG.md` §4 gains the scroll behaviour for both overlays.

**Tests:** a jsdom test that a 30-level ladder produces a scrollable region and that moving
the cursor to the last row calls `scrollIntoView`; the same for a long Controls list.

> Ambiguity I resolved: "direction page" reads to me as the **destination chooser**, so that
> is item 1 and gets the fade/`▾ more` treatment. The settings card has the identical defect,
> so it is fixed in the same pass — if you meant only one of them, the other is still worth
> doing and costs a few lines.

## 13. Revised order of work

Part B first — it is small, it is pure UI, and a broken Quit / an unscrollable chooser makes
the thief levels harder to playtest:

1. §12 scrolling (both overlays) → 2. §11 Quit + confirm + title re-entry guard →
3. thief schema + pure model → 4. module seam + coding impl → 5. system + host wiring →
6. CSS + `VISUAL_CATALOG` → 7. validation + lints → 8. content level + tutorial →
9. `npm run build` + full suite.

---

## Decisions I made (say so if you'd rather go the other way)

- **Coding area only.** Thieves ignore tokens dropped on open floor; only placed code is at risk.
- **Digested = gone from the board**, re-fetchable from its original source. The alternative
  (it respawns at its pile) removes the sting entirely.
- **A thief drops only what it stole.** Empty-handed, it drops nothing — otherwise killing
  thieves becomes the cheapest way to farm tokens.
- **Thieves and carriers are separate monsters**, not one monster with both jobs.
- **Quit returns to the title screen, it does not close the app.** Even in the desktop shell,
  Quit means "leave the room", and the title screen is where you already choose to Start.
- **Quit asks first.** One extra keypress against silently discarding a half-built program.

## Out of scope

Player damage/health, thieves stealing from your inventory or from piles, coordinated packs,
pathfinding beyond a greedy step, and thief-vs-carrier interaction.
