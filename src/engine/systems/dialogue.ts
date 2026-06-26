// ---------------------------------------------------------------------------
// Dialogue presenter (shared engine system). Extracted VERBATIM from roomRenderer's
// dialogue block — same auto-advance threshold/timing, same portrait anchoring, same
// first-time-once semantics, byte-identical DOM.
//
// Two surfaces: a PORTRAIT (avatar+name+text, terminal rooms only, anchored to the
// terminal) and a NARRATOR (bare transient text, any room). A beat routes by speaker.
//
// Boundaries (do NOT entangle):
//   • Terminal dock state + stage top are INJECTED getters — this module never reaches
//     into the terminal.
//   • Focus suppression: this module only signals isActive(); the ENGINE suppresses
//     gameplay. We do not touch movement/inventory input here.
//   • First-time MECHANISM (once-per-trigger) lives here; the trigger→beat lookup
//     (content, e.g. the coding `beats` map) is injected as `firstTimeBeat`.
// ---------------------------------------------------------------------------

import type { DialogueBeat, DialogueSpeaker, HintBeat } from "../../schema/types";

// --- timing/threshold constants (moved from roomRenderer, unchanged) ---
export const AUTO_LEN = 48;     // text shorter than this auto-advances when autoAdvance is unset
export const AUTO_PAUSE = 1700; // ms an auto-advancing beat lingers

// --- PURE beat-queue reducer + decisions (testable, no DOM) ----------------
/** A sequence in flight. `idx === -1` means inactive (nothing showing). */
export interface QueueState {
  beats: DialogueBeat[];
  idx: number;
}
/** Begin a sequence (idx 0), or stay inactive for an empty sequence. */
export function startQueue(beats: DialogueBeat[]): QueueState {
  return { beats, idx: beats.length ? 0 : -1 };
}
/** Step to the next beat, or go inactive (idx -1) past the end. */
export function advanceQueue(s: QueueState): QueueState {
  const idx = s.idx + 1;
  return idx < s.beats.length ? { beats: s.beats, idx } : { beats: s.beats, idx: -1 };
}
/** The beat currently showing, or null if inactive. */
export function currentBeat(s: QueueState): DialogueBeat | null {
  return s.idx >= 0 && s.idx < s.beats.length ? s.beats[s.idx] : null;
}
/** Whether a sequence is in flight (the engine reads this to suppress gameplay). */
export function queueActive(s: QueueState): boolean {
  return s.idx >= 0;
}
/** Auto-advance if explicitly set; else short text auto-advances (length fallback). */
export function isAutoAdvance(beat: DialogueBeat, autoLen: number = AUTO_LEN): boolean {
  return beat.autoAdvance === true || (beat.autoAdvance === undefined && beat.text.length < autoLen);
}
/** Narrator dwell: a readable pause that scales a little with length, then capped. */
export function narratorDwell(text: string, autoPause: number = AUTO_PAUSE): number {
  return Math.min(4000, Math.max(autoPause, text.length * 45));
}

// --- the stateful presenter (DOM) ------------------------------------------
export interface DialogueDeps {
  container: HTMLElement;                  // hosts the portrait + narrator overlays
  markerLayer: HTMLElement;                // world layer for the hint giver's marker
  speakers: Record<string, DialogueSpeaker>;
  hintGiver: { pos: { x: number; y: number }; marker?: string } | null;
  hintLines: HintBeat[];
  hasPortrait: boolean;                    // portrait surface exists only in terminal rooms
  isTerminalDocked: () => boolean;         // INJECTED — not read from the terminal here
  dockedH: () => number;                   // INJECTED
  stageTop: () => number;                  // INJECTED — stage.getBoundingClientRect().top
  hudH: number;
  hudGap: number;
  onEnd: () => void;                       // return focus to the room (engine concern)
  firstTimeBeat: (trigger: string) => DialogueBeat | null; // content lookup (e.g. snakeBeat)
}

export interface Dialogue {
  play(seq: DialogueBeat[]): void;
  advance(): void;
  end(): void;
  isActive(): boolean;
  clearTimers(): void;
  positionPortrait(): void;
  buildMarker(tile: number): void;
  onHintGiver(x: number, y: number): boolean;
  talkToHint(): void;
  fireFirstTime(trigger: string): boolean;
}

