import type { PuzzleRenderer, Puzzle, SentencePayload } from "../../schema/types";
import { createGridArena } from "./gridArena";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * `sentence_build` (grammar) as a top-down board. Above, the pack's STRUCTURE is
 * drawn as labelled slots (subject → verb → object …). Below, the role-tagged
 * words are floor tiles. The player walks to a word and presses Enter to drop it
 * into the next open slot; standing on a word that's already placed and pressing
 * Enter takes it back. Slots glow green/red by whether the word's role fits — so
 * the learner feels the structure while walking it out.
 *
 * Correctness is still decided by `sequence_match` against solution.order; the
 * engine never parses English. Auto-submits once every slot is filled.
 */
export const sentenceRenderer: PuzzleRenderer = {
  render(container, puzzle: Puzzle, onSubmit) {
    const payload = puzzle.payload as SentencePayload;
    const roleOf = new Map(payload.words.map((w) => [w.text, w.role]));
    const order = shuffle(payload.words); // tile layout order (stable for this render)
    const placed: (string | null)[] = payload.structure.map(() => null);

    container.innerHTML = "";

    if (payload.example) {
      const ex = document.createElement("p");
      ex.className = "arena-caption";
      ex.innerHTML = `Like this: <em>${payload.example}</em>`;
      container.appendChild(ex);
    }

    // --- the sentence structure (display only; the player edits via word tiles) ---
    const board = document.createElement("div");
    board.className = "sentence-board";
    container.appendChild(board);

    const slotEls = payload.structure.map((slot) => {
      const cell = document.createElement("div");
      cell.className = "sentence-slot empty";
      const tag = document.createElement("span");
      tag.className = "slot-tag";
      tag.textContent = `${slot.label} (${slot.role})`;
      const fill = document.createElement("div");
      fill.className = "slot-fill";
      cell.append(tag, fill);
      board.appendChild(cell);
      return cell;
    });

    function drawSlots() {
      payload.structure.forEach((slot, i) => {
        const text = placed[i];
        (slotEls[i].querySelector(".slot-fill") as HTMLElement).textContent = text ?? "";
        slotEls[i].classList.toggle("empty", !text);
        const roleOk = text != null && roleOf.get(text) === slot.role;
        slotEls[i].classList.toggle("role-ok", roleOk);
        slotEls[i].classList.toggle("role-bad", text != null && !roleOk);
      });
      if (placed.every((p) => p !== null)) onSubmit(placed.slice());
    }

    function toggleWord(text: string) {
      const at = placed.indexOf(text);
      if (at !== -1) {
        placed[at] = null; // already placed — take it back
      } else {
        const open = placed.findIndex((p) => p === null);
        if (open === -1) return; // board full
        placed[open] = text;
      }
      drawSlots();
      arena.refresh();
    }

    const arenaHost = document.createElement("div");
    container.appendChild(arenaHost);

    const arena = createGridArena(arenaHost, {
      cols: Math.min(order.length, 4),
      caption: "Walk to a word and press Enter to place it. Press Enter on a placed word to take it back.",
      cellW: 132,
      tiles: order.map((w) => ({
        label: w.text,
        className: "word-tile",
        onActivate: () => toggleWord(w.text),
      })),
      tileState: (_t, i) => (placed.includes(order[i].text) ? { className: "used" } : undefined),
    });

    drawSlots();
  },
};
