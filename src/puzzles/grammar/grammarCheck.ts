// ---------------------------------------------------------------------------
// GRAMMAR puzzle — the pure sentence checker. NO DOM. This is the core; tested hard.
//
// A puzzle shows a FRAME of labeled role-slots; the player fills them with words
// in ANY order and submits. The check is structural and language-agnostic:
//   • a word FITS a slot when its role tag matches the slot's role, AND
//   • the overall filled ROLE SEQUENCE matches one of the pack's acceptable
//     structures (most packs declare one; flexible-order languages declare more).
// Several words may share a role (several nouns can be SUBJECT), so more than one
// correct sentence usually exists. The engine parses no grammar of its own — the
// roles, the words, and the acceptable orders are all PACK DATA.
// ---------------------------------------------------------------------------

/** One position in the sentence frame: its role + the learner-facing label. */
export interface GrammarSlot {
  role: string;  // machine role, e.g. "subject" | "verb" | "object" — pack-defined
  label: string; // learner prompt drawn on the slot, e.g. "who?"
}

/** One word in the bank, tagged with the role it can legally fill. A word tagged
 *  with a role no structure uses (e.g. "decoy") never fits anywhere. */
export interface GrammarWord {
  text: string;
  role: string;
}

/** Per-slot verdict after a submit. */
export type SlotStatus = "ok" | "empty" | "wrong-role";

export type CheckOutcome =
  | { valid: true }
  | { valid: false; slots: SlotStatus[] };

/**
 * Check one arrangement: `filled` is what sits in each frame slot (null = empty),
 * `structures` the pack's acceptable role sequences for this frame (≥ 1).
 *
 * Valid ⇔ every slot holds a word AND the role sequence equals SOME structure.
 * Invalid → per-slot statuses against the structure that comes CLOSEST (fewest
 * mismatches), so feedback points at the smallest fix, not an arbitrary one.
 */
export function checkSentence(
  filled: ReadonlyArray<GrammarWord | null>,
  structures: ReadonlyArray<ReadonlyArray<string>>,
): CheckOutcome {
  let best: SlotStatus[] | null = null;
  let bestMisses = Infinity;

  for (const roles of structures) {
    if (roles.length !== filled.length) continue; // a structure for a different frame
    const slots = filled.map((w, i): SlotStatus =>
      w === null ? "empty" : w.role === roles[i] ? "ok" : "wrong-role",
    );
    const misses = slots.filter((s) => s !== "ok").length;
    if (misses === 0) return { valid: true };
    if (misses < bestMisses) {
      bestMisses = misses;
      best = slots;
    }
  }

  // No structure fits this frame at all (bad data) → everything is wrong.
  return { valid: false, slots: best ?? filled.map(() => "wrong-role" as const) };
}

/** The index of the first slot to complain about (empty beats wrong-role, so the
 *  player fills the frame before fixing roles), or -1 when everything is ok. */
export function firstIssue(slots: ReadonlyArray<SlotStatus>): number {
  const empty = slots.indexOf("empty");
  if (empty !== -1) return empty;
  return slots.indexOf("wrong-role");
}
