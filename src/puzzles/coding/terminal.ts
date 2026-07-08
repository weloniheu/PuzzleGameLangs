// ---------------------------------------------------------------------------
// The coding terminal — the pretend shell transcript, rebuilt on the generic
// panel primitive (engine/systems/panel.ts). Same DOM/classes as before
// (.room-terminal…), same geometry defaults, same dock/pop/drag behavior.
// Nothing executes here: write() echoes flavor text only (CLAUDE.md Rule 3).
// ---------------------------------------------------------------------------

import { createPanel } from "../../engine/systems/panel";
import { roomSettings } from "../../engine/systems/settingsPanel";
import type { PanelHandle } from "../../engine/puzzleModule";

const TERM_DOCKED_H = 200;  // docked terminal band height — crops the camera, never the tile
const TERM_DOCK_MIN_H = 80; // docked band drags between this and (room height − 1 row)
const TERM_MIN_W = 280;     // popped terminal minimum size
const TERM_MIN_H = 140;

export type TermState = "neutral" | "success" | "error";

export interface Terminal extends PanelHandle {
  applyMode(): void;
  clampAndPlace(): void;
  applyFont(): void;
  /** Echo flavor lines into the transcript (nothing executes). */
  write(lines: string[], state: TermState): void;
}

export function createTerminal(deps: {
  container: HTMLElement;
  /** Max docked-band height at drag time (room height minus one row). */
  maxDockedH(): number;
  onModeToggled(): void;
  onDockResize(): void;
  onInteractEnd(): void;
}): Terminal {
  const panel = createPanel({
    container: deps.container,
    classPrefix: "room-terminal",
    title: "terminal",
    initialBody: ">>> ready",
    minW: TERM_MIN_W,
    minH: TERM_MIN_H,
    dockMinH: TERM_DOCK_MIN_H,
    initial: { dockedH: TERM_DOCKED_H, x: 48, y: 88, w: 480, h: 280 },
    maxDockedH: deps.maxDockedH,
    onModeToggled: deps.onModeToggled,
    onDockResize: deps.onDockResize,
    onInteractEnd: deps.onInteractEnd,
  });

  return {
    isDocked: panel.isDocked,
    dockedH: panel.dockedH,
    containsActive: panel.containsActive,
    applyMode: panel.applyMode,
    clampAndPlace: panel.clampAndPlace,
    layoutDocked: panel.layoutDocked,
    applyFont: () => {
      panel.body.style.fontSize = `${roomSettings.termFontPx}px`;
    },
    write: (lines, state) => {
      panel.body.textContent = lines.join("\n");
      panel.body.classList.toggle("term-success", state === "success");
      panel.body.classList.toggle("term-error", state === "error");
    },
  };
}
