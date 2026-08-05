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
| *Mixed* · Assisted parens | `coding.base.vars.cleared` | `coding.mixed.cleared` |
| *Explicit* · Parentheses | **`coding.mixed.cleared`** | `coding.explicit.cleared` |

**Changed:** Explicit used to open on `coding.tutorial.cleared` — i.e. *before*
the Mixed tier that teaches assisted punctuation, and at the same moment as
Variables. Placing your own parentheses now comes after being helped with them.

### 🌺 Language — Hawaiian vocab (`vocab.room.haw`) → English lexicon (`vocab.room.en`)

| Level | Opens with |
|-------|-----------|
| Tutorial | *(open once the Language portal is)* |
| Vocab I | `vocab.tutorial.cleared` |
| Vocab II | `vocab1.cleared` |
| Vocab III | `vocab2.cleared` |
| Hōʻailona | `vocab3.cleared` |
| Hoʻopunipuni | `vocab4.cleared` |
| **English · Lexicon I** | **`vocab5.cleared`** |
| Lexicon II | `lex1.cleared` |
| Lexicon III | `lex2.cleared` |

**Changed:** Lexicon I used to open on `vocab3.cleared`, popping a whole second
language into the menu halfway through the first one. It now opens when the
Hawaiian ladder is **finished** — a second language is the reward for
completing the first.

### 📖 Grammar — English (`grammar.room.en`)

Tutorial → Grammar I → II → III, each on the previous one's key. Unchanged;
this chain was already clean.

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
