// ---------------------------------------------------------------------------
// The 4-rung LADDER (5a). PURE, DOM-free, tested.
//
// Rung 1 (Puzzle Type) is the hub itself — its portals. A portal (or a level
// room's menu portal) opens this ladder at the LANGUAGE rung, which drills
// Language → Mechanic → Difficulty (the level list). The engine groups levels
// by `language` / `mechanic` as OPAQUE equality keys (stamped at merge — see
// main.ts) and never branches on their values, so CLAUDE.md Rule 1 holds.
//
// Availability keeps progression.ts's rule: a level is available when its
// `unlock` key is earned (no skip-ahead). Unavailable LEVELS stay hidden;
// a language/mechanic GROUP with nothing available shows greyed ("locked"),
// like the coming-soon sibling languages (locked_languages).
// ---------------------------------------------------------------------------

import type { LevelEntry, MechanicsConfig, Modifier } from "../../schema/types";
import { HUB_ID } from "./progression";

/** A level entry stamped with its ladder grouping keys (merge-time; see main.ts). */
export interface LadderLevel extends LevelEntry {
  language: string;        // grouping key — engine-opaque
  mechanic: string;        // grouping key — engine-opaque
  /** Display name for the language group (pack's `language_label`). */
  languageLabel?: string;
  /** Resolved teleport flash color for going to this level (manager-stamped). */
  flashColor?: string;
}

/** A greyed "coming soon" sibling language (ProgressionEntry.locked_languages). */
export interface LockedLanguage { label: string; beat?: string }

/** Everything one ladder needs, scoped to ONE puzzle type. */
export interface LadderData {
  levels: LadderLevel[];
  lockedLanguages: LockedLanguage[];
  unlocks: ReadonlySet<string>;
  /** The level id the player is currently inside (drives the CURRENT tag), or null. */
  currentId: string | null;
}

export type LadderRowKind = "enter" | "level" | "hub" | "back" | "locked";
export interface LadderRow {
  kind: LadderRowKind;
  label: string;
  /** "enter" rows: the grouping key to drill into. */
  key?: string;
  /** "level" rows: the room id to transition to. "hub" rows carry HUB_ID. */
  id?: string;
  /** The small dark CURRENT tag — where the player actually is, cursor-independent. */
  current?: boolean;
  /** "locked" rows: the line spoken when selected (instead of transitioning). */
  beat?: string;
  flashColor?: string;
}
export interface LadderRung {
  title: string;
  rows: LadderRow[];
}

/** Canonical mechanic display order + labels. Unknown keys append after, capitalized —
 *  a NEW mechanic key in content still renders without an engine change. */
const MECHANIC_ORDER = ["base", "mixed", "explicit", "shuffled", "shrouded"];
const MECHANIC_LABELS: Record<string, string> = {
  base: "Base", mixed: "Mixed", explicit: "Explicit",
  shuffled: "Shuffled", shrouded: "Shrouded",
};

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function mechanicLabel(key: string): string {
  return MECHANIC_LABELS[key] ?? capitalize(key);
}

/**
 * A level's mechanic grouping key, derived from its puzzle:
 *   mechanics.tier when set (code: base / mixed / explicit);
 *   else the MODIFIERS SIGNATURE — [] → base, {randomized} → shuffled,
 *   {randomized, lowlight} → shrouded (order-insensitive);
 *   any other combination → its sorted join (still a stable opaque key).
 * An entry's explicit `mechanic` (checked by the caller) overrides this.
 */
export function resolveMechanic(puzzle?: { mechanics?: MechanicsConfig; modifiers?: Modifier[] } | null): string {
  if (puzzle?.mechanics?.tier) return puzzle.mechanics.tier;
  const mods = new Set(puzzle?.modifiers ?? []);
  if (mods.size === 0) return "base";
  if (mods.size === 1 && mods.has("randomized")) return "shuffled";
  if (mods.size === 2 && mods.has("randomized") && mods.has("lowlight")) return "shrouded";
  return [...mods].sort().join("+");
}

/** progression.ts's availability rule, unchanged: no key, or the key is earned. */
const available = (lv: LevelEntry, unlocks: ReadonlySet<string>) =>
  !lv.unlock || unlocks.has(lv.unlock);

