# Guided tutorial scripts

One script per puzzle type / room. Tone: cut-and-dry, no character voice, all ages.

**Plays once, ever, then stays quiet — always skippable while it's up.** Persisted (see
`core/codex.ts`'s seen-tutorial store), not a per-session or per-mount flag: a ROOM's own
`guided_tutorial` is seen once for that room (`room:<puzzle id>`); a SHARED tutorial
(`tutorial_refs`) is seen once **across the whole game**, so teaching a concept in one
level means it never replays in another that references the same id; a CARD-GAME tutorial
is seen once **per puzzle TYPE**, so the first match puzzle the player ever meets teaches
it and no later match puzzle (any language pack) replays it. Watching a tutorial to the
end and Escape-skipping it both count as "seen" — either way it won't play again on its
own. **"Replay Tutorials" in Settings** is the deliberate way back in: it clears the seen
state (without touching earned progress) so every tutorial plays again on next entry.

Every card still advertises the way out on every step ("Esc — skip"), and Escape ends the
whole opening sequence — greeting included — in a single press, whether the player is
skipping something new or something they'd already seen before a "Replay Tutorials" reset.

The `on_enter` story/greeting beats (snake dialogue, room flavor) are NOT part of this —
those are content, not teaching, and play on every entry same as always.

Escape reaches the tutorial through the room's **esc ladder** (`systems/focus.ts`), as the
last rung before "open settings". Nearer claims on Escape still win: a `waitFor` step
leaves gameplay live, so if the player has the inventory or a menu open, Escape closes
that first and skips the tutorial on the next press.

**Two delivery mechanisms, one authoring shape** (`DialogueBeat[]`, field
`guided_tutorial` — see `src/schema/types.ts`):

- **Room world** (hub, code puzzles): `payload.dialogue.guided_tutorial`, played
  through the dialogue presenter (`systems/dialogue.ts`) — appended after `on_enter`
  story beats. The run is `guarded`: side dialogue (errors, blocked doors, hints)
  interjects and the tutorial resumes at the same step, rather than being talked over.
  `guarded` is independent of `skippable` — the game cannot clobber a tutorial, but the
  player can always leave it.
- **Card games** (match, combine, sentence_build): `payload.guided_tutorial`, played
  by the lightweight bar (`systems/tutorialOverlay.ts`), which handles its own Escape
  and its own seen-check (keyed `type:<puzzle_type>` — see above).

Step mechanics (both mechanisms):

- `waitFor: <TutorialWaitFor>` — the step stays until the player actually performs
  the action; gameplay stays live meanwhile. Closed engine set: `move`, `interact`,
  `pickup`, `place`, `drop`, `build`, `run`, `enter_door`, `push`, `combine`.
- No `waitFor` — informational: stays until Enter, with an "Enter ▸" cue. (Room-world
  beats additionally need `autoAdvance: false` for this; the card-game bar always
  Enter-gates informational steps.)
- `demo: <TutorialDemo>` — which picture the card draws. Defaults to `waitFor`, so an
  interactive step illustrates its own action for free and should NOT set this. Set it
  on an INFORMATIONAL step to give it a picture. Closed engine set: every `waitFor`
  kind, plus the CONCEPT demos `prefilled`, `loop`, `indent`, `function`, `argument`,
  `shuffle`, `lowlight`.

**Show-the-idea rule (new mechanics):** a step that introduces a new CONCEPT — a tier, a
loop, indentation — must carry a `demo`. A concept is the hardest thing in the game to
convey and the least suited to prose; the picture does the explaining and the caption
stays to roughly one line. Text-only is for follow-up clarifications, not for the
introduction itself. If a concept has no demo that fits, add one to `TutorialDemo`
(engine, closed set) rather than writing a longer paragraph.

**No-restating-what-just-played rule:** never repeat a step the player has already done
in the SAME puzzle type. A later coding level introducing parentheses says only the new
rule — it does not replay pick-up / place / build / run. Re-teaching a control the player
just used delays the actual new idea and reads as distrust.

**Control-restating rule:** baseline movement (arrows/WASD) and the generic idea of
Enter-to-interact are taught once, in the hub — never restated. Every puzzle-specific
use of a control (push-by-walking, Enter-to-drop-in-bowl, E/P/Q, R-to-reset) IS restated
in that puzzle's own tutorial, even when it overlaps another puzzle's controls.

---

## Hub (`hub.test.v1.json`, room world)

1. "Hi! Welcome to Puzzle Patch. Let's get you started." — Enter
2. "Move around using the arrow keys or WASD." — `waitFor: move`
3. "Now try interacting. Walk up to the Coding door and press Enter." — `waitFor: enter_door`

Three steps, two of them interactive. Settings is deliberately NOT mentioned here: the
opening must get the player moving and through a door, and a menu they have no reason to
want yet is the one interruption between those two goals. Settings discovers itself.

## Code puzzle (`python.code.v1.json` tutorial, room world)

