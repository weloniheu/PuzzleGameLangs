// ---------------------------------------------------------------------------
// Guided-tutorial overlay for the CARD-GAME renderers (match / combine /
// sentence_build). The room world has its own richer version integrated with
// the dialogue presenter (portrait interjections etc. — see systems/dialogue.ts
// + roomRenderer); this is the lightweight sibling for renderers that have no
// dialogue system: a single narrator-style bar over the board.
//
// Semantics (mirrors the room world's guided tutorials):
//   • A step with `waitFor` stays until the player actually performs that action
//     (the renderer reports it via notify()); gameplay stays LIVE meanwhile.
//   • A step without `waitFor` is informational: it waits for Enter (visible
//     "Enter ▸" cue) and SUPPRESSES gameplay keys while showing — same
//     "dialogue blocks input" rule the room world uses. No reading-speed timers.
//   • The sequence is unskippable (Escape is swallowed) and plays ONCE EVER.
//
// Persistence is per puzzle TYPE (not per puzzle id): "learn match once" — the
// same mechanic tutorial shouldn't replay because a different pack also opens
// with a match puzzle. Both entry puzzles can carry the content; whichever the
// player meets first plays, and the type is then marked done (same save list as
// the room tutorials; Settings → "Replay tutorials" clears it all).
//
// Content stays in the pack (`payload.guided_tutorial`, the same DialogueBeat
// shape the room world uses — `speaker`/`trigger` are ignored here); the enum of
// waitFor kinds and this display mechanism are engine. See content/TUTORIAL_SCRIPTS.md.
// ---------------------------------------------------------------------------

import type { DialogueBeat, Puzzle, TutorialWaitFor } from "../../schema/types";
import { hasCompletedTutorial, completeTutorial } from "../core/codex";

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
  const saveKey = puzzle.puzzle_type; // per-TYPE persistence (see header comment)
  if (!beats.length || hasCompletedTutorial(saveKey)) return NOOP;

  // --- the bar (own scoped classes — leaks into no renderer's board styles) ---
  const bar = document.createElement("div");
  bar.className = "tutorial-bar";
  const text = document.createElement("span");
  const cue = document.createElement("div");
  cue.className = "tutorial-bar-cue";
  bar.append(text, cue);
  container.appendChild(bar);

  let idx = 0;
  let done = false;

  function current(): DialogueBeat | null {
    return done ? null : beats[idx] ?? null;
  }

  function show() {
    const beat = current();
    if (!beat) return;
    text.textContent = beat.text;
    cue.textContent = beat.waitFor ? "" : "Enter ▸";
    bar.classList.remove("shown");
    requestAnimationFrame(() => bar.classList.add("shown"));
  }

  function advance() {
    idx++;
    if (idx < beats.length) { show(); return; }
    finish();
  }

  function finish() {
    done = true;
    completeTutorial(saveKey);
    bar.remove();
    container.removeEventListener("keydown", onKeydown, true);
    if (activeTeardown === teardown) activeTeardown = null;
  }

  // Info steps behave like room dialogue: gameplay keys are suppressed, Enter
  // advances, Escape does nothing (unskippable). waitFor steps let everything
  // through — the player's real action reaches the board and comes back as notify().
  function onKeydown(e: KeyboardEvent) {
    const beat = current();
    if (!beat || beat.waitFor) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") advance();
  }
  container.addEventListener("keydown", onKeydown, true);

  const teardown = () => {
    done = true;
    bar.remove();
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
