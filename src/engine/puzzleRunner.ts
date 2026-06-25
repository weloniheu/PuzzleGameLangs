import type { Puzzle } from "../schema/types";
import { getRenderer } from "./renderers";
import { getValidator } from "./validators";

export interface RunnerCallbacks {
  onSolved: (puzzle: Puzzle) => void;
}

/**
 * Runs ONE puzzle inside `host`. Wires:
 *   - input method     -> renderer (by puzzle_type)
 *   - validation logic  -> validator (by validator_type)
 *   - hint system       -> progressive reveal of puzzle.hints
 *   - win condition     -> onSolved callback
 *
 * Entirely language-agnostic. It reads type keys off the schema and dispatches.
 */
export function runPuzzle(host: HTMLElement, puzzle: Puzzle, cb: RunnerCallbacks): void {
  const renderer = getRenderer(puzzle.puzzle_type);
  const validator = getValidator(puzzle.validator_type);

  host.innerHTML = "";

  const header = document.createElement("div");
  header.className = "puzzle-header";
  header.innerHTML =
    `<span class="lang">${puzzle.language}</span>` +
    `<span class="type">${puzzle.puzzle_type}</span>` +
    `<span class="diff">difficulty ${puzzle.difficulty}</span>`;
  host.appendChild(header);

  const promptEl = document.createElement("p");
  promptEl.className = "prompt";
  promptEl.textContent = puzzle.prompt;
  host.appendChild(promptEl);

  const playArea = document.createElement("div");
  playArea.className = "play-area";
  host.appendChild(playArea);

  const feedback = document.createElement("p");
  feedback.className = "feedback";
  host.appendChild(feedback);

  // --- hint system ---
  let hintLevel = 0;
  const hintBar = document.createElement("div");
  hintBar.className = "hint-bar";
  const hintBtn = document.createElement("button");
  hintBtn.className = "hint";
  hintBtn.textContent = puzzle.hints.length ? "Show a hint" : "No hints";
  hintBtn.disabled = puzzle.hints.length === 0;
  const hintText = document.createElement("p");
  hintText.className = "hint-text";
  hintBtn.onclick = () => {
    if (hintLevel < puzzle.hints.length) {
      hintText.textContent = puzzle.hints[hintLevel];
      hintLevel++;
      if (hintLevel >= puzzle.hints.length) {
        hintBtn.disabled = true;
        hintBtn.textContent = "No more hints";
      }
    }
  };
  hintBar.appendChild(hintBtn);
  hintBar.appendChild(hintText);
  host.appendChild(hintBar);

  renderer.render(playArea, puzzle, (submission) => {
    const result = validator.validate(submission, puzzle.solution);
    feedback.textContent = result.feedback;
    feedback.classList.toggle("ok", result.correct);
    feedback.classList.toggle("no", !result.correct);
    if (result.correct) cb.onSolved(puzzle);
  });
}
