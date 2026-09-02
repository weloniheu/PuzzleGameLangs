// ---------------------------------------------------------------------------
// Level SCORING (PURE, DOM-free, tested).
//
// A run is measured in the four things the ENGINE can see for EVERY puzzle type
// (CLAUDE.md Rule 1): wall-clock time, steps walked, hint-giver lines served, and
// failed solve attempts the mounted module chose to report. No language, level or
// module is named here — a level only tunes the EXPECTATION, via its own `par`
// (CONTENT, in the pack: `mechanics.par`). A level that declares none is scored
// against the engine defaults below.
//
// Clearing a level can never score zero stars: the card rewards how you did, it
// never takes the win away.
// ---------------------------------------------------------------------------

/** What one attempt at a level cost. Every field is engine-observable. */
export interface RunStats {
  /** Wall-clock ms from mounting the room to solving it. */
  elapsedMs: number;
  /** Cells actually walked (a blocked press doesn't count). */
  steps: number;
  /** Hint-giver lines served. */
  hints: number;
  /** Solve attempts that did NOT pass (a failed Run / submit), as reported by the module. */
  misses: number;
}

/** A level's own expectation (CONTENT — `mechanics.par`). Absent fields fall back. */
export interface Par {
  seconds?: number;
  steps?: number;
}

/** One row of the score card: a measured value and what it cost (0 = free). */
export interface ScoreLine {
  label: string;
  value: string;
  /** Points this row took off the total (always ≥ 0). */
  penalty: number;
}

export type Grade = "S" | "A" | "B" | "C" | "D";

export interface ScoreCard {
  points: number;
  grade: Grade;
  /** 1-3. Finishing at all is worth one. */
  stars: number;
  lines: ScoreLine[];
}

export const MAX_POINTS = 1000;
/** Engine defaults, used when the level declares no par of its own. */
export const PAR_SECONDS = 150;
export const PAR_STEPS = 120;

const MISS_COST = 60;        // per failed Run / submit
const HINT_COST = 75;        // per hint-giver line served
const SECOND_COST = 2;       // per second over par…
const TIME_PENALTY_CAP = 250; // …capped, so a slow run is never a zero
const STEP_COST = 0.5;       // per step over par…
const STEP_PENALTY_CAP = 150; // …also capped

const GRADE_CUTS: [number, Grade][] = [[950, "S"], [850, "A"], [700, "B"], [500, "C"]];

/** m:ss (h:mm:ss past an hour) — the card's time row. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Points lost for exceeding a par, at `cost` each, never more than `cap`. */
function overPar(actual: number, par: number, cost: number, cap: number): number {
  return Math.min(cap, Math.round(Math.max(0, actual - par) * cost));
}

export function gradeFor(points: number): Grade {
  return GRADE_CUTS.find(([cut]) => points >= cut)?.[1] ?? "D";
}

/** 3 for a clean fast run, 2 for a solid one, 1 for finishing at all. */
export function starsFor(points: number): number {
  if (points >= 850) return 3;
  if (points >= 700) return 2;
  return 1;
}

/**
 * Score one completed run. Full marks, minus what the run cost:
 *   • each failed attempt and each hint is a flat charge;
 *   • time and steps only charge for what went OVER par, and both are capped.
 * The result is clamped to [0, MAX_POINTS] — the arithmetic can't run away.
 */
export function scoreRun(stats: RunStats, par: Par = {}): ScoreCard {
  const parSeconds = par.seconds ?? PAR_SECONDS;
  const parSteps = par.steps ?? PAR_STEPS;

  const timePenalty = overPar(stats.elapsedMs / 1000, parSeconds, SECOND_COST, TIME_PENALTY_CAP);
  const stepPenalty = overPar(stats.steps, parSteps, STEP_COST, STEP_PENALTY_CAP);
  const hintPenalty = Math.max(0, stats.hints) * HINT_COST;
  const missPenalty = Math.max(0, stats.misses) * MISS_COST;

  const lines: ScoreLine[] = [
    { label: "Time", value: formatDuration(stats.elapsedMs), penalty: timePenalty },
    { label: "Steps", value: String(Math.max(0, stats.steps)), penalty: stepPenalty },
    { label: "Hints used", value: String(Math.max(0, stats.hints)), penalty: hintPenalty },
    { label: "Failed runs", value: String(Math.max(0, stats.misses)), penalty: missPenalty },
  ];

  const spent = lines.reduce((sum, l) => sum + l.penalty, 0);
  const points = Math.max(0, Math.min(MAX_POINTS, MAX_POINTS - spent));
  return { points, grade: gradeFor(points), stars: starsFor(points), lines };
}
