# Pack authoring guide

Packs are the **open axis**: a new language or level is new JSON here, zero engine
change. The engine dispatches on `puzzle_type` / `validator_type` and on closed-set
tokens only — it never branches on a language.

## Visual skin: the `theme` token

A room may declare `"theme"` — one token from the **closed skin set**:

| token | look | currently used by |
|---|---|---|
| `grove` | mossy green | logic rooms (en + haw) |
| `tropical` | sand, water edge | Hawaiian rooms (vocab + grammar) |
| `library` | warm library tan | English grammar + English vocab rooms |
| `tech` | coding-room sand + teal | python code rooms |

The **language → look mapping is a content decision made here**, per pack — a
Hawaiian pack *declares* `tropical`; the engine only renders the token. Omit `theme`
for the default warm-sand look. A new skin = one new token in `RoomTheme`
(`src/schema/types.ts`) + a scoped CSS block in `src/style.css` — no logic.

## Grammar frames: the optional slot `label`

A `grammar_build` slot may carry a learner prompt (`"label": "who?"`) — drawn inside
the dashed box until a word lands there. It is **optional**, and dropping it is a
teaching decision, not a styling one:

- **with labels** (`grammar.room.en`) — the frame itself says what each box wants, so
  the puzzle is "find a word of that kind";
- **without labels** (`grammar.room.haw`) — the boxes are bare, and the word order has
  to come from somewhere else: the room's `guided_tutorial` shows the pattern with a
  worked example, and `mechanics.goalSpec` states the target sentence **in English**.

If you drop the labels, ship both of those — otherwise the level is a guess.

## Language typology: the `typology` field

Language packs (logic rule packs, grammar packs) may carry:

```json
"typology": {
  "word_order": "VSO (predicate-first)",
  "pattern_family": "predicate-first-equational",
  "notes": "…"
}
```

**This is documentation, not machinery.** The engine never reads it. Its two jobs:

1. **Authoring index** — starting a structurally similar language? Find the pack
   whose `pattern_family` matches and **copy it** as your starting point:
   - predicate-first languages (Māori, Sāmoan, …) → copy `logic.rules.haw.v1.json`
   - subject-first copular languages → copy `logic.rules.en.v1.json`
2. **Self-consistency lint** — the logic pack validator rejects a pack whose
   typology *contradicts* its declared pattern (e.g. claims predicate-first but
   captures the subject first). The label may never lie about the one thing it claims.

**A typology label is a starting point, never a grammar guarantee.** Shared word
order does not mean shared articles, agreement, particles, or possession classes —
every construction in a copied pack must be verified by a speaker of the language
before shipping (`metadata.reviewed` / the `needs-kumu-review` tag track this).

## How long a level SHOULD take: `mechanics.par`

Clearing a level opens the score card (`engine/systems/levelSummary.ts`), which grades the
run against a par:

```json
"mechanics": { "par": { "seconds": 300, "steps": 300 } }
```

Time and steps only cost points **over** par, and both penalties are capped — so par is not
a time limit, it is "what a player who knew what they were doing would spend". Omit it and
the engine's short defaults apply (`PAR_SECONDS` / `PAR_STEPS` in `engine/core/score.ts`),
which will grade a genuinely long level as a slow short one. **Any level with three or more
solution lines must declare its own par** — `puzzles/coding/packValidation.test.ts` enforces
that, because the failure is silent otherwise: the level still plays, it just scores unfairly.

Rough calibration from the Python pack: a 4-line level ≈ 220–260s / 220–260 steps, a 6-line
one ≈ 300s / 300 steps, the 7-line capstone 420 / 420.

## Can it actually be finished? (what the tests prove)

Every track has a suite that PLAYS its levels rather than inspecting them, because the
failure that matters — "this room cannot be completed" — is invisible to a schema check:

| Track | What proves a level finishable | Covers randomized deals? |
|---|---|---|
| Coding | `puzzles/coding/levelCompletion.test.ts` mounts each level through the real room host and plays it: pathfind to a pile (or fight the monster carrying the token), place, Build, Run | n/a — coding levels shuffle piles only, and every pile is infinite |
| Vocab | `puzzles/vocab/levelCompletion.test.ts` SOLVES each board (a push-space search) and replays the route through the real engine | **yes** — 16 deals per `randomized` level |
| Grammar | `puzzles/grammar/levelCompletion.test.ts`, same shape: fill the frame slot by slot, then confirm on the real push core | **yes** — 16 deals per `randomized` level |
| Logic | `puzzles/logic/levelCompletion.test.ts` replays the authored route MIRRORED through every transform the level declares | **yes** — every declared transform, exhaustively |

The solvers report `"exhausted"` (ran out of budget) separately from `"unsolvable"` (the
search closed out), so a slow board can never quietly read as a healthy one.

### `randomized` on a rule board: mirrors, not a re-deal

A vocab or grammar board can be re-dealt because its tiles are interchangeable furniture.
A logic board's tiles are its RULES — permute them and the room can become impossible,
and proving otherwise means planning over rules that rewrite themselves mid-solve, which
no test suite can afford. So `randomized` means something smaller there: the board is
MIRRORED whole (`mirror-x` / `mirror-y` / `mirror-both`), and any rule the flip reversed
is put back into reading order by swapping its two outer words. The rules come out exactly
as authored; every position in the room has moved.

Which mirrors a level may roll is declared per level:

```json
"modifiers": ["randomized"],
"mechanics": { "variants": ["mirror-y"] }
```

**Only list a transform the tests accept.** `puzzles/logic/levelCompletion.test.ts` checks
both halves of the promise for every one you declare:

- **winnable** — the authored route, mirrored the same way, still finishes the board;
- **different** — the authored route, *unchanged*, no longer does.

That second check is the whole point of the modifier, and it is why some boards list only
one mirror: `mirror-y` leaves a purely left-to-right route working verbatim, and a variant
you can beat with the steps you already know is not a variant. A board whose solution
pushes words in and out of horizontal rules generally rejects `mirror-x` in turn. Add the
transform, run the suite, keep what passes.

## Review gate

`metadata.reviewed: false` marks content awaiting speaker review. The Hawaiian logic
pack ships with `reviewed: false` and a `_review_note` listing exactly which
constructions need a kumu's judgment.
