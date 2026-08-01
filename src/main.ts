import "./style.css";
import type { Pack, Puzzle, PuzzleType, TutorialBlock } from "./schema/types";
import { loadPack } from "./engine/packLoader";
import { runPuzzle } from "./engine/puzzleRunner";
import { mountRoom } from "./engine/roomHost";
import { createRoomManager, type RoomManager, type TypeLadder } from "./engine/roomManager";
import { resolveMechanic, type LadderLevel } from "./engine/core/ladder";

// The code game boots into a minimal TEST HUB (throwaway — real hub design comes later);
// the hub's doors transition to the Python code pack's puzzles via the room manager.
const HUB_PACK = "/content/packs/hub.test.v1.json";
const CODE_PACK = "/content/packs/python.code.v1.json";
const LOGIC_ROOM_PACK = "/content/packs/logic.room.en.v1.json";
const LOGIC_ROOM_HAW_PACK = "/content/packs/logic.room.haw.v1.json"; // ʻōlelo Hawaiʻi track
const GRAMMAR_ROOM_PACK = "/content/packs/grammar.room.en.v1.json";
const VOCAB_ROOM_PACK = "/content/packs/vocab.room.haw.v1.json";
const VOCAB_ROOM_EN_PACK = "/content/packs/vocab.room.en.v1.json"; // English synonym tier

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
    mountRoom(gameRoot, puzzle); // the room reads the puzzle's answer/beats/terminal flavor
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
// The LADDER's per-type data (5a): ALL levels across packs, each STAMPED with its
// grouping keys — language (from the entry or its pack) and mechanic (from the entry,
// or derived from the puzzle's tier/modifiers signature). The keys stay OPAQUE to the
// engine (grouped by equality, never branched on), plus the coming-soon languages.
const laddersByType = new Map<PuzzleType, TypeLadder>();
const tutorialsById = new Map<string, TutorialBlock>();   // shared first-encounter tutorials

async function bootHub() {
  if (!roomRegistry.size) {
    const [hub, code, logic, logicHaw, grammar, vocab, vocabEn] = await Promise.all([
      loadPack(HUB_PACK), loadPack(CODE_PACK), loadPack(LOGIC_ROOM_PACK),
      loadPack(LOGIC_ROOM_HAW_PACK), loadPack(GRAMMAR_ROOM_PACK), loadPack(VOCAB_ROOM_PACK),
      loadPack(VOCAB_ROOM_EN_PACK),
    ]);
    for (const p of [...hub.puzzles, ...code.puzzles, ...logic.puzzles, ...logicHaw.puzzles, ...grammar.puzzles, ...vocab.puzzles, ...vocabEn.puzzles]) {
      roomRegistry.set(p.id, p);
    }
    // Merge each pack's progression → the per-type ladder (stamped levels + locked
    // languages) and tutorials → id map (first-encounter).
    for (const pack of [hub, code, logic, logicHaw, grammar, vocab, vocabEn]) {
      for (const prog of pack.progression ?? []) {
        const ladder = laddersByType.get(prog.puzzle_type) ?? { levels: [], lockedLanguages: [] };
        const stamped: LadderLevel[] = prog.levels.map((lv) => ({
          ...lv,
          language: lv.language ?? pack.language,
          languageLabel: pack.language_label,
          mechanic: lv.mechanic ?? resolveMechanic(roomRegistry.get(lv.id)),
        }));
        ladder.levels.push(...stamped);
        ladder.lockedLanguages.push(...(prog.locked_languages ?? []));
        laddersByType.set(prog.puzzle_type, ladder);
      }
      for (const [id, block] of Object.entries(pack.tutorials ?? {})) tutorialsById.set(id, block);
    }
  }
  if (!roomManager) {
    roomManager = createRoomManager(
      gameRoot,
      (id) => roomRegistry.get(id) ?? null,
      (puzzleType) => laddersByType.get(puzzleType) ?? { levels: [], lockedLanguages: [] },
      { onBeforeMount: useFullscreen, tutorialFor: (id) => tutorialsById.get(id) ?? null },
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

// --- title screen (STYLE 3a "Dawn grove"): morning sky, the mascot, ▶ Start ---
// Pure chrome over the boot: Enter (or the Start button) tears it down and enters
// the hub. Static markup only; the slime reuses the shared .slime-* body parts.
function showTitleScreen(onStart: () => void) {
  const screen = document.createElement("div");
  screen.className = "title-screen";
  screen.innerHTML = `
    <div class="title-sun"></div>
    <div class="title-portal title-portal-a"></div>
    <div class="title-portal title-portal-b"></div>
    <div class="title-mote title-mote-a"></div>
    <div class="title-mote title-mote-b"></div>
    <div class="title-word">SLIME</div>
    <div class="title-sub">a puzzle grove</div>
    <div class="title-slime">
      <div class="title-slime-shadow"></div>
      <div class="slime" data-facing="down"><div class="slime-body">
        <div class="slime-pool"></div><div class="slime-shine"></div>
        <div class="slime-spec-a"></div><div class="slime-spec-b"></div>
        <div class="slime-eye slime-eye-l"></div><div class="slime-eye slime-eye-r"></div>
      </div></div>
    </div>
    <button type="button" class="title-start">▶ Start</button>
    <div class="title-hint">PRESS ENTER</div>
  `;
  // The mascot slime is positioned by the .title-slime box, not the room engine.
  const mascot = screen.querySelector(".slime") as HTMLElement;
  mascot.style.position = "absolute";
  mascot.style.inset = "0";
  document.body.appendChild(screen);
  app.hidden = true;

  const start = () => {
    window.removeEventListener("keydown", onKey);
    screen.remove();
    onStart();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter") start(); };
  window.addEventListener("keydown", onKey);
  (screen.querySelector(".title-start") as HTMLButtonElement).onclick = start;
}

showTitleScreen(bootHub);
