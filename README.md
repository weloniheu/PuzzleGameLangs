# Language Puzzle Prototype

Starting code for a top-down 2D puzzle-exploration game where players solve
**language-based puzzles** (natural languages, conlangs, and formal/symbolic
languages like C++ or Python). The puzzle system is **modular** and designed so
that **LLM-generated content** can fill a fixed schema and become playable
without the engine understanding any specific language.

This scaffold proves the **MVP slice** from the roadmap end-to-end:

> **Hawaiian × `match` puzzle × offline (curated) generation.**

When you run it, a **pack picker** lets you hot-swap between several test
"languages" — each rendered and validated entirely from data the engine does not
"understand":

| Pack | Language | Puzzle types | What it teaches (without saying so) |
|------|----------|--------------|--------------------------------------|
| 🐍 `python.code.v1` | `python` | `code_build` | assemble `print("…")` from command blocks; a persistent **Codex** remembers commands you discover |
| 🔤 `english.grammar.v1` | `english` | `match`, `sentence_build` | parts of speech, then build sentences by dropping role-tagged words into a **subject → verb → object** structure |
| 🧩 `logic.combine.v1` | `logic` | `combine` | combine objects (rock / scissors / water / small …) to reach a described outcome |
| 🌺 `hawaiian.match.v1` | `hawaiian` | `match` | vocabulary, via a Sokoban-style word-pushing board |

**Every puzzle is top-down 2D.** You drive the 🐢 with arrow keys / WASD (or the
on-screen D-pad). The `match` board is Sokoban-style pushing; the others turn each
choice into a floor **tile** — walk onto it and press **Enter (⏎)** to activate it
(place a word, mix objects, add a code block, hit Run). One world, one control scheme.

The whole point: **fun first.** The structure (grammar, `print`, word logic) is
the toy you play with, not a lecture.

---

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev      # open the printed localhost URL
```

```bash
npm run build    # typecheck + production build into dist/
```

---

## The one idea behind the whole structure

There are **two independent axes**. Keep them separate and everything stays modular:

| Axis | What | Where it lives | Open/closed |
|------|------|----------------|-------------|
| **Puzzle type** | the interaction format (`match`, `reorder`, …) | engine code (renderers + validators) | **closed** — the LLM picks from these, never invents |
| **Language** | the content (Hawaiian, C++, …) | data files in `content/` | **open** — new language = new data, zero engine change |

**Litmus test:** if you ever write `if (language === "hawaiian")` inside `src/engine/`,
the modularity is broken. The engine dispatches on `puzzle_type` and
`validator_type` only.

---

## Folder map

```
PersonalProject/
├── index.html
├── package.json · tsconfig.json
├── content/
│   └── packs/
│       ├── hawaiian.match.v1.json    ← curated MVP pack (match)
│       ├── english.grammar.v1.json   ← match + sentence_build (grammar)
│       ├── logic.combine.v1.json     ← combine (word-logic)
│       └── python.code.v1.json       ← code_build (the "blue planet" intro)
└── src/
    ├── main.ts                       ← entry: pack picker → loads pack → runs puzzles
    ├── style.css
    ├── schema/                       ── THE CONTRACT (build this first; everything depends on it)
    │   ├── types.ts                  ← TypeScript types for puzzles, packs, engine interfaces
    │   └── puzzle.schema.json        ← JSON Schema; also injected into LLM prompts
    ├── engine/                       ── THE CONSUMER (renders + validates; language-agnostic)
    │   ├── puzzleRunner.ts           ← ties renderer + validator + hints + win condition
    │   ├── packLoader.ts             ← loads packs, validates every puzzle, query() for rooms
    │   ├── codex.ts                  ← persistent "discovered commands" list (localStorage)
    │   ├── renderers/                ← input methods, keyed by puzzle_type (all top-down 2D)
    │   │   ├── index.ts              ← RendererRegistry
    │   │   ├── gridArena.ts          ← shared walk-and-press-Enter board (player + D-pad + tiles)
    │   │   ├── matchRenderer.ts      ← Sokoban word-pushing (with a stuck-block fail-safe)
    │   │   ├── sentenceRenderer.ts   ← grammar: walk to words, Enter to fill a sentence structure
    │   │   ├── combineRenderer.ts    ← word-logic: walk to objects, Enter to mix toward an outcome
    │   │   └── codeRenderer.ts       ← walk to code blocks + a tiny SAFE print() interpreter
    │   └── validators/               ← answer checking, keyed by validator_type
    │       ├── index.ts              ← ValidatorRegistry
    │       ├── setMatch.ts · sequenceMatch.ts · textMatch.ts
    │       ├── combineMatch.ts       ← unordered ingredient-set equality
    │       └── codeMatch.ts          ← compares the program's printed output
    └── generation/                   ── THE PRODUCER (offline authoring; no key in client)
        ├── promptTemplate.ts         ← turns a request into a constrained, schema-injected prompt
        └── validateRepair.ts         ← parse → validate → self-consistency → repair/reject funnel
