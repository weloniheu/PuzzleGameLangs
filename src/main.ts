import "./style.css";
import type { Pack, Puzzle } from "./schema/types";
import { loadPack } from "./engine/packLoader";
import { runPuzzle } from "./engine/puzzleRunner";
import { resetCodex } from "./engine/codex";

// This is the END-TO-END MVP LOOP (roadmap Phase 5.3):
// load curated pack -> run each puzzle -> render+validate from schema -> on solve, advance.
// A real build replaces this driver with a top-down world (Phase 2.1) where
// walking into a puzzle node calls runPuzzle().

// ---------------------------------------------------------------------------
// Test harness: the set of packs you can load for playtesting. Each entry is a
// pure DATA file — adding a new "language" to try means adding a line here and a
// JSON pack, with ZERO engine changes. The dropdown lets a tester hot-swap them.
// ---------------------------------------------------------------------------
interface PackOption {
  label: string;
  url: string;
}
const PACKS: PackOption[] = [
  { label: "🐍 Python — code blocks", url: "/content/packs/python.code.v1.jsonc" },
  { label: "🔤 English — grammar & sentences", url: "/content/packs/english.grammar.v1.jsonc" },
  { label: "🧩 Logic — word combos", url: "/content/packs/logic.combine.v1.jsonc" },
  { label: "🌺 Hawaiian — vocabulary", url: "/content/packs/hawaiian.match.v1.jsonc" },
];

const app = document.getElementById("app")!;

async function main() {
  // --- pack picker (testing convenience) ---
  const bar = document.createElement("div");
  bar.className = "pack-bar";
  const picker = document.createElement("select");
  picker.className = "pack-picker";
  PACKS.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = p.label;
    picker.appendChild(opt);
  });
  const codexBtn = document.createElement("button");
  codexBtn.className = "reset-btn";
  codexBtn.textContent = "🧹 Reset Codex";
  codexBtn.title = "Forget all discovered commands (fresh playthrough)";
  codexBtn.onclick = () => {
    resetCodex();
    load(Number(picker.value));
  };
  bar.append(picker, codexBtn);
  app.appendChild(bar);

  const stage = document.createElement("div");
  stage.className = "stage";
  app.appendChild(stage);

  const progress = document.createElement("div");
  progress.className = "progress";
  app.appendChild(progress);

  async function load(index: number) {
    stage.innerHTML = `<p class="progress">Loading…</p>`;
    let pack: Pack;
    try {
      pack = await loadPack(PACKS[index].url);
    } catch (e) {
      stage.innerHTML = `<p class="feedback no">Could not load pack: ${(e as Error).message}</p>`;
      progress.textContent = "";
      return;
    }

    // Order easy -> hard to fake a tiny progression curve (Phase 7).
    const puzzles = [...pack.puzzles].sort((a, b) => a.difficulty - b.difficulty);
    let i = 0;

    function show(puzzle: Puzzle) {
      progress.textContent = `Puzzle ${i + 1} of ${puzzles.length} — ${pack.language} pack`;
      runPuzzle(stage, puzzle, {
        onSolved: () => {
          const next = document.createElement("button");
          next.className = "submit next";
          next.textContent = i + 1 < puzzles.length ? "Next puzzle →" : "🎉 Pack complete — restart";
          next.onclick = () => {
            i = i + 1 < puzzles.length ? i + 1 : 0;
            show(puzzles[i]);
          };
          stage.appendChild(next);
        },
      });
    }

    if (puzzles.length) show(puzzles[i]);
    else stage.innerHTML = `<p class="feedback no">No playable puzzles in this pack.</p>`;
  }

  picker.onchange = () => load(Number(picker.value));
  load(0);
}

main();
