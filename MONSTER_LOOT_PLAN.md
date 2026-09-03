# MONSTER_LOOT_PLAN.md — coding levels where tokens come off monsters

## The goal

A coding level whose tokens are **not** sitting in piles. Instead monsters roam the room
carrying the tokens. A monster telegraphs where it will appear, materializes after a delay,
wanders, and only then can be interacted with — for now the only interaction is **attacking
it**. Killing it drops its token as loot on the floor, which the player picks up by walking
over it (the existing Q-drop pickup path) and then places into the coding area exactly as
before.

Monsters are deliberately **unstyled-but-classed**: every surface gets a real class hook and
a row in `VISUAL_CATALOG.md`, with only enough CSS to be legible. The look is a later pass.

---

## Where each piece belongs (CLAUDE.md Rule 1)

| Piece | Axis | Home |
|---|---|---|
| spawn/telegraph/wander/attack/loot **mechanics** | engine (puzzle TYPE machinery) | `src/engine/core/monsters.ts` (pure) + `src/engine/systems/monsters.ts` (DOM) |
| which monsters, which tokens, where, how tough | **content** | `RoomLayout.monsters` in the pack JSON |
| the `attack` keybinding | engine | `src/engine/core/keybindings.ts` |
| monster class hooks | **style**, scoped `.room-monster*` / `.tile-monster*` | `src/style.css` + `VISUAL_CATALOG.md` |

Monsters are a **room FEATURE** (`RoomFeature: "monsters"`), not an Axis-3 modifier: they
replace the room's token SOURCE, which is a room-shape decision like `coding_area`, and a room
that doesn't declare them builds no layer, no interval, no listeners. The ladder still groups
the new levels sensibly because a progression entry may state its own `mechanic` key
(`"mechanic": "hunted"` — `ladder.mechanicLabel` capitalizes unknown keys for free).

Nothing here knows it is a *coding* level: any room puzzle type could declare monsters. The
coding module is untouched.

---

## The monster lifecycle

```
  down ──(respawn_ms)──▶ telegraph ──(spawn_delay_ms)──▶ active ──(hp hits)──▶ down
                              │                             │
                    a marker on a floor cell        roams; SOLID; attackable;
                    NOT solid, NOT attackable       drops its token on defeat
```

- **telegraph** — `.tile-monster.telegraph` on the chosen cell. Walkable, ignorable, a warning.
- **active** — `.tile-monster.active`, wanders one cell every `move_ms` onto free floor.
  Blocks the player's step (you cannot walk through it) and is the only phase `attack` hits.
- **defeat** — the token drops as an ordinary dropped item on the monster's cell (or the
  nearest free cell), tagged `.room-loot`, with a longer TTL than a Q-drop.
- **respawn** — the slot re-telegraphs after `respawn_ms`, at its authored cell when free,
  otherwise any free floor cell.

**Why respawn matters:** piles are infinite (`tryPickup` never consumes one), so a level can't
be softlocked by losing a token. Monsters must inherit that property — a slain monster whose
loot despawned or fell in a pit has to be replaceable, or the level dead-ends. Respawn is the
mechanism; it is not flavor.

**Monsters do not damage the player.** Out of scope for this task — the player has no health
in this game. The hook to add it later is one branch in the wander step.

---

## Steps

1. **Schema** (`src/schema/types.ts`)
   - `RoomFeature` += `"monsters"`.
   - `MonsterDef { token, pos?, hp?, glyph?, name?, kind? }` and
     `MonsterConfig { spawns, spawn_delay_ms?, respawn_ms?, move_ms?, loot_ttl_ms? }`.
   - `RoomLayout.monsters?: MonsterConfig`.
   - `TutorialWaitFor` += `"attack"` (so a guided tutorial can wait on the new verb; it
     doubles as a `TutorialDemo` kind, which obliges a `buildDemo` case — step 6).

2. **Pure core** (`src/engine/core/monsters.ts` + `monsters.test.ts`)
   - `MONSTER_DEFAULTS` (timings), `MonsterSlot`/`MonsterPhase` model.
   - `spawnCellFor(def, room, isFree, rng)` — authored cell when free, else a random free floor.
   - `wanderStep(cell, room, isFree, rng)` — a random free orthogonal neighbour, or stay.
   - `damage(slot)` → `{ slot, defeated }`.
   - `lootCellFor(cell, room, isFree)` — the corpse's cell, else a free neighbour, else null.
   - No DOM, no timers. Tested.

3. **DOM system** (`src/engine/systems/monsters.ts`)
   - `createMonsters(deps)` → `{ occupies, monsterAt, attackAt, relayout, teardown }`.
   - One `setInterval` at `MONSTER_TICK_MS`; each slot counts down its own phase timer.
   - Draws into the host-provided `.room-monster-layer` at the live tile size.

4. **Host wiring** (`src/engine/roomHost.ts`)
   - Feature-gate + build the layer (below the slime, above piles).
   - `freeForDrop` also rejects a monster's cell; `moveOrCursor` treats an active monster as
     solid; `spawnDropped` grows an options arg (`ttl`, extra class) for loot.
   - New `attack` action → swipe effect on the faced cell, hit any active monster there,
     `dialogue.notify("attack")` on a landed hit.
   - `relayout` redraws monsters; teardown kills the interval and the DOM.

5. **Keybinding** (`src/engine/core/keybindings.ts`) — `attack` action, default `F` in both
   schemes (free in standard and vim; rebindable like everything else).

6. **Tutorial demo** (`src/engine/systems/tutorialCard.ts`) — a `case "attack"` mini-demo.

7. **CSS** (`src/style.css`) — minimal scoped hooks: `.room-monster-layer`, `.tile-monster`
   (+ `.telegraph` / `.active` / `.hurt`), `.tile-monster-glyph`, `.tile-monster-label`,
   `.tile-monster-hp`, `.room-attack-swipe`, `.room-dropped.room-loot`, `.tdemo-attack*`.

8. **Validation** (`src/generation/validateRepair.ts`) — the `monsters` feature and a
   `monsters` block must come together; every spawn needs a non-empty `token`; `hp ≥ 1`;
   an authored `pos` must be a floor cell.

9. **Content** (`content/packs/python.code.v1.json`) — two hunt levels
   (`py-code-hunt-000` print/greeting, `py-code-hunt-001` a two-line variables program),
   a shared `mechanic:monsters` tutorial in `tutorials`, and progression rows carrying
   `"mechanic": "hunted"`.

10. **Docs** — `VISUAL_CATALOG.md` gets the `attack` binding, the monster layer + phase
    classes, the transient rows, the new timing constants, and the `attack` demo kind.

11. **Verify** — `npm run build` (typecheck + build) and `npm test`; the pack lints
    (`packIntegrity`, `packFraming`, `packTutorials`) cover the new levels automatically.

## Out of scope

Monster damage/health, monster AI beyond a random walk, art, and any interaction other than
attacking (the task says attack-only "for now").