const BACK_ROW: LadderRow = { kind: "back", label: "← Back" };
const hubRow = (): LadderRow => ({ kind: "hub", label: "⌂ Return to hub", id: HUB_ID });
/** Every rung ends with the same two NAV rows: ← Back (one rung up) then the
 *  always-available ⌂ Return to hub. Choices come first so the cursor opens on one. */
const navRows = (): LadderRow[] => [BACK_ROW, hubRow()];

/** One position in the drill-down (no keys = the language rung). */
export interface LadderStep { lang?: string; mech?: string }

/** Where the chooser OPENS: the rung stack that lands on the level the player is
 *  already in (language → mechanic → level), so re-opening the portal shows the
 *  menu they left rather than restarting at the top. Unknown/absent current level
 *  → the language rung alone. PURE. */
export function ladderPath(data: LadderData): LadderStep[] {
  const lv = data.levels.find((l) => l.id === data.currentId);
  if (!lv) return [{}];
  return [{}, { lang: lv.language }, { lang: lv.language, mech: lv.mechanic }];
}

/** Distinct values of `key` over `levels`, in first-appearance order. */
function distinct(levels: LadderLevel[], key: (lv: LadderLevel) => string): string[] {
  const seen: string[] = [];
  for (const lv of levels) {
    const k = key(lv);
    if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

/** Rung 2 — LANGUAGE: one row per language present in the level list (pack order),
 *  plus the greyed coming-soon siblings, then the ← Back / ⌂ Return to hub nav rows. */
export function languageRung(data: LadderData, title: string): LadderRung {
  const rows: LadderRow[] = [];
  for (const lang of distinct(data.levels, (lv) => lv.language)) {
    const group = data.levels.filter((lv) => lv.language === lang);
    const anyAvailable = group.some((lv) => available(lv, data.unlocks));
    rows.push({
      kind: anyAvailable ? "enter" : "locked",
      key: lang,
      label: group.find((lv) => lv.languageLabel)?.languageLabel ?? capitalize(lang),
      current: group.some((lv) => lv.id === data.currentId),
    });
  }
  for (const locked of data.lockedLanguages) {
    rows.push({ kind: "locked", label: locked.label, beat: locked.beat });
  }
  rows.push(...navRows());
  return { title, rows };
}

/** Rung 3 — MECHANIC: the chosen language's mechanics in canonical order
 *  (Base → Mixed → Explicit / Base → Shuffled → Shrouded), unknown keys after. */
export function mechanicRung(data: LadderData, lang: string): LadderRung {
  const inLang = data.levels.filter((lv) => lv.language === lang);
  const keys = distinct(inLang, (lv) => lv.mechanic).sort((a, b) => {
    const ia = MECHANIC_ORDER.indexOf(a);
    const ib = MECHANIC_ORDER.indexOf(b);
    return (ia === -1 ? MECHANIC_ORDER.length : ia) - (ib === -1 ? MECHANIC_ORDER.length : ib);
  });
  const rows: LadderRow[] = [];
  for (const mech of keys) {
    const group = inLang.filter((lv) => lv.mechanic === mech);
    const anyAvailable = group.some((lv) => available(lv, data.unlocks));
    rows.push({
      kind: anyAvailable ? "enter" : "locked",
      key: mech,
      label: mechanicLabel(mech),
      current: group.some((lv) => lv.id === data.currentId),
    });
  }
  rows.push(...navRows());
  const langLabel = inLang.find((lv) => lv.languageLabel)?.languageLabel ?? capitalize(lang);
  return { title: `${langLabel} — mechanic`, rows };
}

/** Rung 4 — DIFFICULTY (the level list): only AVAILABLE levels appear, in pack
 *  order (no skip-ahead — same rule the flat menu enforced). */
export function levelRung(data: LadderData, lang: string, mechanic: string): LadderRung {
  const rows: LadderRow[] = [];
  for (const lv of data.levels) {
    if (lv.language !== lang || lv.mechanic !== mechanic) continue;
    if (!available(lv, data.unlocks)) continue;
    rows.push({
      kind: "level",
      id: lv.id,
      label: lv.label,
      current: lv.id === data.currentId,
      flashColor: lv.flashColor,
    });
  }
  rows.push(...navRows());
  return { title: `${mechanicLabel(mechanic)} — level`, rows };
}
