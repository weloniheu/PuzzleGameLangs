// ---------------------------------------------------------------------------
// Guided-tutorial overlay for the CARD-GAME renderers (match / combine /
// sentence_build). The room world has its own richer version integrated with
// the dialogue presenter (portrait interjections etc. — see systems/dialogue.ts
// + roomHost); this is the lightweight sibling for renderers that have no
// dialogue system — it drives the SAME visual popup card (systems/tutorialCard.ts)
// directly, since every beat here is guided-tutorial content already.
//
// Semantics (mirrors the room world's guided tutorials):
//   • A step with `waitFor` stays until the player actually performs that action
//     (the renderer reports it via notify()); gameplay stays LIVE meanwhile.
//   • A step without `waitFor` is informational: it waits for Enter (visible
//     Enter-gated pill) and SUPPRESSES gameplay keys while showing — same
//     "dialogue blocks input" rule the room world uses. No reading-speed timers.
//   • Escape ends the run from any step; the card shows that cue.
//
// The sequence plays ONCE per puzzle TYPE, ever (persisted — core/codex.ts's seen-tutorial
// store, keyed `type:<puzzle_type>`) — the first match puzzle the player ever meets teaches
// it, and no LATER match puzzle (any language pack) replays it. Watching it to the end OR
// Escape-skipping it both count as "seen" (finish() marks it either way). "Replay Tutorials"
// in Settings is the deliberate way back in. See roomHost's equivalent note (room world).
//
// Content stays in the pack (`payload.guided_tutorial`, the same DialogueBeat
// shape the room world uses — `speaker` is ignored here); the enum of waitFor
// kinds and this display mechanism are engine. See content/TUTORIAL_SCRIPTS.md.
// ---------------------------------------------------------------------------

import type { DialogueBeat, Puzzle, TutorialWaitFor } from "../../schema/types";
import { paintTutorialCard, removeTutorialCard, tutorialModuleMeta } from "./tutorialCard";
import { hasSeenTutorial, markTutorialSeen } from "../core/codex";

export interface TutorialOverlay {
  /** Report that `kind` actually happened. Advances a step waiting on exactly it. */
  notify(kind: TutorialWaitFor): void;
  /** Whether a step is currently showing (true only while the tutorial runs). */
  active(): boolean;
}

/** Shared no-op — returned when there is no tutorial to run, so renderers can
 *  call notify() unconditionally without null checks. */
const NOOP: TutorialOverlay = { notify() {}, active: () => false };

// Only one card puzzle renders at a time; a module-scope teardown guards against
// a stale overlay's listener surviving a re-render into the same container.
let activeTeardown: (() => void) | null = null;

/**
 * Mount the puzzle's guided tutorial into `container` (the renderer's own render
 * container — its keydown listener attaches here in CAPTURE phase, so info steps
 * can swallow gameplay keys before the board's own handlers see them).
 * Returns a no-op overlay when the puzzle has none or the type was already taught.
 */
export function mountGuidedTutorial(container: HTMLElement, puzzle: Puzzle): TutorialOverlay {
  if (activeTeardown) {
    activeTeardown(); // self-guard: never two live overlays
    activeTeardown = null;
  }

  const beats: DialogueBeat[] = (puzzle.payload as { guided_tutorial?: DialogueBeat[] }).guided_tutorial ?? [];
  if (!beats.length) return NOOP;
  const typeKey = `type:${puzzle.puzzle_type}`;
  if (hasSeenTutorial(typeKey)) return NOOP;

  const module = tutorialModuleMeta(puzzle.puzzle_type, puzzle.id);

  let idx = 0;
  let done = false;

  function current(): DialogueBeat | null {
    return done ? null : beats[idx] ?? null;
  }

  function show() {
    const beat = current();
    if (!beat) return;
    paintTutorialCard(container, { beat, idx, total: beats.length, module });
  }

  function advance() {
    idx++;
    if (idx < beats.length) { show(); return; }
    finish();
  }

  function finish() {
    done = true;
    removeTutorialCard(container);
    container.removeEventListener("keydown", onKeydown, true);
    if (activeTeardown === teardown) activeTeardown = null;
    markTutorialSeen(typeKey); // whether watched in full or Escape-skipped — both are "seen"
  }

  // Escape ends the whole run from ANY step — including a waitFor step, where it is the
  // only way out for a player who already knows the mechanic and doesn't want to perform
  // it again. Info steps otherwise behave like room dialogue: gameplay keys suppressed,
  // Enter advances. waitFor steps let everything else through — the player's real action
  // reaches the board and comes back as notify().
  function onKeydown(e: KeyboardEvent) {
    const beat = current();
    if (!beat) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish();
      return;
    }
    if (beat.waitFor) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") advance();
  }
  container.addEventListener("keydown", onKeydown, true);

  const teardown = () => {
    done = true;
    removeTutorialCard(container);
    container.removeEventListener("keydown", onKeydown, true);
  };
  activeTeardown = teardown;

  show();
  return {
    notify(kind) {
      const beat = current();
      if (beat && beat.waitFor === kind) advance();
    },
    active: () => current() !== null,
  };
}
