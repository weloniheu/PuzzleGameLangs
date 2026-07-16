# Guided tutorial scripts

One script per puzzle type / room, played ONCE ever on first encounter, persisted in
`codex.tutorials.v1` (Settings → Controls → "🔁 Replay tutorials" clears the flags).
Tone: cut-and-dry, no character voice, all ages.

**Two delivery mechanisms, one authoring shape** (`DialogueBeat[]`, field
`guided_tutorial` — see `src/schema/types.ts`):

- **Room world** (hub, code puzzles): `payload.dialogue.guided_tutorial`, played
  through the dialogue presenter (`systems/dialogue.ts`) — appended after `on_enter`
  story beats; side dialogue (errors, blocked doors, hints) interjects and resumes.
  Persisted per ROOM ID.
- **Card games** (match, combine, sentence_build): `payload.guided_tutorial`, played
  by the lightweight bar (`systems/tutorialOverlay.ts`). Persisted per PUZZLE TYPE —
  "learn match once", even when several packs open with a match puzzle (each entry
  puzzle carries the same script; whichever the player meets first plays it).

Step mechanics (both mechanisms):

- `waitFor: <TutorialWaitFor>` — the step stays until the player actually performs
  the action; gameplay stays live meanwhile. Closed engine set: `move`, `interact`,
  `pickup`, `place`, `build`, `run`, `enter_door`, `push`, `combine`.
- No `waitFor` — informational: stays until Enter, with an "Enter ▸" cue. (Room-world
  beats additionally need `autoAdvance: false` for this; the card-game bar always
  Enter-gates informational steps.)

**Control-restating rule:** baseline movement (arrows/WASD) and the generic idea of
Enter-to-interact are taught once, in the hub — never restated. Every puzzle-specific
use of a control (push-by-walking, Enter-to-drop-in-bowl, I/P, R-to-reset) IS restated
in that puzzle's own tutorial, even when it overlaps another puzzle's controls.

---

## Hub (`hub.test.v1.json`, room world, key `hub`)

1. "Hi! Welcome to Puzzle Patch. Let's get you started." — Enter
2. "Move around using the arrow keys or WASD." — `waitFor: move`
3. "You can open Settings anytime — click the ⚙ icon in the corner — to change your
   controls or replay this tutorial." — Enter
4. "Now try interacting. Walk up to the Coding door and press Enter." — `waitFor: enter_door`

## Code puzzle (`python.code.v1.json` tutorial, room world, key `py-code-tutorial-000`)

The mechanics tutorial; ends on `print("hello world")`. Beats 2–5 carry a
`teaches` concept tag (pickup / place / build / run), so a harder mechanical
tier re-teaches only the ones a player hasn't already seen (see codex.hasTaught).

1. "This is a code puzzle. Let's learn how it works." — Enter
2. "Walk up to a word on the floor and press I to pick it up." — `waitFor: pickup` · `teaches: pickup`
3. "Walk to an empty tile and press P to place it down." — `waitFor: place` · `teaches: place`
4. "Stand on Build and press Enter to compile your line." — `waitFor: build` · `teaches: build`
5. "Stand on Run and press Enter to see what your line does." — `waitFor: run` · `teaches: run`

## Match (card game, key `match` — on `haw-match-001` AND `eng-match-pos-001`)

1. "This is a matching puzzle. Let's learn how it works." — Enter
2. "Walk into a word block to push it one space." — `waitFor: push`
3. "Push each meaning onto the word it matches. Fill every slot to finish — press R
   to reset the board if you get stuck." — Enter

## Combine (card game, key `combine` — on `combine-rope-001`)

1. "This is a combining puzzle. Let's learn how it works." — Enter
2. "Walk onto an object and press Enter to drop it into the bowl. Enter again takes
   it back out." — `waitFor: pickup`
3. "When the bowl has what you need, stand on 🧪 Mix and press Enter." — `waitFor: combine`
4. "Mix the right things together to reach the goal." — Enter

## Sentence build (card game, key `sentence_build` — on `eng-sentence-001`)

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
