// ---------------------------------------------------------------------------
// The CODING module — implements RoomPuzzleModule for `code_build` rooms
// (registered by puzzle_type in puzzles/index.ts). Assembles the terminal
// (feature-gated) + the coding area, and wraps the pack's beat CONTENT
// (answer, feedback text, terminal flavor) around the engine's services.
// The mechanics are engine/shared; everything specific here is pack data.
// ---------------------------------------------------------------------------

import type { CodeBuildPayload, CodeBuildSolution, DialogueBeat, Puzzle } from "../../schema/types";
import type { EngineContext, MountedPuzzle, RoomPuzzleModule } from "../../engine/puzzleModule";
import { createTerminal, type Terminal } from "./terminal";
import { createCodingArea } from "./codingArea";
import { requiresPunctuation, type AnswerLine } from "./codeGameLogic";

export const codingModule: RoomPuzzleModule = {
  puzzleType: "code_build",

  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle {
    // Code-game CONTENT (engine hardcodes none): the answer, beats, and terminal flavor.
    const payload = puzzle.payload as CodeBuildPayload;
    const solution = puzzle.solution as CodeBuildSolution;
    // Accepted programs: `accepted` when the level lists alternates, else `lines` as one variant.
    const accepted: AnswerLine[][] = solution.accepted ?? (solution.lines ? [solution.lines] : []);
    const beats: Record<string, string> = payload.beats ?? {};
    const termCmds = payload.terminal ?? { build: "$ build", run: "$ run" };

    // Coding-puzzle beat factory (CONTENT): wrap a `beats`-map entry (a run reason like
    // "build-first"/"success", or a "first_*" trigger) as a SNAKE portrait beat, or null
    // when the pack defines no text. Also injected into the dialogue presenter as its
    // first-time lookup (see MountedPuzzle.firstTimeBeat).
    function snakeBeat(reason: string): DialogueBeat | null {
      const text = beats[reason];
      if (!text) return null;
      return { id: `beat-${reason}`, speaker: "snake", text, trigger: reason };
    }

    // Terminal FEATURE (gated): built ONLY when declared; otherwise no DOM, no listeners.
    const terminal: Terminal | null = ctx.features.has("terminal")
      ? createTerminal({
          container: ctx.container,
          maxDockedH: () => ctx.fullH() - ctx.tile(), // keep at least one room row visible
          onModeToggled: () => { ctx.reflow(); ctx.focusRoom(); }, // camera-only; no re-tile
          onDockResize: () => ctx.reflow(),
          onInteractEnd: () => ctx.focusRoom(),
        })
      : null;

    const area = createCodingArea({
      ctx,
      accepted,
      output: solution.output,
      requirePunctuation: requiresPunctuation(puzzle.mechanics), // punctuation tier keeps ( ) : ,
      termCmds,
      termWrite: (lines, state) => terminal?.write(lines, state), // no terminal → nowhere to echo
      snakeBeat,
    });

    terminal?.applyMode(); // terminal starts docked (bottom band)
    terminal?.applyFont(); // apply the persisted terminal font size

    return {
      onInteract: (cell) => area.onInteract(cell),
      onAction: (actionId) => area.onAction(actionId),
      relayout: () => {
        area.relayout();
        terminal?.clampAndPlace(); // keep a popped window on-screen after resize
      },
      teardown: () => {},
      panel: terminal,
      firstTimeBeat: snakeBeat,
      onPlayerDraw: () => area.drawDebug(), // current-row readout follows the player
    };
  },
};
