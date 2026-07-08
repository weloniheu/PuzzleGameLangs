// ---------------------------------------------------------------------------
// Input dispatch (shared engine system). ONE focus-aware keydown pipeline,
// extracted from roomRenderer.onKeydown. The DECISION is a pure function
// (testable precedence: dialogue > destination menu > esc > bindings); the
// stateful wrapper owns only the pending-sequence buffer + its expiry timer.
//
// Esc + dialogue keys are fixed; everything else resolves the pressed
// key/sequence against the ACTIVE scheme's bindings (no hardcoded keys).
// ---------------------------------------------------------------------------

import { normalizeKey, resolve, type Bindings, type Key } from "../core/keybindings";

export const SEQ_WINDOW = 600; // ms a pending gameplay sequence (e.g. d…) waits for its next key

export interface DispatchContext {
  /** An ordinary dialogue beat is showing → gameplay input is suppressed. */
  dialogueBlocks: boolean;
  /** Escape may cut the current dialogue sequence short. */
  dialogueCanSkip: boolean;
  destMenuOpen: boolean;
}

export type Decision =
  | { kind: "dialogue-advance" }
  | { kind: "dialogue-skip" }
  | { kind: "swallow" }               // consume the key, do nothing
  | { kind: "dest-escape" }
  | { kind: "dest-select" }
  | { kind: "dest-move"; delta: -1 | 1 }
  | { kind: "escape" }
  | { kind: "fire"; action: string }
  | { kind: "pending"; pending: Key[] }
  | { kind: "pass" };                 // unbound key — let it pass through

/**
 * Decide what one keydown does, given the current focus context and the pending
 * sequence buffer. Mirrors the original handler exactly:
 *   • dialogue showing → advance on Enter/Space, skip on Esc (if skippable), swallow the rest
 *   • destination menu open → arrows/wksj move, Enter/Space selects, Esc escapes, swallow the rest
 *   • Escape → the esc ladder
 *   • otherwise resolve buffer+key against bindings; a broken sequence RESTARTS from this key
 */
export function decide(ctx: DispatchContext, rawKey: string, pending: Key[], bindings: Bindings): Decision {
  if (ctx.dialogueBlocks) {
    if (rawKey === "Enter" || rawKey === " " || rawKey === "Spacebar") return { kind: "dialogue-advance" };
    if (rawKey === "Escape" && ctx.dialogueCanSkip) return { kind: "dialogue-skip" };
    return { kind: "swallow" };
  }
  if (ctx.destMenuOpen) {
    if (rawKey === "Escape") return { kind: "dest-escape" };
    if (rawKey === "Enter" || rawKey === " " || rawKey === "Spacebar") return { kind: "dest-select" };
    if (rawKey === "ArrowUp" || rawKey === "ArrowLeft" || rawKey === "w" || rawKey === "k") return { kind: "dest-move", delta: -1 };
    if (rawKey === "ArrowDown" || rawKey === "ArrowRight" || rawKey === "s" || rawKey === "j") return { kind: "dest-move", delta: 1 };
    return { kind: "swallow" };
  }
  if (rawKey === "Escape") return { kind: "escape" }; // reserved: esc ladder

  const key = normalizeKey(rawKey);
  let buf = [...pending, key];
  let r = resolve(bindings, buf);
  if (r.kind === "none" && buf.length > 1) {
    buf = [key]; // a sequence broke — restart from this key
    r = resolve(bindings, buf);
  }
  if (r.kind === "fire") return { kind: "fire", action: r.action };
  if (r.kind === "pending") return { kind: "pending", pending: buf };
  return { kind: "pass" };
}

// --- the stateful wrapper (pending buffer + timer) --------------------------

export interface InputDispatchDeps {
  bindings(): Bindings;
  context(): DispatchContext;
  seqWindowMs?: number;
  onDialogueAdvance(): void;
  onDialogueSkip(): void;
  onDestEscape(): void;
  onDestSelect(): void;
  onDestMove(delta: -1 | 1): void;
  onEscape(): void;
  onAction(action: string): void;
}

export interface InputDispatch {
  onKeydown(e: KeyboardEvent): void;
  /** Drop the pending sequence buffer + its timer (also the teardown hook). */
  clearPending(): void;
}

export function createInputDispatch(deps: InputDispatchDeps): InputDispatch {
  const seqWindowMs = deps.seqWindowMs ?? SEQ_WINDOW;
  let pendingKeys: Key[] = []; // buffered keys of an in-progress sequence (e.g. d…)
  let seqTimer = 0;

  function clearPending() {
    pendingKeys = [];
    if (seqTimer) { clearTimeout(seqTimer); seqTimer = 0; }
  }
  function armPendingTimer() {
    if (seqTimer) clearTimeout(seqTimer);
    seqTimer = window.setTimeout(() => { pendingKeys = []; seqTimer = 0; }, seqWindowMs);
  }

  function onKeydown(e: KeyboardEvent) {
    const d = decide(deps.context(), e.key, pendingKeys, deps.bindings());
    switch (d.kind) {
      case "dialogue-advance": e.preventDefault(); deps.onDialogueAdvance(); return;
      case "dialogue-skip": e.preventDefault(); deps.onDialogueSkip(); return;
      case "swallow": e.preventDefault(); return;
      case "dest-escape": e.preventDefault(); deps.onDestEscape(); return;
      case "dest-select": e.preventDefault(); deps.onDestSelect(); return;
      case "dest-move": e.preventDefault(); deps.onDestMove(d.delta); return;
      case "escape": e.preventDefault(); deps.onEscape(); return;
      case "fire":
        e.preventDefault();
        clearPending();
        deps.onAction(d.action);
        return;
      case "pending":
        e.preventDefault();
        pendingKeys = d.pending;
        armPendingTimer(); // wait for the next key in the sequence
        return;
      case "pass":
        clearPending(); // unbound key — let it pass through
        return;
    }
  }

  return { onKeydown, clearPending };
}
