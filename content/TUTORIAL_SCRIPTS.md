# Guided tutorial scripts

One script per room/puzzle-type, played ONCE ever on first visit (persisted in
`codex.tutorials.v1`; Settings → Controls → "🔁 Replay tutorials" clears the flags).
Tone: cut-and-dry, no character voice — the NARRATOR surface, all ages.

Mechanics of a step (see `DialogueBeat` in `src/schema/types.ts`):

- `waitFor: <TutorialWaitFor>` — the step stays until the player actually performs the
  action (gameplay stays live; everything else still works but doesn't advance it).
- `autoAdvance: false` — informational step; stays until Enter (shows an "Enter ▸" cue).
- Neither — auto-advances on the narrator dwell timer (avoid for tutorials).

The `waitFor` kinds are a CLOSED engine set: `move`, `interact`, `pickup`, `place`,
`build`, `run`, `enter_door` (live today), plus `push` and `combine` (reserved stubs —
see "Not yet wired" below). Step TEXT is pack content; the kinds are engine.

---

## Shipped

### Hub (`hub.test.v1.json`)

1. "Hi! Welcome to Puzzle Patch. Let's get you started." — Enter
2. "Move around using the arrow keys or WASD." — `waitFor: move`
3. "You can open Settings anytime — click the ⚙ icon in the corner — to change your
   controls or replay this tutorial." — Enter
4. "Now try interacting. Walk up to the Coding door and press Enter." — `waitFor: enter_door`

### Code puzzle (`python.code.v1.json`, first level)

1. "This is a code puzzle. Let's learn how it works." — Enter
2. "Walk up to a word on the floor and press I to pick it up." — `waitFor: pickup`
3. "Walk to an empty tile and press P to place it down." — `waitFor: place`
4. "Stand on Build and press Enter to compile your line." — `waitFor: build`
5. "Stand on Run and press Enter to see what your line does." — `waitFor: run`

Then the tutorial ends and the puzzle continues normally (hint giver, error beats).
The steps are deliberately generic ("a word", "an empty tile") — the tutorial teaches
the MECHANIC, never the solution.

---

## Not yet wired (drafts)

These puzzle types render outside the room/dialogue system today (their hub doors are
`coming_soon`). The `push`/`combine` waitFor kinds are already reserved in the schema;
when these types get walkable rooms, add a `guided_tutorial` to their first level's
dialogue config using these drafts, and fire `dialogue.notify("push" | "combine")` from
the mechanic's engine code (mirroring how `pickup`/`place`/`build`/`run` are fired in
`roomRenderer.ts`).

### Match (sokoban-style word matching)

1. "This is a matching puzzle. Let's learn how it works." — Enter
2. "Walk into a word block to push it." — `waitFor: push`
3. "Push each word onto the slot it matches. Fill every slot to finish." — Enter

### Combine (push objects together)

1. "This is a combining puzzle. Let's learn how it works." — Enter
2. "Walk into an object to push it." — `waitFor: push`
3. "Push two objects onto the combiner tile to merge them." — `waitFor: combine`
4. "Keep combining until you reach the goal." — Enter

### Sentence build (grammar slots)

Uses the same pickup/place mechanics as the code puzzle — no new waitFor kinds needed.

1. "This is a sentence puzzle. Let's learn how it works." — Enter
2. "Walk up to a word and press I to pick it up." — `waitFor: pickup`
3. "Each slot asks a question — like who? or doing what? Walk to a slot and press P to
   place your word." — `waitFor: place`
4. (submission/check step TBD — depends on how sentence rooms wire their check control)