```

---

## How this maps to the roadmap phases

- **Phase 1 — Schema (the contract):** `src/schema/`. Designed before the runner and
  the prompt template, exactly as the dependency order requires.
- **Phase 2 — Engine / puzzle runner:** `src/engine/`. Registries make adding a puzzle
  *type* a code change and adding a *language* a data-only change.
- **Phase 3 — LLM generation layer:** `src/generation/`. The prompt template injects the
  schema + allowed types + difficulty rubric + a few-shot example; the funnel parses,
  validates, runs self-consistency checks, and produces a repair prompt for failures.
- **Phase 5 — Integration:** `packLoader.ts` validates on load; `query()` lets rooms ask
  for "a difficulty-2 Hawaiian match puzzle" instead of hardcoding ids. `main.ts` runs
  the full loop.
- **Phases 4 & live generation — deferred:** `execution_match` (the *heavy* tier — a real
  interpreter in a sandbox) is deliberately *not* registered, so puzzles needing it are
  rejected at load until you build it. The `code_build` puzzles ship a **light** tier
  instead: `codeRenderer` runs the assembled blocks through a tiny pattern-matcher that only
  understands `print("…")` — no `eval`, no sandbox — and `code_match` checks the printed
  string. `promptTemplate.ts` makes no network call and holds no key.

### Two things worth calling out

- **Collision fail-safe** (`matchRenderer`): a block shoved against the outer wall can't get
  permanently trapped. The first bump just thunks; a *second* bump in the same direction
  ejects the block **and** the player one cell back, away from the wall. Blocks already
  seated in a slot are exempt — they're meant to rest there.
- **The Codex** (`codex.ts`): when a player first *uses* a tagged command (e.g. `print`), it's
  recorded and persists across puzzles via `localStorage`, so later levels can say "you
  already know: print." "🧹 Reset Codex" in the pack bar wipes it for a fresh playthrough.

---

## Extending it

**Add a language** (no engine change): drop a new JSON pack in `content/packs/` that
conforms to the schema, then point a room/loader at it. That's it.

**Add a puzzle type** (engine change): (1) add the type to the enums in
`schema/types.ts`, (2) write a renderer in `engine/renderers/` and register it,
(3) ensure a suitable validator exists in `engine/validators/`, (4) add a payload
sub-schema + self-consistency check in `generation/validateRepair.ts`.

**Wire real LLM generation** (offline authoring): call your LLM API with the strings
from `buildGenerationPrompt(...)`, forcing JSON/structured output, then pass the raw
text to `runGenerationFunnel(...)`. Review accepted puzzles, flip
`metadata.reviewed = true`, and save them as a pack. Keep the API key server-side /
author-side — never in the game client.

**Add the world (top-down movement):** this scaffold focuses on the puzzle spine. Layer
a tilemap + movement engine (Phaser or Godot) on top; when the player interacts with a
puzzle node, call `runPuzzle(host, puzzle, { onSolved })`.
