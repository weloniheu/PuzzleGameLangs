# CLAUDE.md — Project rules

Top-down 2D puzzle-exploration game. Players solve language/logic puzzles that are
**fun first, educational by accident**. The engine renders and validates puzzles
from JSON pack data **without understanding any specific language or level**.

Stack: plain **TypeScript + Vite**. No framework (no React). UI is built with
direct DOM calls inside renderers. See `README.md` for the folder map and roadmap.

---

## Working agreement (follow on every task)

1. **Smallest change that satisfies the task.** No drive-by refactors or rewrites.
2. **After each change run `npm run build`** (it typechecks + builds). Don't hand off red.
3. **End every task at something PLAYABLE** I can try with `npm run dev`. If a step
   leaves the game unrunnable, it isn't done.

---

## Rule 1 — THREE axes stay separate

Every feature belongs to exactly one axis. Keeping them apart is what keeps the
project modular. **Never branch the engine on a specific language or a specific level.**

| Axis | What it is | Where it lives | Open / closed |
|------|-----------|----------------|---------------|
| **Puzzle TYPE** | the interaction mechanic (`match`, `combine`, `code_build`, …) | **engine code** — `src/engine/renderers/` + `src/engine/validators/`, keyed by `puzzle_type` / `validator_type` | **closed** set (enums in `src/schema/types.ts`); content picks from these, never invents |
| **LANGUAGE / level CONTENT** | the actual words, levels, packs | **data** — `content/packs/*` | **open** — a new language or level is new data, **zero** engine change |
| **VISUAL STYLE** | look & feel of a puzzle type | **scoped per renderer** (that type's own CSS classes) | per-type; styling one type must not restyle another |

**Litmus test:** if you ever write `if (language === "…")` or `if (level === …)`
or `if (pack_id === …)` inside `src/engine/`, the modularity is broken. The engine
dispatches on `puzzle_type` and `validator_type` **only**.

---

## Rule 2 — Code-puzzle mechanics are ENGINE; everything specific is CONTENT

For the code puzzle (`code_build` and its successors), the **mechanics are engine
code, written once, language-agnostic**:

- pick up a token / hold it in inventory
- place a token (including indentation)
- build the program / run it / check the answer

The following are **always CONTENT in the pack JSON**, never hardcoded in the engine:

- the specific **words, numbers, punctuation** (the `tokens`)
- **hidden spots, locked subrooms**
- **snake dialogue / scenario text**
- the **hint sequence** (`hints`)
- the **single correct answer** (`solution`)

If a behavior is the same across every code level, it's engine. If it changes
level to level, it's data in the pack.

---

## Rule 3 — Validation checks ORDER, never executes code

Validators compare the **order of placed tokens** against the correct answer.
They do **not** run, `eval`, or interpret the player's code. This matches the
existing `code_match` philosophy (`src/engine/validators/codeMatch.ts`): the
renderer produces a result, the validator does a string/order comparison, and the
heavy real-interpreter tier (`execution_match`) stays **deferred / unregistered**.

When you extend code puzzles, keep validation as an order/equality check against
`solution`. No sandboxes, no execution.

---

## Rule 4 — Input is KEYBOARD-ONLY for gameplay

- **In-room GAMEPLAY is keyboard-only.** Walking (arrows / WASD / hjkl), pick up
  (`i`), place (`p`), build / run / check, confirm (Enter) — all keyboard.
- **Mouse is allowed ONLY for window management:** (a) the **settings panel** (the
  gear icon, top corner — movement scheme + Reset Codex), and (b) **dragging /
  focusing the terminal panel** (the room⇄terminal focus switch). Nothing in
  gameplay uses the mouse.
- **Movement schemes** (settings-selectable):
  - **arrows** — default
  - **WASD**
  - **hjkl**
- Activate / confirm is the Enter key.

> Note: the current `gridArena.ts` also wires a click-to-activate shortcut and an
> on-screen D-pad. Those predate this rule; for the code game, prefer keyboard
> bindings and treat mouse activation as out of scope unless it's the room⇄terminal
> focus switch.

---

## Rule 5 — Visual style is scoped, and the code game targets STYLE_TARGET.md

- The visual target for the **code game** lives in **`STYLE_TARGET.md`**: warm
  Stardew-style tiles, recolorable slime, syntax-colored code blocks.
- **Apply that style only to this game type's scoped styles.** Do not let it leak
  into other puzzle types' renderers or shared/global CSS.

---

## Quick map of where things go

- New **puzzle type** → enum in `src/schema/types.ts` + renderer in
  `src/engine/renderers/` (registered in `renderers/index.ts`) + validator in
  `src/engine/validators/` (registered in `validators/index.ts`) + a
  self-consistency check in `src/generation/validateRepair.ts`.
- New **language / level** → a pack file in `content/packs/` only.
- New **look** for a type → that renderer's own scoped CSS classes.
- Shared top-down board (walk + Enter on tiles) → `src/engine/renderers/gridArena.ts`.
