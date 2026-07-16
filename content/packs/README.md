# Pack authoring guide

Packs are the **open axis**: a new language or level is new JSON here, zero engine
change. The engine dispatches on `puzzle_type` / `validator_type` and on closed-set
tokens only — it never branches on a language.

## Visual skin: the `theme` token

A room may declare `"theme"` — one token from the **closed skin set**:

| token | look | currently used by |
|---|---|---|
| `grove` | mossy green | logic rooms (en + haw) |
| `tropical` | sand, water edge | vocab rooms (Hawaiian) |
| `library` | warm library tan | grammar rooms |
| `tech` | coding-room sand + teal | python code rooms |

The **language → look mapping is a content decision made here**, per pack — a
Hawaiian pack *declares* `tropical`; the engine only renders the token. Omit `theme`
for the default warm-sand look. A new skin = one new token in `RoomTheme`
(`src/schema/types.ts`) + a scoped CSS block in `src/style.css` — no logic.

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

## Review gate

`metadata.reviewed: false` marks content awaiting speaker review. The Hawaiian logic
pack ships with `reviewed: false` and a `_review_note` listing exactly which
constructions need a kumu's judgment.
