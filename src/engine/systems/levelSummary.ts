// ---------------------------------------------------------------------------
// LEVEL COMPLETE card (shared engine system). The window that takes over the
// moment a level is solved: how the run went (core/score.ts) and where to go
// next — the next rung of the ladder, this level again, the level chooser, or
// the hub.
//
// This is the surface that replaced the old "auto-open the chooser on solve"
// toggle: same job (move on without walking back to the portal), plus the score.
//
// Generic by construction (CLAUDE.md Rule 1): it is handed a ScoreCard and an
// optional next-level row, and knows nothing about puzzle types, languages or
// levels. Keyboard-first like every other menu (arrows move, Enter selects, Esc
// dismisses back into the room); mouse clicks work as a secondary, and hovering
// never steals the keyboard cursor.
//
// PURE, testable bit: `summaryChoices` — which buttons a finished level offers.
// ---------------------------------------------------------------------------

import type { ScoreCard } from "../core/score";
import { moveSelection } from "./portals";

/** What the player picked on the card. The host decides what each one MEANS. */
export type SummaryAction =
  | { kind: "next"; id: string; flashColor?: string }
  | { kind: "replay" }
  | { kind: "menu" }
  | { kind: "hub" }
  | { kind: "stay" };

export interface SummaryChoice {
  label: string;
  action: SummaryAction;
  /** The headline choice (the one the cursor opens on, styled as primary). */
  primary?: boolean;
}

/** The next rung, when the ladder still has one open. */
export interface NextLevel {
  id: string;
  label: string;
  flashColor?: string;
}

/**
 * The card's buttons, in order. With a next level: it leads, as the primary
 * choice. Without one (the ladder's last rung, or nothing else unlocked yet),
 * the hub leads instead — there is always somewhere to go. PURE.
 */
export function summaryChoices(next: NextLevel | null): SummaryChoice[] {
  const rest: SummaryChoice[] = [
    { label: "↻ Play again", action: { kind: "replay" } },
    { label: "☰ Choose a level", action: { kind: "menu" } },
    { label: "⌂ Return to hub", action: { kind: "hub" } },
  ];
  if (!next) return [{ ...rest[rest.length - 1], primary: true }, ...rest.slice(0, -1)];
  return [
    { label: `${next.label} →`, action: { kind: "next", id: next.id, flashColor: next.flashColor }, primary: true },
    ...rest,
  ];
}

export interface LevelSummaryDeps {
  /** Hosts the overlay (the fullscreen room container). */
  container: HTMLElement;
  /** Commit a choice — the host wires these to the same transitions the chooser uses. */
  onChoose(action: SummaryAction): void;
}

export interface LevelSummary {
  isOpen(): boolean;
  /** Show the card. `title` names the level that was just cleared. */
  open(opts: { title: string; card: ScoreCard; next: NextLevel | null }): void;
  /** Take the card down WITHOUT choosing anything (the "stay" path). */
  close(): void;
  moveSel(delta: number): void;
  select(): void;
}

export function createLevelSummary(deps: LevelSummaryDeps): LevelSummary {
  const root = document.createElement("div");
  root.className = "room-summary";
  root.hidden = true;
  const card = document.createElement("div");
  card.className = "room-summary-card";
  root.appendChild(card);
  deps.container.appendChild(root);

  let open = false;
  let choices: SummaryChoice[] = [];
  let sel = 0;
  let buttons: HTMLButtonElement[] = [];

  const paint = () => buttons.forEach((b, i) => b.classList.toggle("selected", i === sel));

  function build(opts: { title: string; card: ScoreCard; next: NextLevel | null }) {
    card.innerHTML = "";
    choices = summaryChoices(opts.next);
    sel = choices.findIndex((c) => c.primary);
    if (sel < 0) sel = 0;

    const banner = document.createElement("p");
    banner.className = "room-summary-banner";
    banner.textContent = "LEVEL COMPLETE";
    const title = document.createElement("p");
    title.className = "room-summary-title";
    title.textContent = opts.title;

    // Grade block (STYLE 9a): a pressed wax seal carries the letter, with a slow shine
    // crossing it; the stars are the second glance and the points a footnote under them.
    // The seal's colour comes from the ROOM SKIN (--sum-grade-ink), not from the grade.
    const gradeWrap = document.createElement("div");
    gradeWrap.className = "room-summary-grade";
    const seal = document.createElement("div");
    seal.className = "room-summary-seal";
    const shine = document.createElement("div");
    shine.className = "room-summary-seal-shine";
    const letter = document.createElement("span");
    letter.className = "room-summary-letter";
    letter.textContent = opts.card.grade;
    seal.append(shine, letter);
    const stars = document.createElement("span");
    stars.className = "room-summary-stars";
    stars.textContent = "★".repeat(opts.card.stars) + "☆".repeat(Math.max(0, 3 - opts.card.stars));
    const points = document.createElement("span");
    points.className = "room-summary-points";
    points.textContent = `${opts.card.points} pts`;
    gradeWrap.append(seal, stars, points);

    // One row per measured cost. A row that cost nothing shows no penalty chip at
    // all — a clean run reads as clean rather than as a wall of "-0".
    const stats = document.createElement("div");
    stats.className = "room-summary-stats";
    for (const line of opts.card.lines) {
      const row = document.createElement("div");
      row.className = "room-summary-row";
      const label = document.createElement("span");
      label.className = "room-summary-label";
      label.textContent = line.label;
      const value = document.createElement("span");
      value.className = "room-summary-value";
      value.textContent = line.value;
      row.append(label);
      // The chip sits LEFT of the value so the mono digits stay in one right-hand
      // column whether or not the row cost anything.
      if (line.penalty > 0) {
        const penalty = document.createElement("span");
        penalty.className = "room-summary-penalty";
        penalty.textContent = `−${line.penalty}`;
        row.appendChild(penalty);
      }
      row.appendChild(value);
      stats.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "room-summary-actions";
    buttons = choices.map((choice, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `room-summary-btn${choice.primary ? " primary" : ""}`;
      b.textContent = choice.label;
      b.onclick = () => { sel = i; select(); };
      actions.appendChild(b);
      return b;
    });

    const hint = document.createElement("p");
    hint.className = "room-summary-hint";
    hint.textContent = "↑↓ choose · Enter go · Esc stay here";

    card.append(banner, title, gradeWrap, stats, actions, hint);
    paint();
  }

  function select() {
    const choice = choices[sel];
    if (!choice) return;
    close();
    deps.onChoose(choice.action);
  }

  function close() {
    open = false;
    root.hidden = true;
  }

  // Clicking the backdrop dismisses the card back into the room (same as Esc).
  root.addEventListener("pointerdown", (e) => {
    if (e.target !== root) return;
    close();
    deps.onChoose({ kind: "stay" });
  });

  return {
    isOpen: () => open,
    open(opts) {
      build(opts);
      open = true;
      root.hidden = false;
    },
    close,
    moveSel(delta) {
      sel = moveSelection(sel, delta, choices.length);
      paint();
    },
    select,
  };
}
