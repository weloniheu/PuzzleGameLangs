// ---------------------------------------------------------------------------
// The Codex — the player's growing list of DISCOVERED commands/functions.
//
// When a player first uses a token that carries a `discovers` tag (e.g. `print`),
// it gets recorded here and persists across puzzles via localStorage. Later
// puzzles can show "you already know: print, return …" so the learner builds a
// vocabulary instead of re-deriving everything each level.
//
// This is intentionally tiny and language-agnostic in spirit; only the code_build
// renderer writes to it today, but the panel can be reused by any puzzle type.
// ---------------------------------------------------------------------------

const KEY = "codex.discovered.v1";

export interface CodexEntry {
  /** the command name, e.g. "print" */
  name: string;
  /** a short note shown next to it, e.g. "shows text to the world" */
  note?: string;
}

function read(): CodexEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CodexEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: CodexEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
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

/** Wipe the Codex — handy for testing a fresh playthrough. */
export function resetCodex(): void {
  write([]);
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
