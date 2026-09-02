# PROGRESSION.md — the player's path

The **map** of what a player is meant to meet, in what order, and which
**achievement** (unlock key) opens each next path.

This file is a description of **content**, not of engine behaviour. Every gate
below is expressed as data — a `state: "locked"` + `unlock` on a hub door, or an
`unlock` on a `progression.levels[]` entry. The engine never names a language or
a level (CLAUDE.md Rule 1); it only asks "is this key earned?".

An **achievement** is exactly one earned unlock key. A room grants its key via
`room.grants_unlock` when its puzzle is solved.

---

## 1. The hub — paths appear as they are earned

The hub's four portals are the top-level navigation. Only **Coding** is open at
the start; each other portal is a `locked` door that flips to `open` the moment
its key is earned, so a new path only ever *appears* as a reward.

| Portal | Opens with | Earned by |
|--------|-----------|-----------|
| 🐍 **Coding** | *(always open)* | — the entry point; the hub tutorial points at it |
| 🌺 **Language** (vocab) | `coding.tutorial.cleared` | Coding · Tutorial |
| 📖 **Grammar** | `vocab1.cleared` | Language · Vocab I |
| 🧩 **Logic** | `grammar1.cleared` | Grammar · Grammar I |

**Why this order.** The coding tutorial is the *controls* tutorial — walk, pick
up, place, build, run. Everything else reuses those verbs, so it goes first.
Then the ramp is by how much abstraction each track asks for:

1. **Vocab** — a word means a thing. One idea.
2. **Grammar** — words have *roles*, and roles snap into a sentence.
3. **Logic** — a sentence can be a *rule*, and rules can be rewritten. This is
   the most abstract track, and it literally reads as grammar (`X · IS · WIN`),
   so Grammar I is the honest prerequisite.

The Coding track keeps running in parallel the whole time — clearing its
tutorial is what starts the chain, and its own ladder is independent after that.

---

## 2. Inside a track — base ladder → Shuffled → Shrouded

Each track's levels are a straight chain: clear level *n* to reveal level
*n+1*. On top of that, every level has two harder **mechanic** variants, and
those now form their own chain instead of both appearing at once:

```
Level N (base)  ──clear──▶  Level N Shuffled  ──clear──▶  Level N Shrouded
     │
   clear
     ▼
Level N+1 (base)
```

Keys: base grants `<track><n>.cleared`; Shuffled grants
`<track><n>.shuffled.cleared`; Shrouded grants `<track><n>.shrouded.cleared`.
Shrouded (randomized **and** lowlight) is strictly harder than Shuffled
(randomized only), so it now sits behind it rather than beside it.

**What "randomized" actually does** depends on what the board is made of. Coding piles
and vocab/grammar word-tiles are re-dealt among their authored cells — those are
interchangeable furniture, and every deal is proven finishable by a solver
(`levelCompletion.test.ts` in each track). A LOGIC board is not: its word tiles ARE the
rules, so it is MIRRORED whole instead — a smaller kind of different that cannot strand
anything. Each logic level declares which mirrors it allows (`mechanics.variants`), and
each one is proven twice over: the authored route mirrored the same way still wins, and
the authored route unchanged no longer does.

---

## 3. Track by track

### 🐍 Coding — Python (`python.code.v1`)

Two things run in this track: a **content** ladder (variables → loops →
functions → arguments) and a **tier** ladder (how much punctuation the game
gives you: Base → Mixed → Explicit).

| Level | Opens with | Grants |
|-------|-----------|--------|
| Tutorial | *(open)* | `coding.tutorial.cleared` |
| Variables | `coding.tutorial.cleared` | `coding.base.vars.cleared` |
| Loops I | `coding.base.vars.cleared` | `coding.loops.1.cleared` |
| Loops II | `coding.loops.1.cleared` | `coding.loops.2.cleared` |
| Functions I | `coding.loops.2.cleared` | `coding.funcs.1.cleared` |
| Functions II | `coding.funcs.1.cleared` | `coding.funcs.2.cleared` |
| Arguments I | `coding.funcs.2.cleared` | `coding.args.1.cleared` |
| Arguments II | `coding.args.1.cleared` | `coding.args.2.cleared` |
| Conditions I | `coding.args.2.cleared` | `coding.cond.1.cleared` |
| Conditions II | `coding.cond.1.cleared` | `coding.cond.2.cleared` |
| Nested Loops | `coding.cond.2.cleared` | `coding.nest.1.cleared` |
| The Long Way Home | `coding.nest.1.cleared` | `coding.final.cleared` |
| *Hunted* · Hunting Grounds | `coding.base.vars.cleared` | `coding.hunt.0.cleared` |
| *Hunted* · Pack Hunt | `coding.hunt.0.cleared` | `coding.hunt.1.cleared` |
| *Hunted* · Debugging | `coding.hunt.1.cleared` | `coding.hunt.2.cleared` |
| *Mixed* · Assisted parens | `coding.base.vars.cleared` | `coding.mixed.cleared` |
| *Explicit* · Parentheses | **`coding.mixed.cleared`** | `coding.explicit.cleared` |

**Hunted** is a third ladder, orthogonal to the other two: the code is base-tier, but the
room has no piles — the tokens are carried by monsters and have to be fought for (see
`VISUAL_CATALOG.md` §2b). It opens off Variables, alongside Mixed.

