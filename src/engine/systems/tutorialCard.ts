// ---------------------------------------------------------------------------
// Guided-tutorial POPUP CARD (shared engine system, replaces the old text-only
// narrator/bar presentation for `trigger: "guided_tutorial"` beats — see
// systems/dialogue.ts for room-world puzzles and systems/tutorialOverlay.ts for
// the card games). Center-dominant, dimmed scrim, a short looping mini-demo of
// the actual mechanic being taught, dot progress, an Enter-gated pill.
//
// The demo variant is keyed by `TutorialWaitFor` — the same CLOSED, engine-owned
// set the waitFor mechanism already uses (see schema/types.ts). A step with no
// `waitFor` is informational: no demo, text only, Enter-gated.
//
// Keyboard-only (Rule 4): the "Skip"/"Next" pill is a VISUAL label, not a click
// target — advancing is still driven by the room's existing Enter/notify() wiring
// in dialogue.ts / tutorialOverlay.ts. This module only paints DOM; it owns no
// state and swallows no input.
// ---------------------------------------------------------------------------

import type { DialogueBeat, PuzzleType, TutorialDemo } from "../../schema/types";
import { assetUrl } from "../core/assetUrl";

export interface TutorialModuleMeta {
  label: string;
  icon?: string; // portal art already shipped for the hub doors (public/assets/*portal.png)
}

// Dispatches on puzzle_type — CLOSED set (Rule 1). The one id-based exception is the
// literal hub room (id "hub", the same sentinel main.ts uses to enter it): it borrows
// code_build's room shell but isn't that module's puzzle, so it gets its own badge.
const MODULE_META: Partial<Record<PuzzleType, TutorialModuleMeta>> = {
  code_build: { label: "Coding", icon: "/assets/codeportal.png" },
  logic_rules: { label: "Logic", icon: "/assets/logicportal.png" },
  grammar_build: { label: "Grammar", icon: "/assets/grammarprotal.png" },
  vocab_match: { label: "Language", icon: "/assets/languageportal.png" },
  match: { label: "Language", icon: "/assets/languageportal.png" },
  sentence_build: { label: "Grammar", icon: "/assets/grammarprotal.png" },
  combine: { label: "Logic", icon: "/assets/logicportal.png" },
};

export function tutorialModuleMeta(puzzleType: PuzzleType, puzzleId: string): TutorialModuleMeta {
  if (puzzleId === "hub") return { label: "Hub" };
  return MODULE_META[puzzleType] ?? { label: "Tutorial" };
}

export interface TutorialCardOptions {
  beat: DialogueBeat;
  idx: number;   // position of `beat` within the tutorial run (0-based)
  total: number; // length of that run
  module: TutorialModuleMeta;
}

const SCRIM_SELECTOR = ":scope > .tutorial-card-scrim";

/** (Re)paint the popup into `container`. Safe to call on every beat change — rebuilds
 *  its own small DOM subtree each time (same pattern as the settings panel's render()). */
