// ---------------------------------------------------------------------------
// TASK overlay (shared engine system) — the goalSpec prompt, toggled by the
// "task" action (default key T; see keybindings.ts). Any room puzzle that
// declares `mechanics.goalSpec` gets this for free; one omitted ⇒ pressing
// the key is a no-op (see roomHost.ts) — that is how the Baba-style
// `logic_rules` rooms end up with no task prompt at all: their packs simply
// never set goalSpec (CLAUDE.md Rule 1 — the engine never branches on type).
//
// Same visual language as the guided-tutorial card (tutorialCard.ts) — a
// center-dominant, dimmed scrim — but its own scoped classes: this is not a
// tutorial step, carries no dot progress or mini-demo, and (unlike the
// tutorial) the room the player is standing in stays hidden behind the scrim
// on purpose, since the whole point is a full-attention prompt, not a demo
// of a mechanic in progress.
//
// Stateless paint/remove, like tutorialCard.ts — the room host owns WHETHER
// it's open (and freezes input via inputDispatch's taskOverlayOpen flag);
// this module only draws DOM.
// ---------------------------------------------------------------------------

export interface TaskOverlayContent {
  /** Plain-language description of what the player needs to accomplish. */
  description?: string;
  /** The desired program output (code_build only), shown as its own code-styled block. */
  output?: string;
}

const SCRIM_SELECTOR = ":scope > .task-overlay-scrim";

/** (Re)paint the overlay into `container`. Safe to call repeatedly (rebuilds its own
 *  small DOM subtree each time — same pattern as tutorialCard.ts / settingsPanel.ts). */
export function paintTaskOverlay(container: HTMLElement, content: TaskOverlayContent): void {
  let scrim = container.querySelector<HTMLDivElement>(SCRIM_SELECTOR);
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "task-overlay-scrim";
    container.appendChild(scrim);
  }
  scrim.innerHTML = "";

  const card = document.createElement("div");
  card.className = "task-overlay-card";

  const head = document.createElement("div");
  head.className = "task-overlay-head";
  head.textContent = "🎯 Your Task";
  card.appendChild(head);

  if (content.description) {
    const desc = document.createElement("p");
    desc.className = "task-overlay-desc";
    desc.textContent = content.description;
    card.appendChild(desc);
  }

  // The output is shown as its OWN block, distinct from the description — never folded
  // into one line the way the old cramped topbar chip had to (see roomHost.ts history).
  if (content.output) {
    const label = document.createElement("div");
    label.className = "task-overlay-output-label";
    label.textContent = "Expected output:";
    const out = document.createElement("pre");
    out.className = "task-overlay-output";
    out.textContent = content.output;
    card.append(label, out);
  }

  const foot = document.createElement("div");
  foot.className = "task-overlay-foot";
  // Escape is the one key that is NEVER rebindable (see keybindings.RESERVED_KEYS), so
  // it's the only binding safe to print literally — same reasoning as the guided
  // tutorial's "Esc — skip" cue. The "task" action itself IS rebindable; naming it here
  // would go stale the moment a player rebinds it, so it isn't.
  foot.textContent = "Esc — close";
  card.appendChild(foot);

  scrim.appendChild(card);
  requestAnimationFrame(() => scrim!.classList.add("shown"));
}

export function removeTaskOverlay(container: HTMLElement): void {
  container.querySelector(SCRIM_SELECTOR)?.remove();
}
