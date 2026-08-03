# Authoring tools

Offline scripts. Not shipped, not imported by `src/` — run them from the repo root.

## `pushSolver.mjs`

BFS solver for the two push formats (`grammar_build` frame-fill, `vocab_match`
pair-match). It mirrors the modules' rules: `tryMove`'s train push, interior `#` walls and
floor signs as STOP, and — for vocab — the wrong-bump pricing, so the route it finds is a
genuine ★★★ line that tests **zero** wrong combinations.

A full joint BFS blows up past ~4 movable tiles, so it **decomposes**: it fixes an order of
sub-goals (which word fills which slot / which pair joins first) and solves each stage with
only that stage's tiles movable, everything else solid. It therefore returns a real,
replayable move sequence and a sound **upper bound** on the optimum.

## `derivePar.mjs`

Rewrites every `payload.par` in the vocab and grammar packs from the layout:

- base levels → solved route + 15%
- `randomized` variants → the **worst** of `SAMPLES` sampled shuffles + 15% (one par has to
  cover every arrangement the engine can deal out)

The sampling doubles as a **winnability check**: now that these rooms have interior walls,
a shuffle that strands a tile would ship as a soft-lock. It prints `!!` lines and a final
count if any level or sampled shuffle is unsolvable.

```bash
SAMPLES=16 node --max-old-space-size=4096 tools/derivePar.mjs
```

Re-run it after changing any vocab/grammar room layout, tile position, or word bank, then
update the affected `packPlaythrough.test.ts` scripts with the routes it reports (the
solver's `path` is directly usable as a test key-sequence).
