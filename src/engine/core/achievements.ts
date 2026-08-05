// ---------------------------------------------------------------------------
// ACHIEVEMENTS — the player-facing view of the same unlock keys the ladder and
// the hub doors gate on (see PROGRESSION.md). One achievement == one earned key.
//
// Nothing new is persisted: the tracker DERIVES its rows from the merged
// progression data (the levels each pack declares) plus the grant key each
// level's room hands out, and reads earned/not from the Codex's unlock list.
// Add a level to a pack and it shows up here with no engine change.
//
// Rule 1 holds: this file groups by `puzzle_type` (the engine's one allowed
// dispatch axis) and by the OPAQUE language/mechanic keys the ladder already
// stamps — it never branches on which language or which level.
//
// The pure builders are at the top; the shared DOM renderer (used by BOTH the
// title screen and the settings panel) is at the bottom, mirroring codex.ts.
// ---------------------------------------------------------------------------

import type { PuzzleType } from "../../schema/types";
import { mechanicLabel, type LadderLevel } from "./ladder";

/** puzzle_type → the track name shown as an achievement group heading. Keyed by the
 *  CLOSED enum, so a new content pack never needs an entry here; an unknown type
 *  falls back to its own key. */
const TYPE_LABELS: Partial<Record<PuzzleType, string>> = {
  code_build: "Coding",
  logic_rules: "Logic",
  grammar_build: "Grammar",
  vocab_match: "Language",
  match: "Vocabulary",
  sentence_build: "Grammar",
  combine: "Word logic",
};

export function trackLabel(type: PuzzleType): string {
  return TYPE_LABELS[type] ?? type;
}

/** One achievement: the unlock key a level grants, with the level's own display text. */
export interface AchievementDef {
  /** The unlock key — earning it IS the achievement. */
  key: string;
  /** Row text, e.g. "Logic I" or "Logic I · Shuffled". */
  label: string;
  /** Group heading, e.g. "Logic — English". */
  group: string;
}

export interface AchievementRow extends AchievementDef {
  earned: boolean;
}

export interface AchievementGroup {
  title: string;
  rows: AchievementRow[];
  earned: number;
  total: number;
}

/** What one puzzle type contributes: its stamped levels + how to find a level's grant key. */
export interface AchievementSource {
  puzzleType: PuzzleType;
  levels: LadderLevel[];
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Flatten the merged progression into achievement definitions, in pack order.
 * A level with no grant key earns nothing, so it contributes no achievement; a
 * key already claimed by an earlier level is skipped (the base level wins).
 *
 * @param grantOf  level id → the unlock key its room grants when solved.
 */
export function buildAchievements(
  sources: AchievementSource[],
  grantOf: (levelId: string) => string | undefined,
): AchievementDef[] {
  const defs: AchievementDef[] = [];
  const claimed = new Set<string>();
  for (const src of sources) {
    for (const lv of src.levels) {
      const key = grantOf(lv.id);
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      const language = lv.languageLabel ?? capitalize(lv.language);
      // The harder mechanic variants reuse their base level's label, so the
      // mechanic key disambiguates them ("Logic I" vs "Logic I · Shuffled").
      const label = lv.mechanic === "base" ? lv.label : `${lv.label} · ${mechanicLabel(lv.mechanic)}`;
      defs.push({ key, label, group: `${trackLabel(src.puzzleType)} — ${language}` });
    }
  }
  return defs;
}

/** Group the definitions for display and mark each row earned/not. PURE. */
export function groupAchievements(
  defs: AchievementDef[],
  unlocks: ReadonlySet<string>,
): AchievementGroup[] {
  const groups: AchievementGroup[] = [];
  const byTitle = new Map<string, AchievementGroup>();
  for (const def of defs) {
    let g = byTitle.get(def.group);
    if (!g) {
      g = { title: def.group, rows: [], earned: 0, total: 0 };
      byTitle.set(def.group, g);
      groups.push(g);
    }
    const earned = unlocks.has(def.key);
    g.rows.push({ ...def, earned });
    g.total += 1;
    if (earned) g.earned += 1;
  }
  return groups;
}

/** Totals across every group — the headline "12 / 84" line. PURE. */
export function achievementTotals(groups: AchievementGroup[]): { earned: number; total: number } {
  return groups.reduce(
    (acc, g) => ({ earned: acc.earned + g.earned, total: acc.total + g.total }),
    { earned: 0, total: 0 },
  );
}

// --- shared renderer (title screen + settings panel both mount this) --------

/** Render the tracker into `el` (replacing its contents). Read-only: no controls,
 *  no listeners — the caller owns whatever chrome wraps it. */
export function renderAchievements(el: HTMLElement, groups: AchievementGroup[]): void {
  el.innerHTML = "";
  el.classList.add("achievements");

  const totals = achievementTotals(groups);
  const summary = document.createElement("p");
  summary.className = "achievements-summary";
  summary.textContent = totals.total
    ? `${totals.earned} of ${totals.total} earned`
    : "No achievements yet — start playing to fill this in.";
  el.appendChild(summary);
  if (!totals.total) return;

  const bar = document.createElement("div");
  bar.className = "achievements-bar";
  const fill = document.createElement("div");
  fill.className = "achievements-bar-fill";
  fill.style.width = `${Math.round((totals.earned / totals.total) * 100)}%`;
  bar.appendChild(fill);
  el.appendChild(bar);

  for (const g of groups) {
    const head = document.createElement("div");
    head.className = "achievements-group";
    const title = document.createElement("span");
    title.textContent = g.title;
    const count = document.createElement("span");
    count.className = "achievements-count";
    count.textContent = `${g.earned}/${g.total}`;
    head.append(title, count);
    el.appendChild(head);

    const list = document.createElement("ul");
    list.className = "achievements-list";
    for (const row of g.rows) {
      const li = document.createElement("li");
      li.className = `achievements-row${row.earned ? " earned" : ""}`;
      const mark = document.createElement("span");
      mark.className = "achievements-mark";
      mark.textContent = row.earned ? "★" : "☆";
      const name = document.createElement("span");
      name.textContent = row.label;
      li.append(mark, name);
      list.appendChild(li);
    }
    el.appendChild(list);
  }
}
