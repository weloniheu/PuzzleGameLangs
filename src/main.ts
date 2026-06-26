import "./style.css";
import type { Pack, Puzzle, PuzzleType, LevelEntry } from "./schema/types";
import { loadPack } from "./engine/packLoader";
import { runPuzzle } from "./engine/puzzleRunner";
import { renderRoom } from "./engine/renderers/roomRenderer";
import { createRoomManager, type RoomManager } from "./engine/roomManager";

// The code game boots into a minimal TEST HUB (throwaway — real hub design comes later);
// the hub's doors transition to the Python code pack's puzzles via the room manager.
const HUB_PACK = "/content/packs/hub.test.v1.json";
const CODE_PACK = "/content/packs/python.code.v1.json";

// TEMPORARY dev-only switcher: with the dropdown gone, press 1–4 to load a pack's
// first puzzle for testing (1 = code/fullscreen, 2–4 = the card games). Scaffolding
// until the entrance screen lands; safe because gameplay never uses number keys.
const DEV_PACKS = [
  "/content/packs/python.code.v1.json",
  "/content/packs/english.grammar.v1.json",
  "/content/packs/logic.combine.v1.json",
  "/content/packs/hawaiian.match.v1.json",
];

// Two mount targets, chosen per-puzzle (see showPuzzle):
//   • #app .stage  — the existing centered 720px CARD (match/sentence/combine).
//   • .game-root   — a FULLSCREEN host; the room IS the page (code game).
const app = document.getElementById("app")!;
const stage = document.createElement("div");
stage.className = "stage";
app.appendChild(stage);

const gameRoot = document.createElement("div");
gameRoot.className = "game-root";
gameRoot.hidden = true;
document.body.appendChild(gameRoot);

/** Show the card host, hide the fullscreen one (and vice-versa). */
function useCard() {
  gameRoot.hidden = true;
  app.hidden = false;
  document.body.classList.remove("fullscreen-game");
}
function useFullscreen() {
  app.hidden = true;
  gameRoot.hidden = false;
  document.body.classList.add("fullscreen-game");
}

/**
 * Mount ONE puzzle. The branch is by world layer, not by language/level:
 *   a puzzle with a `room` is a fullscreen world (the code game today);
 *   everything else renders in the #app card via the shared runPuzzle path.
 */
function showPuzzle(puzzle: Puzzle, puzzles: Puzzle[], i: number) {
  if (puzzle.room) {
    useFullscreen();
    renderRoom(gameRoot, puzzle); // the room reads the puzzle's answer/beats/terminal flavor
    return;
  }
  useCard();
  runPuzzle(stage, puzzle, {
    onSolved: () => {
      const next = document.createElement("button");
      next.className = "submit next";
      next.textContent = i + 1 < puzzles.length ? "Next puzzle →" : "🎉 Pack complete — restart";
      next.onclick = () => {
        const ni = i + 1 < puzzles.length ? i + 1 : 0;
        showPuzzle(puzzles[ni], puzzles, ni);
      };
      stage.appendChild(next);
    },
  });
}

async function loadAndShow(url: string) {
  let pack: Pack;
  try {
    pack = await loadPack(url);
  } catch (e) {
    useCard();
    stage.innerHTML = `<p class="feedback no">Could not load pack: ${(e as Error).message}</p>`;
    return;
  }
  // Order easy -> hard to fake a tiny progression curve.
  const puzzles = [...pack.puzzles].sort((a, b) => a.difficulty - b.difficulty);
  if (puzzles.length) showPuzzle(puzzles[0], puzzles, 0);
  else {
    useCard();
    stage.innerHTML = `<p class="feedback no">No playable puzzles in this pack.</p>`;
  }
}

// --- the code game: a room WORLD managed by the room manager (hub + puzzles) ---
// The manager owns "which room is active" and does teardown+mount on every transition.
// Rooms resolve by id from a registry merged across the hub pack and the code pack, so a
// door's `target` (another puzzle, or "hub" for an exit) just names a room.
let roomManager: RoomManager | null = null;
const roomRegistry = new Map<string, Puzzle>();
const levelsByType = new Map<PuzzleType, LevelEntry[]>(); // ordered level lists per puzzle type

async function bootHub() {
  if (!roomRegistry.size) {
    const [hub, code] = await Promise.all([loadPack(HUB_PACK), loadPack(CODE_PACK)]);
    for (const p of [...hub.puzzles, ...code.puzzles]) roomRegistry.set(p.id, p);
    // Merge each pack's progression into one type → ordered-levels map (drives the menu portal).
    for (const pack of [hub, code]) {
      for (const prog of pack.progression ?? []) {
        levelsByType.set(prog.puzzle_type, [...(levelsByType.get(prog.puzzle_type) ?? []), ...prog.levels]);
      }
    }
  }
  if (!roomManager) {
    roomManager = createRoomManager(
      gameRoot,
      (id) => roomRegistry.get(id) ?? null,
      (puzzleType) => levelsByType.get(puzzleType) ?? [],
      { onBeforeMount: useFullscreen },
    );
  }
  roomManager.enter("hub");
}

// TEMP dev switcher: 1 = the code game (hub world); 2–4 = the card games. Switching to a
// card tears the room world down first so no room listeners/timers survive the swap.
window.addEventListener("keydown", (e) => {
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > DEV_PACKS.length) return;
  if (n === 1) { bootHub(); return; }
  roomManager?.teardown();
  loadAndShow(DEV_PACKS[n - 1]);
});

bootHub();
