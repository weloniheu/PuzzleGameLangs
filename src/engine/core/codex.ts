// ---------------------------------------------------------------------------
// The Codex — the player's growing list of DISCOVERED commands/functions.
//
// When a player first uses a token that carries a `discovers` tag (e.g. `print`),
// it gets recorded here and persists across puzzles via engine/core/storage. Later
// puzzles can show "you already know: print, return …" so the learner builds a
// vocabulary instead of re-deriving everything each level.
//
// This is intentionally tiny and language-agnostic in spirit; only the code_build
// renderer writes to it today, but the panel can be reused by any puzzle type.
// ---------------------------------------------------------------------------

import { getItem, setItem } from "./storage";

const KEY = "codex.discovered.v1";
// Hub/room unlocks live alongside the Codex under the SAME save system (one place to
// persist, one place to reset). Stored as a flat list of earned unlock keys.
const UNLOCK_KEY = "codex.unlocks.v1";
// A QA toggle, not player progress — deliberately NOT touched by resetCodex(), and
// stored under its own key so it survives a "Reset all progress".
const TEST_MODE_KEY = "codex.testMode.v1";
// Which guided tutorials have already played to the end (or been Escape-skipped) at
// least once. Real player state, so IS wiped by resetCodex() (a fresh start re-teaches
// everything) — but also has its own standalone reset for "Replay Tutorials" in
// Settings, which re-shows tutorials WITHOUT touching earned progress.
const TUTORIALS_SEEN_KEY = "codex.tutorialsSeen.v1";

export interface CodexEntry {
  /** the command name, e.g. "print" */
  name: string;
  /** a short note shown next to it, e.g. "shows text to the world" */
  note?: string;
}

function read(): CodexEntry[] {
  try {
    const raw = getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodexEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: CodexEntry[]): void {
  try {
    setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable (private mode / tests) — degrade silently */
  }
}

export function getCodex(): CodexEntry[] {
  return read();
}

export function hasDiscovered(name: string): boolean {
  return read().some((e) => e.name === name);
}

/** Adds commands if new; returns the names that were freshly discovered. */
export function discover(entries: CodexEntry[]): string[] {
  const current = read();
  const known = new Set(current.map((e) => e.name));
  const fresh: string[] = [];
  for (const e of entries) {
    if (!e.name || known.has(e.name)) continue;
    current.push(e);
    known.add(e.name);
    fresh.push(e.name);
  }
  if (fresh.length) write(current);
  return fresh;
}

// --- room/hub unlocks (persisted alongside the Codex) ----------------------

function readUnlocks(): string[] {
  try {
    const raw = getItem(UNLOCK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeUnlocks(keys: string[]): void {
  try {
    setItem(UNLOCK_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable (private mode / tests) — degrade silently */
  }
}

/** All earned unlock keys (the hub reads these on load to know which doors are open). */
export function getUnlocks(): string[] {
  return readUnlocks();
}

export function hasUnlock(key: string): boolean {
  return readUnlocks().includes(key);
}

/** Earn an unlock if new; returns true iff it was freshly added. */
export function addUnlock(key: string): boolean {
  if (!key) return false;
  const current = readUnlocks();
  if (current.includes(key)) return false;
  current.push(key);
  writeUnlocks(current);
  return true;
}

/** Wipe ALL saved progress — discovered commands, room unlocks, and seen-tutorial state
 *  (a fresh start re-teaches everything; see resetSeenTutorials() for a narrower reset
 *  that replays tutorials WITHOUT touching earned progress). */
export function resetCodex(): void {
  write([]);
  writeUnlocks([]);
  writeSeenTutorials([]);
}

// --- test mode (QA: view every level/portal without earning it) ------------

export function getTestMode(): boolean {
  try {
    return getItem(TEST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTestMode(on: boolean): void {
  try {
    setItem(TEST_MODE_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable (private mode / tests) — degrade silently */
  }
}

/** A read-only view whose `.has()` always answers yes — every gate that checks
 *  unlocks this way sees "everything earned" without the engine ever having to
 *  enumerate content's arbitrary unlock keys (CLAUDE.md Rule 1). */
class AllUnlockedSet extends Set<string> {
  has(): boolean {
    return true;
  }
}

/** The unlocks every gated surface (hub doors, in-track ladder, achievements) should
 *  read. Normally the player's real earned keys; under test mode, everything. */
export function getUnlocksSet(): ReadonlySet<string> {
  return getTestMode() ? new AllUnlockedSet() : new Set(readUnlocks());
}

// --- seen tutorials (persisted: a tutorial plays once, then stays quiet) ---------
//
// Each SHARED tutorial (a `pack.tutorials` entry, e.g. "tier:mixed") is tracked under
// its own id — global, so once it's been shown in ANY level that references it, it
// won't replay in another. Each ROOM's own inline `guided_tutorial` is tracked under
// `room:<puzzle id>`, since that content is unique to that one room. Both kinds are
// marked seen the moment their playback ends — whether the player watched the whole
// thing or skipped it with Escape (see systems/dialogue.ts's `play(seq, { onComplete })`;
// `end()` fires `onComplete` on both paths, so a skip counts as "seen" too).
//
// Card-game tutorials (match/combine/sentence_build, systems/tutorialOverlay.ts) use
// the SAME storage under the same "room:<puzzle id>" id scheme — one seen-tutorial
// system for both delivery mechanisms (see content/TUTORIAL_SCRIPTS.md).

function readSeenTutorials(): string[] {
  try {
    const raw = getItem(TUTORIALS_SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function writeSeenTutorials(ids: string[]): void {
  try {
    setItem(TUTORIALS_SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable (private mode / tests) — degrade silently */
  }
}

export function hasSeenTutorial(id: string): boolean {
  return readSeenTutorials().includes(id);
}

/** Marks a tutorial seen if it wasn't already (idempotent — safe to call every playback end). */
export function markTutorialSeen(id: string): void {
  if (!id) return;
  const current = readSeenTutorials();
  if (current.includes(id)) return;
  current.push(id);
  writeSeenTutorials(current);
}

/** "Replay Tutorials" (Settings): clears ONLY the seen-tutorial state, so every tutorial
 *  plays again on next entry — without touching earned progress (unlocks/Codex). */
export function resetSeenTutorials(): void {
  writeSeenTutorials([]);
}

/** Renders (or re-renders) the Codex panel into `el`. */
export function renderCodexPanel(el: HTMLElement): void {
  const entries = getCodex();
  el.innerHTML = "";
  el.className = "codex";

  const title = document.createElement("div");
  title.className = "codex-title";
  title.textContent = "📓 Codex — commands you've discovered";
  el.appendChild(title);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "codex-empty";
    empty.textContent = "Nothing yet. Solve a puzzle to learn your first command.";
    el.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "codex-list";
  for (const e of entries) {
    const li = document.createElement("li");
    li.innerHTML = `<code>${e.name}</code>${e.note ? ` — <span>${e.note}</span>` : ""}`;
    list.appendChild(li);
  }
  el.appendChild(list);
}