export function paintTutorialCard(container: HTMLElement, opts: TutorialCardOptions): void {
  let scrim = container.querySelector<HTMLDivElement>(SCRIM_SELECTOR);
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "tutorial-card-scrim";
    container.appendChild(scrim);
  }
  scrim.innerHTML = "";

  const { beat, idx, total, module } = opts;

  // A waitFor step needs the room ITSELF visible — the player has to see the slime/board
  // to actually perform the move/push/pickup/etc. the step is waiting on ("gameplay stays
  // LIVE meanwhile"). Only an informational step (gameplay already paused) gets the full
  // center-dominant, dimmed treatment; a waitFor step docks at the bottom, undimmed —
  // the same position the old text bar used, so it never covers the mechanic being taught.
  scrim.classList.toggle("tutorial-card-scrim--live", !!beat.waitFor);

  const card = document.createElement("div");
  card.className = "tutorial-card";

  const head = document.createElement("div");
  head.className = "tutorial-card-head";
  const badge = document.createElement("div");
  badge.className = "tutorial-card-badge";
  if (module.icon) {
    const img = document.createElement("img");
    img.src = assetUrl(module.icon);
    img.alt = "";
    badge.appendChild(img);
  } else {
    badge.textContent = "✦"; // hub / fallback glyph
  }
  const label = document.createElement("div");
  label.className = "tutorial-card-module";
  label.textContent = module.label;
  head.append(badge, label);
  card.appendChild(head);

  // An interactive step draws the action it waits on; an informational step draws whatever
  // picture it asked for (that is how a new CONCEPT gets SHOWN, not just described). A step
  // that asks for neither stays text-only.
  const demoKind = beat.demo ?? beat.waitFor;
  if (demoKind) {
    const demo = document.createElement("div");
    demo.className = "tutorial-card-demo";
    demo.appendChild(buildDemo(demoKind));
    card.appendChild(demo);
  }

  const caption = document.createElement("p");
  caption.className = "tutorial-card-caption";
  caption.textContent = beat.text;
  card.appendChild(caption);

  const foot = document.createElement("div");
  foot.className = "tutorial-card-foot";
  const dots = document.createElement("div");
  dots.className = "tutorial-card-dots";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("span");
    dot.className = `tutorial-card-dot${i === idx ? " active" : ""}`;
    dots.appendChild(dot);
  }
  foot.appendChild(dots);
  // The skip cue is always present, on every step. Tutorials replay on every entry now, so
  // the way out has to be as discoverable as the way forward — a player who already knows
  // the mechanic must not have to guess that Escape works.
  const skip = document.createElement("div");
  skip.className = "tutorial-card-skip";
  skip.textContent = "Esc — skip";
  foot.appendChild(skip);
  if (!beat.waitFor) {
    const pill = document.createElement("div");
    pill.className = "tutorial-card-pill";
    pill.textContent = idx >= total - 1 ? "Got it — Enter ▸" : "Next — Enter ▸";
    foot.appendChild(pill);
  }
  card.appendChild(foot);

  scrim.appendChild(card);
  requestAnimationFrame(() => scrim!.classList.add("shown"));
}

export function removeTutorialCard(container: HTMLElement): void {
  container.querySelector(SCRIM_SELECTOR)?.remove();
}

// --- per-mechanic mini demo (closed TutorialWaitFor set; transform/opacity only) -----

function chip(text: string, cls = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `tdemo-chip ${cls}`.trim();
  el.textContent = text;
  return el;
}

/** A code-ish line of the given width, optionally stepped `indent` tiles to the right. */
function codeRow(width: number, indent = 0, cls = ""): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `tdemo-row ${cls}`.trim();
  row.style.marginLeft = `${indent * 14}px`;
  for (let i = 0; i < width; i++) {
    const seg = document.createElement("span");
    seg.className = "tdemo-seg";
    row.appendChild(seg);
  }
  return row;
}