export function createDialogue(deps: DialogueDeps): Dialogue {
  // --- surfaces ---
  // PORTRAIT (terminal rooms only): avatar + name + text, slides in from the speaker's side.
  let dialogueEl: HTMLDivElement | null = null;
  let dlgPortrait: HTMLDivElement | null = null;
  let dlgName: HTMLDivElement | null = null;
  let dlgText: HTMLParagraphElement | null = null;
  let dlgCue: HTMLDivElement | null = null;
  if (deps.hasPortrait) {
    dialogueEl = document.createElement("div");
    dialogueEl.className = "room-dialogue";
    dialogueEl.hidden = true;
    dlgPortrait = document.createElement("div");
    dlgPortrait.className = "room-dialogue-portrait";
    const dlgBox = document.createElement("div");
    dlgBox.className = "room-dialogue-box";
    dlgName = document.createElement("div");
    dlgName.className = "room-dialogue-name";
    dlgText = document.createElement("p");
    dlgText.className = "room-dialogue-text";
    dlgCue = document.createElement("div");
    dlgCue.className = "room-dialogue-cue";
    dlgBox.append(dlgName, dlgText, dlgCue);
    dialogueEl.append(dlgPortrait, dlgBox);
    deps.container.appendChild(dialogueEl);
  }

  // NARRATOR: the default voice surface (text only, no avatar/name). Always available.
  const narratorEl = document.createElement("div");
  narratorEl.className = "room-narrator";
  narratorEl.hidden = true;
  deps.container.appendChild(narratorEl);

  // --- state ---
  let state: QueueState = { beats: [], idx: -1 };
  let autoTimer = 0;
  let talkTimer = 0;
  let hintIdx = -1; // hint giver progresses one line per interaction, capped at the last
  const firedFirstTimes = new Set<string>();

  function isActive(): boolean {
    return queueActive(state);
  }

  function clearTimers() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = 0; }
    if (talkTimer) { clearInterval(talkTimer); talkTimer = 0; }
  }

  function play(seq: DialogueBeat[]) {
    if (!seq.length) return;
    state = startQueue(seq);
    showBeat();
  }

  /** Route a beat to a surface: a defined character in a terminal room → PORTRAIT;
   *  everything else (speaker "narrator", or no defined character) → NARRATOR text. */
  function showBeat() {
    clearTimers();
    const beat = currentBeat(state);
    if (!beat) return;
    const sp = deps.speakers[beat.speaker];
    if (sp && dialogueEl && dlgPortrait && dlgName && dlgText && dlgCue) showPortraitBeat(beat, sp);
    else showNarratorBeat(beat);
  }

  function showPortraitBeat(beat: DialogueBeat, sp: DialogueSpeaker) {
    const el = dialogueEl!, portrait = dlgPortrait!, name = dlgName!, text = dlgText!, cue = dlgCue!;
    el.hidden = false;
    const side = sp.side === "right" ? "right" : "left";
    const frame1 = sp.portrait ?? "💬";
    const frame2 = sp.portrait2;
    el.classList.toggle("from-right", side === "right");
    el.classList.toggle("from-left", side !== "right");
    portrait.textContent = frame1;
    portrait.classList.add("talking");
    name.textContent = sp.name ?? beat.speaker;
    text.textContent = beat.text;
    highlightMarker(beat.highlight === "hint"); // outline the "?" on the relevant enter beat

    positionPortrait();
    requestAnimationFrame(() => el.classList.add("shown")); // slide in

    // Optional talking-mouth flicker between two frames (one frame is fine).
    if (frame2 && frame2 !== frame1) {
      let alt = false;
      talkTimer = window.setInterval(() => {
        alt = !alt;
        portrait.textContent = alt ? frame2 : frame1;
      }, 220);
    }

    const auto = isAutoAdvance(beat, AUTO_LEN);
    cue.textContent = auto ? "" : "Enter ▸";
    if (auto) autoTimer = window.setTimeout(advance, AUTO_PAUSE);
  }

  /** The narrator surface: transient text over the room, no avatar/name. Always
   *  auto-advances (with Enter able to skip via the engine's keydown branch). */
  function showNarratorBeat(beat: DialogueBeat) {
    narratorEl.textContent = beat.text;
    narratorEl.hidden = false;
    requestAnimationFrame(() => narratorEl.classList.add("shown"));
    autoTimer = window.setTimeout(advance, narratorDwell(beat.text, AUTO_PAUSE));
  }

  function advance() {
    clearTimers();
    state = advanceQueue(state);
    if (state.idx >= 0) showBeat();
    else end();
  }

  function end() {
    clearTimers();
    state = { beats: [], idx: -1 };
    highlightMarker(false);
    if (dialogueEl && dlgPortrait) {
      dlgPortrait.classList.remove("talking");
      dialogueEl.classList.remove("shown"); // slide out
      const el = dialogueEl;
      window.setTimeout(() => { if (state.idx === -1) el.hidden = true; }, 260);
    }
    narratorEl.classList.remove("shown");
    window.setTimeout(() => { if (state.idx === -1) narratorEl.hidden = true; }, 260);
    deps.onEnd();
  }

  /**
   * Anchor the dialogue portrait ABOVE the terminal by default; if the docked band is
   * flush near the TOP (no room above it), render INSIDE the band so it's never clipped.
   */
  function positionPortrait() {
    const el = dialogueEl;
    if (!el || el.hidden) return;
    const areaTop = deps.stageTop();
    const portH = el.offsetHeight || 140;
    if (deps.isTerminalDocked()) {
      const bandTop = window.innerHeight - deps.dockedH();
      const inside = bandTop - areaTop < portH + 16; // not enough room above → go inside the band
      el.classList.toggle("inside-terminal", inside);
      el.style.top = `${inside ? bandTop + 8 : bandTop - portH - 8}px`;
    } else {
      // Popped/none: float just above the HUD.
      el.classList.remove("inside-terminal");
      el.style.top = `${window.innerHeight - deps.hudH - deps.hudGap - portH - 8}px`;
    }
  }

  /** (Re)build the hint giver's "?" marker (the snake has none — it's portrait-only). */
  function buildMarker(tile: number) {
    deps.markerLayer.innerHTML = "";
    if (!deps.hintGiver) return;
    const el = document.createElement("div");
    el.className = "tile-room tile-hint-marker";
    el.style.width = `${tile}px`;
    el.style.height = `${tile}px`;
    el.style.transform = `translate(${deps.hintGiver.pos.x * tile}px, ${deps.hintGiver.pos.y * tile}px)`;
    const label = document.createElement("span");
    label.className = "tile-hint-label";
    label.textContent = deps.hintGiver.marker ?? "?";
    label.style.fontSize = `${Math.round(tile * 0.5)}px`;
    el.appendChild(label);
    deps.markerLayer.appendChild(el);
  }

  /** Briefly outline the hint marker (used by the "friend over there" enter beat). */
  function highlightMarker(on: boolean) {
    const el = deps.markerLayer.firstElementChild as HTMLElement | null;
    if (el) el.classList.toggle("highlight", on);
  }

  function onHintGiver(x: number, y: number): boolean {
    return !!deps.hintGiver && deps.hintGiver.pos.x === x && deps.hintGiver.pos.y === y;
  }

  /** Hint giver: shows the NEXT hint per interaction, capped at the last. Tags ignored. */
  function talkToHint() {
    if (!deps.hintLines.length) return;
    hintIdx = Math.min(hintIdx + 1, deps.hintLines.length - 1);
    const line = deps.hintLines[hintIdx];
    play([{ id: `hint-${hintIdx}`, speaker: "hint", text: line.text, trigger: "hint" }]);
  }

  /** Fire a one-shot first-time beat the FIRST time `trigger` happens this room-load, then
   *  never again. The trigger→beat lookup is injected (content); the once-MECHANISM is here.
   *  Returns true iff a beat actually played, so callers can suppress a competing beat. */
  function fireFirstTime(trigger: string): boolean {
    if (firedFirstTimes.has(trigger)) return false;
    firedFirstTimes.add(trigger); // mark on first occurrence, whether or not a beat exists
    const b = deps.firstTimeBeat(trigger);
    if (!b) return false;
    play([b]);
    return true;
  }

  return {
    play, advance, end, isActive, clearTimers,
    positionPortrait, buildMarker, onHintGiver, talkToHint, fireFirstTime,
  };
}
