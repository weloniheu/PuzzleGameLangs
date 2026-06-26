import type { PuzzleRenderer, Puzzle, CodeBuildPayload, CodeToken } from "../../schema/types";
import { discover, renderCodexPanel } from "../core/codex";
import { createGridArena } from "./gridArena";

/**
 * `code_build` as a top-down board. The story, Codex, the line you're building,
 * and its output are shown above. The command BLOCKS (and the Run / Backspace /
 * Clear actions) are floor tiles: the player walks onto a block and presses Enter
 * to append it to the line, walks onto ▶ Run to execute it.
 *
 * A deliberately tiny, SAFE pattern-interpreter "runs" the line (no eval, no
 * sandbox — the heavy `execution_match` tier stays deferred). It only understands
 * `print("…")`. The output string is submitted to `code_match`; successfully
 * USING a tagged command adds it to the persistent Codex for later puzzles.
 */
function runLine(raw: string): { output: string; recognized: boolean } {
  const code = raw.replace(/\s+/g, "");
  const m = code.match(/^print\((?:"([^"]*)"|'([^']*)')\)$/);
  if (m) return { output: m[1] ?? m[2] ?? "", recognized: true };
  return { output: "", recognized: false };
}

function noteFor(tok: CodeToken): string {
  if (tok.discovers === "print") return "shows text to the world";
  return tok.kind;
}

export const codeRenderer: PuzzleRenderer = {
  render(container, puzzle: Puzzle, onSubmit) {
    // NOTE: room-based (world-layer) puzzles are mounted FULLSCREEN by main.ts and
    // never reach this card renderer. This path is the card-based token board.
    const payload = puzzle.payload as CodeBuildPayload;
    const line: CodeToken[] = [];

    container.innerHTML = "";

    const scenario = document.createElement("p");
    scenario.className = "code-scenario";
    scenario.textContent = payload.scenario;
    container.appendChild(scenario);

    const goal = document.createElement("p");
    goal.className = "combine-goal";
    goal.innerHTML = `🎯 <strong>Goal:</strong> ${payload.goal}`;
    container.appendChild(goal);

    const codex = document.createElement("div");
    container.appendChild(codex);
    renderCodexPanel(codex);

    const editor = document.createElement("div");
    editor.className = "code-editor";
    container.appendChild(editor);

    const out = document.createElement("p");
    out.className = "code-output";
    container.appendChild(out);

    function drawLine() {
      editor.innerHTML = line.length
        ? line.map((t) => `<span class="tok kind-${t.kind}">${t.text}</span>`).join("")
        : `<span class="code-placeholder"># walk onto blocks below and press Enter to write a line</span>`;
    }

    function run() {
      const raw = line.map((t) => t.text).join("");
      const { output, recognized } = runLine(raw);
      out.textContent = recognized
        ? `>>> ${output || "(printed nothing)"}`
        : ">>> 🐍 the snake blinks — that line did nothing.";
      out.classList.toggle("dud", !recognized);

      if (recognized) {
        const fresh = discover(
          line.filter((t) => t.discovers).map((t) => ({ name: t.discovers!, note: noteFor(t) })),
        );
        if (fresh.length) {
          renderCodexPanel(codex);
          codex.classList.remove("flash");
          void codex.offsetWidth;
          codex.classList.add("flash");
        }
      }
      onSubmit(output); // code_match compares this to the goal output
    }

    const arenaHost = document.createElement("div");
    container.appendChild(arenaHost);

    const tokenTiles = payload.tokens.map((tok) => ({
      spec: {
        label: tok.text,
        className: `code-token kind-${tok.kind}`,
        onActivate: () => {
          line.push(tok);
          out.textContent = "";
          drawLine();
        },
      },
    }));
    const actionTiles = [
      { spec: { label: "▶ Run", className: "tile-action run", onActivate: () => run() } },
      { spec: { label: "⌫ Back", className: "tile-action", onActivate: () => { line.pop(); out.textContent = ""; drawLine(); } } },
      { spec: { label: "↺ Clear", className: "tile-action", onActivate: () => { line.length = 0; out.textContent = ""; drawLine(); } } },
    ];

    createGridArena(arenaHost, {
      cols: Math.min(payload.tokens.length + actionTiles.length, 4),
      caption: "Walk onto a block and press Enter to add it to your line. Stand on ▶ Run and press Enter to run it.",
      cellW: 120,
      tiles: [...tokenTiles, ...actionTiles].map((t) => t.spec),
    });

    drawLine();
  },
};