function buildDemo(kind: TutorialDemo): HTMLElement {
  const el = document.createElement("div");
  el.className = `tdemo tdemo-${kind}`;

  switch (kind) {
    case "move": {
      const pad = document.createElement("div");
      pad.className = "tdemo-movepad";
      for (const dir of ["up", "right", "down", "left"]) {
        const arrow = document.createElement("div");
        arrow.className = `tdemo-arrow tdemo-arrow-${dir}`;
        arrow.textContent = { up: "↑", right: "→", down: "↓", left: "←" }[dir]!;
        pad.appendChild(arrow);
      }
      el.appendChild(pad);
      break;
    }
    case "enter_door": {
      const door = document.createElement("div");
      door.className = "tdemo-door";
      const slime = document.createElement("div");
      slime.className = "tdemo-dot tdemo-door-slime";
      el.append(slime, door);
      break;
    }
    case "pickup": {
      const slot = document.createElement("div");
      slot.className = "tdemo-slot";
      const tile = chip("", "tdemo-pickup-chip");
      el.append(tile, slot);
      break;
    }
    case "place": {
      const slot = document.createElement("div");
      slot.className = "tdemo-slot";
      const tile = chip("", "tdemo-place-chip");
      el.append(slot, tile);
      break;
    }
    case "drop": {
      // A token leaves the slot and lands out in front, bobbing on the floor — the
      // opposite arc of "place", which snaps INTO a slot.
      const slot = document.createElement("div");
      slot.className = "tdemo-slot";
      const item = chip("", "tdemo-drop-chip");
      el.append(slot, item);
      break;
    }
    case "build": {
      const btn = document.createElement("div");
      btn.className = "tdemo-button tdemo-button-build";
      btn.textContent = "Build";
      const check = document.createElement("div");
      check.className = "tdemo-check";
      check.textContent = "✓";
      el.append(btn, check);
      break;
    }
    case "run": {
      const term = document.createElement("div");
      term.className = "tdemo-terminal";
      const line = document.createElement("span");
      line.className = "tdemo-terminal-line";
      line.textContent = ">>>";
      const cursor = document.createElement("span");
      cursor.className = "tdemo-terminal-cursor";
      cursor.textContent = "█";
      term.append(line, cursor);
      el.appendChild(term);
      break;
    }
    case "combine": {
      const bowl = document.createElement("div");
      bowl.className = "tdemo-bowl";
      const a = chip("", "tdemo-combine-chip tdemo-combine-a");
      const b = chip("", "tdemo-combine-chip tdemo-combine-b");
      el.append(a, bowl, b);
      break;
    }
    case "push": {
      const slot = document.createElement("div");
      slot.className = "tdemo-slot";
      const tile = chip("", "tdemo-push-chip");
      el.append(tile, slot);
      break;
    }
    // --- CONCEPT demos: informational steps that introduce a new IDEA (see TutorialDemo).
    // Each one draws the shape of the idea so the caption can stay short.
    case "prefilled": {
      // A row of slots where some tiles are already down (faded) and the rest are empty.
      const row = document.createElement("div");
      row.className = "tdemo-slotrow";
      for (const filled of [false, true, false, false, true]) {
        const s = document.createElement("div");
        s.className = filled ? "tdemo-slot tdemo-slot-filled" : "tdemo-slot";
        row.appendChild(s);
      }
      el.appendChild(row);
      break;
    }
    case "loop": {
      // One line, running again and again — a counter ticks 1▸2▸3 beside it.
      const stack = document.createElement("div");
      stack.className = "tdemo-stack";
      stack.appendChild(codeRow(4, 0, "tdemo-row-loop"));
      const count = document.createElement("div");
      count.className = "tdemo-loopcount";
      for (const n of ["1", "2", "3"]) {
        const tick = document.createElement("span");
        tick.className = "tdemo-loopcount-tick";
        tick.textContent = n;
        count.appendChild(tick);
      }
      stack.appendChild(count);
      el.appendChild(stack);
      break;
    }
    case "indent": {
      // The whole point: the body line sits one tile RIGHT of the header, and a bracket
      // sweeps in to show that the offset is what puts it "inside".
      const stack = document.createElement("div");
      stack.className = "tdemo-stack";
      stack.appendChild(codeRow(4, 0, "tdemo-row-head"));
      const body = document.createElement("div");
      body.className = "tdemo-indentbody";
      const arrow = document.createElement("span");
      arrow.className = "tdemo-indentarrow";
      arrow.textContent = "→";
      body.append(arrow, codeRow(3, 1, "tdemo-row-body"));
      stack.appendChild(body);
      el.appendChild(stack);
      break;
    }
    case "function": {
      // A named block (header + indented body) sitting apart from the line that calls it.
      const stack = document.createElement("div");
      stack.className = "tdemo-stack";
      const block = document.createElement("div");
      block.className = "tdemo-funcblock";
      block.append(codeRow(4, 0, "tdemo-row-head"), codeRow(3, 1, "tdemo-row-body"));
      stack.append(block, codeRow(2, 0, "tdemo-row-call"));
      el.appendChild(stack);
      break;
    }
    case "argument": {
      // A value travels into the named slot in the header.
      const stack = document.createElement("div");
      stack.className = "tdemo-stack";
      const head = document.createElement("div");
      head.className = "tdemo-arghead";
      head.append(codeRow(2, 0, "tdemo-row-head"));
      const slot = document.createElement("div");
      slot.className = "tdemo-slot tdemo-argslot";
      head.appendChild(slot);
      const val = chip("", "tdemo-argvalue");
      stack.append(head, val);
      el.appendChild(stack);
      break;
    }
    case "shuffle": {
      // Three tiles trade places — the layout is re-dealt, the puzzle is not.
      const row = document.createElement("div");
      row.className = "tdemo-shufflerow";
      for (const n of ["a", "b", "c"]) row.appendChild(chip("", `tdemo-shuffle-${n}`));
      el.appendChild(row);
      break;
    }
    case "lowlight": {
      // The room goes dark except a circle that travels with the player.
      const scene = document.createElement("div");
      scene.className = "tdemo-dark";
      const glow = document.createElement("div");
      glow.className = "tdemo-darkglow";
      const dot = document.createElement("div");
      dot.className = "tdemo-dot tdemo-darkslime";
      glow.appendChild(dot);
      scene.appendChild(glow);
      el.appendChild(scene);
      break;
    }
    case "interact":
    default: {
      const key = document.createElement("div");
      key.className = "tdemo-key";
      key.textContent = "⏎";
      el.appendChild(key);
      break;
    }
  }
  return el;
}