**Debugging** is the same Hunted rung's third level, and the debut of the OTHER monster
behavior: a thief. Tokens are back on piles (fetching isn't the challenge here) — instead
something roams the coding area and steals a token you've already placed, carrying it on a
countdown (`digest_ms`) before it's gone for good. Kill it in that window and it drops what
it took; nothing here can ever be permanently lost — the pack's own piles are still the
real source, the thief just puts a clock on however you use them (see `VISUAL_CATALOG.md`
§2c, and the load-time softlock guard in `validateRepair.ts` that keeps a thief from ever
being a token's only supply).

**Changed:** Explicit used to open on `coding.tutorial.cleared` — i.e. *before*
the Mixed tier that teaches assisted punctuation, and at the same moment as
Variables. Placing your own parentheses now comes after being helped with them.

**The tail of the content ladder** — Conditions I/II, Nested Loops, and the capstone —
extends the chain past Arguments: a line that only sometimes runs, then the other road
(`else`), then two loops deep, then everything at once (a function with a slot, its calls,
and a loop doing the calling). The capstone is a seven-line program.

**Levels got LONGER.** Loops I, Functions I/II, Arguments I/II and both Hunt levels were
re-cut from 1–4 line programs into 4–6 line ones, each teaching a second idea on top of its
first: a loop with *two* body lines and one line outside it; a function *called twice*; calls
with something running between them; one slot filled by two different values; a hunt for two
variables instead of one. Every level from three lines up now declares its own
`mechanics.par` (seconds + steps), which is what the level-complete score card measures a
run against — a long level has to say it is long, or the card would grade it as a slow short
one. `src/puzzles/coding/levelCompletion.test.ts` plays every one of them to completion
through the real room host, so "longer" can never quietly become "unfinishable".

### 🌺 Language — Hawaiian vocab (`vocab.room.haw`) → English lexicon (`vocab.room.en`)

| Level | Opens with |
|-------|-----------|
| Tutorial | *(open once the Language portal is)* |
| Vocab I | `vocab.tutorial.cleared` |
| Vocab II | `vocab1.cleared` |
| Vocab III | `vocab2.cleared` |
| Nā Hoa | `vocab3.cleared` |
| Ke Kula | `vocab6.cleared` |
| Hōʻailona | `vocab7.cleared` |
| Hoʻopunipuni | `vocab4.cleared` |
| **English · Lexicon I** | **`vocab5.cleared`** |
| Lexicon II | `lex1.cleared` |
| Lexicon III | `lex2.cleared` |

**Nā Hoa / Ke Kula** are the two levels that carry the Hawaiian grammar wing's
vocabulary (`inu`, `hoaaloha`, `kula`, `haumāna`, `hele`, `ʻoe`); the two sign
levels after them carry the rest (`kumu`) and were re-cut so they stop re-running
words the player already matched two rooms earlier. They sit **before** the sign
levels, which is why `vocab5.cleared` — still the last key in the chain — remains
the Lexicon gate.

**Changed:** Lexicon I used to open on `vocab3.cleared`, popping a whole second
language into the menu halfway through the first one. It now opens when the
Hawaiian ladder is **finished** — a second language is the reward for
completing the first.

### 📖 Grammar — English (`grammar.room.en`) → Hawaiian (`grammar.room.haw`)

English: Tutorial → Grammar I → II → III, each on the previous one's key.

| Level | Opens with |
|-------|-----------|
| **Hawaiian · He** | **`grammar3.cleared`** |
| ʻO | `hawgram1.cleared` |
| Aia | `hawgram2.cleared` |
| E | `hawgram3.cleared` |

Same rule the Language track uses: a second language is the reward for
finishing the first, so the Hawaiian wing opens when the English chain ends.
One level per sentence pattern (he / ʻo / aia / e), and the frames there carry
**no slot labels** — the pattern comes from the room's tutorial and the English
target (T), not from the boxes.

### 🧩 Logic — English (`logic.room.en`) → Hawaiian (`logic.room.haw`)

English: Tutorial → Logic I … Logic VIII, each on the previous one's key.

| Level | Opens with |
|-------|-----------|
| **Hawaiian · Loiloi ʻEkahi** | **`logic4.cleared`** |
| Loiloi ʻElua | `haw0.cleared` |
| Loiloi ʻEkolu | `haw1.cleared` |
| Loiloi ʻEhā | `haw2.cleared` |

**Changed:** the Hawaiian logic wing used to open on `logic1.cleared` — one
level in. Reading rules in a second language needs the mechanic to be automatic
first, so it now opens halfway through the English ladder.

---

## 4. What the navigation menu shows

The ladder chooser (Language → Mechanic → Difficulty) keeps its existing rule:

- a **level** appears only once its `unlock` is earned — no skip-ahead;
- a **language / mechanic group** with nothing available yet renders greyed, so
  the player can see a path exists without being able to walk it;
- a **hub portal** whose door is still `locked` renders as a dim stone pad with
  🔒 and speaks its "beat this first" line when bumped.

---

## 5. Finishing a level — the score card carries you forward

Clearing a level opens the **LEVEL COMPLETE card** over the room (engine —
`systems/levelSummary.ts`; see `VISUAL_CATALOG.md` §4). It shows how the run went — time,
steps, hints used, failed runs, and the grade those add up to — and, more importantly, it
holds the way onward: **the next rung of this track's ladder is its first button**.

"Next" is the pure `nextLevel` resolver in `core/ladder.ts`, over a **fresh** unlock
snapshot, so the key this very solve just granted already counts. It is the next available
level in the same language + mechanic group (stay on the ladder you are climbing), else the
next available level anywhere further down the list, else nothing — and when there is
nothing, ⌂ Return to hub takes the first slot instead. So the chain in the tables above is
now something the player is *handed*, not something they have to go back to the portal and
look up.

The player is never forced through it: Esc dismisses the card and leaves them standing in
the solved room, portal and all.
