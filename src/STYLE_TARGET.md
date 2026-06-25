# STYLE_TARGET.md — Python coding game

Visual target for the **Python `code_build` game type only**. This describes the
look; it is not a description of mechanics. When restyling, change only styles
scoped to this game type — never global tokens, `gridArena` shared styles, or the
other three game types (match / sentence / combine). If a change would touch
shared styles, scope it first or ask.

> Style is a third axis, alongside puzzle-type (code) and content (the pack). Keep
> it separate: the same way the engine never branches on a language, the code
> game's CSS should not leak into the other renderers.

---

## Mood

Retro, 8-bit, cozy. **Stardew Valley** is the reference: warm wooden/earthen tiles,
soft pixel sprites, friendly rather than slick. Simple per-tile movement animation
(a short hop or slide between cells — not smooth physics). Nothing neon, nothing
glassy, no gradients-as-decoration. The structure (Python syntax) is the toy, so
the room should feel like a playroom, not an IDE.

Character is a **slime**. Player-recolorable later; default **blue**.

---

## Palette

Warm, simple, low-saturation base so the syntax-colored code blocks stand out
against it. All values are starting points — tune in-engine.

| Role | Hex | Notes |
|------|-----|-------|
| Room background / frame | `#3A2E26` | dark warm brown, the wall/border |
| Frame inner edge | `#2A1F18` | darker brown, bevel |
| Floor tile | `#C9A86A` | warm tan wood/dirt |
| Floor tile inset | `#B8965A` | 2px inset for pixel depth |
| Tile grout / gap | `#5A4636` | grid lines between tiles |
| Terminal / output panel bg | `#14110D` | near-black, soft |
| Terminal text (default) | `#7EC06A` | soft green |
| Terminal text (success) | `#9FE1CB` | mint, for win/ok output |
| UI text on frame | `#F4E4C1` | warm cream |
| UI subtext | `#C9A86A` | muted tan |

### Slime (default blue, recolorable)
- Body `#378ADD`, inset shadow `#185FA5` (bottom-right, ~3px) for 8-bit dimension.
- Two white eyes. Rounded-blob silhouette (`border-radius: 50% 50% 45% 45%`).
- Recolor = single body-fill swap + matching darker shadow. Keep it one variable.

### Run button (chunky, tactile)
- Face `#C97B3C`, bottom edge `#8A4F22` (4px, the "pressable" depth).
- Text `#2A1810`. On press: shrink the bottom edge to ~1px (button "depresses").
- "Build" button uses the same shape, a cooler tan/neutral fill to read as secondary.

---

## Code blocks (syntax coloring)

Code blocks are **neutral on the floor** — a plain warm/light tile while sitting in
a word pile or the inventory. They take on their **syntax color only once placed in
the coding area** (assembled into a line). This matches "colorless, but can be
changed in color." Color teaches the category as the player builds.

Syntax color map (apply to the placed token by its role):

| Role | Color | Hex | Examples |
|------|-------|-----|----------|
| Keywords & function declarations | Blue/Teal | `#5DCAA5` | `print`, `if`, `class`, `def` |
| Strings / text | Green | `#97C459` | `"Hello, World!"` |
| Numbers & built-in functions | Yellow/Orange | `#EF9F27` | `5`, `len`, `range` |
| Variables & properties | Purple/Magenta | `#7F77DD` | `x`, `name`, `.value` |
| Plain text & punctuation | White / light gray | `#E8E2D4` | `(`, `)`, `:`, `,` |

Each placed block gets a subtle bottom inset shadow (`inset 0 -3px rgba(0,0,0,.18)`)
to read as a physical pixel tile, not flat text.

---

## Layout (one room fills one window)

```
┌─────────────────────────────────────────┐
│  CODEX · print              blue planet  │   ← warm frame, cream UI text
│  ┌─────────────────────────────────────┐ │
│  │                                     │ │
│  │   [coding area]      [word piles]   │ │   ← tan tile grid; doors on
│  │   ← indent =                        │ │     right + top edges
│  │     distance from                   │ │
│  │     left wall          🟦 slime     │ │
│  │                                     │ │
│  └─────────────────────────────────────┘ │
│  [▶ RUN] [BUILD]   > terminal output _    │   ← chunky buttons + soft terminal
└─────────────────────────────────────────┘
```

- Coding area sits against the **left wall**; horizontal offset from the wall is the
  visible indentation level (Python-style).
- Terminal panel runs along the bottom; the snake dialogue and command output appear
  here.

---

## Animation notes

- Movement: one short hop/slide per tile, ~80–120ms. No easing-heavy motion.
- Pickup: brief pop on the token as it enters inventory.
- Run/Build: button depresses on press; terminal "types" the command line out.
- Respect `prefers-reduced-motion` — fall back to instant transitions.
- Keep all motion `transform`/`opacity` only; no layout thrash.

---

## Out of scope for this doc
Mechanics (inventory size, vim editing, hint guy, locked subrooms, win condition)
live in the build prompts and the pack data — not here. This doc is only how the
code game *looks*.