The mechanics tutorial; ends on `print("hello world")`. Tutorials are WHOLE-UNIT:
each plays its full sequence, every entry — a partial replay would teach step 4 to
someone who never saw step 1. Escape ends the whole unit at once.

1. "This is a code puzzle. Let's learn how it works." — Enter
2. "Press T any time to see your task. The board freezes while it's open — press T
   again (or Escape) to get back to it." — Enter
3. "Walk up to a word on the floor and press E to pick it up." — `waitFor: pickup`
4. "Words you carry sit in the bar at the bottom. Press a number key to choose which slot
   you are holding." — Enter, `demo: pickup`
5. "Walk to an empty tile and press P to place it down." — `waitFor: place`
6. "Changed your mind? Press Q to toss a word onto the floor in front of you. Walk over it
   to take it back — but leave it too long and it disappears. Throw it at a wall and it
   bounces back behind you; throw it into a pit or off the edge and it is gone." —
   `waitFor: drop`
5. "Stand on Build and press Enter to compile your line." — `waitFor: build`
6. "Stand on Run and press Enter to see what your line does." — `waitFor: run`

Step 2 (the task prompt) is a GENERIC control, not specific to coding: any room puzzle
that declares `mechanics.goalSpec` gets it for free (see `systems/taskOverlay.ts`), and
it is taught here — once, in the controls tutorial — rather than restated per track,
matching the control-restating rule below. Baba-style `logic_rules` rooms never set
`goalSpec` (their rule tiles ARE the goal), so pressing T there is a no-op and the
tutorial never mentions it in that track.

Shared tier/concept tutorials live in the pack's `tutorials` map and are pulled
in by a level's `tutorial_refs` (e.g. the `mixed` level references `tier:mixed`).
They play in full before that level's own `guided_tutorial`. Each one
carries a `demo` (see the show-the-idea rule above) and keeps its caption to one line:

- `tier:mixed` — `demo: prefilled` — some tiles come already placed.
- `tier:explicit` — `demo: place` — nothing is placed for you; every bracket is yours.
- `concept:loops` — `demo: loop`, then `demo: indent` — what a loop repeats, then what
  the one-tile offset means. Indentation is the single hardest idea in the coding
  module, so it gets its own step and its own picture.
- `concept:function_def` — `demo: function` — a named block, apart from its call.
- `concept:function_call` — `demo: argument` — a value travelling into a named slot.

### One tutorial per DIFFICULTY (enforced)

The ladder's mechanic rungs ARE the difficulties (`core/ladder.resolveMechanic`): **Base,
Mixed, Explicit, Shuffled, Shrouded**. Base is the entry rung and adds nothing to explain —
the room's own `guided_tutorial` teaches the controls there. **Every rung above Base
changes a rule, so every rung above Base has a `tier:<name>` tutorial and every level on
that rung lists it in `tutorial_refs`.** `packTutorials.test.ts` fails the build otherwise.

The two cross-module tiers come from the Axis-3 modifiers, so they read the same in
grammar, logic and vocab (each of those packs carries its own copy, as the card-game
scripts already do):

- `tier:shuffled` (`randomized`) — `demo: shuffle` — "The tiles are dealt to new spots
  every time you enter. Same puzzle — only the layout moved."
- `tier:shrouded` (`randomized` + `lowlight`) — `demo: lowlight` — "Now the room is dark:
  you only see what is near you. Walk around to reveal the rest." One beat, because a
  player reaching Shrouded has already been taught Shuffled; only the darkness is new.

## Match (card game — on `haw-match-001` AND `eng-match-pos-001`)

1. "This is a matching puzzle. Let's learn how it works." — Enter
2. "Walk into a word block to push it one space." — `waitFor: push`
3. "Push each meaning onto the word it matches. Fill every slot to finish — press R
   to reset the board if you get stuck." — Enter

## Combine (card game — on `combine-rope-001`)

1. "This is a combining puzzle. Let's learn how it works." — Enter
2. "Walk onto an object and press Enter to drop it into the bowl. Enter again takes
   it back out." — `waitFor: pickup`
3. "When the bowl has what you need, stand on 🧪 Mix and press Enter." — `waitFor: combine`
4. "Mix the right things together to reach the goal." — Enter

## Sentence build (card game — on `eng-sentence-001`)

1. "This is a sentence puzzle. Let's learn how it works." — Enter
2. "Walk to a word and press Enter to drop it into the next open slot." — `waitFor: place`
3. "Placed the wrong word? Stand on it and press Enter to take it back. Fill every
   slot to finish." — Enter

---

The tutorials teach the MECHANIC, never the solution — steps stay generic ("a word",
"an object") and the puzzle's hint ladder handles being stuck on the actual answer.
Adding a tutorial to a new puzzle type: reuse an existing `waitFor` kind if the
mechanic matches; otherwise extend `TutorialWaitFor` (engine, closed set) and fire
`tutorial.notify("<kind>")` from the renderer where the mechanic actually happens.
