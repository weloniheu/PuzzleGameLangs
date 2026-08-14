// ---------------------------------------------------------------------------
// Inventory + HUD (shared engine system). Extracted from roomRenderer's inventory
// block — same FIFO order, same full-inventory drop/cancel flow, same DOM.
//
// PURE state transitions (a reducer, testable without a DOM) + a thin DOM system.
// The HUD strip is ALWAYS visible: room focus → slightly dimmed; inventory focus
// → brightened, arrows move the slot cursor (`sel`). A full-inventory pickup does
// NOT silently fail: it shifts to inventory focus with a drop/cancel prompt
// reusing the same cursor. The pending pickup may carry an onCancel callback —
// e.g. a placed token lifted off a board is restored by its puzzle module.
//
// Placement INTO a puzzle area is NOT here (that's the module's job); the HUD
// exposes reads + removeAt/pickupToken for modules.
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// --- PURE inventory reducer -------------------------------------------------

export interface InvState {
  items: string[];
  slots: number;
  focused: boolean;
  sel: number;
  /** A full-inventory pickup awaiting a drop/cancel decision (the pending token). */
  drop: string | null;
}

export function createInvState(slots: number): InvState {
  return { items: [], slots, focused: false, sel: 0, drop: null };
}

/** Take one copy of `token`: stored when there's room; otherwise shift to the
 *  drop/cancel prompt (inventory focus, cursor at slot 0), storing nothing yet. */
export function pickup(s: InvState, token: string): { state: InvState; stored: boolean } {
  if (s.items.length >= s.slots) {
    return { state: { ...s, focused: true, sel: 0, drop: token }, stored: false };
  }
  return { state: { ...s, items: [...s.items, token] }, stored: true };
}

/** Enter inventory focus (cursor clamped to the slot range). */
export function enterFocus(s: InvState): InvState {
  return { ...s, focused: true, sel: clamp(s.sel, 0, s.slots - 1) };
}

/** Leave inventory focus → room focus. A pending drop is CANCELLED — the caller
 *  restores any lifted token via the onCancel it registered. */
export function exitFocus(s: InvState): { state: InvState; cancelledDrop: boolean } {
  return { state: { ...s, focused: false, drop: null }, cancelledDrop: s.drop !== null };
}

/** Move the slot cursor. Bounded by the SLOT count (not the item count). */
export function moveCursor(s: InvState, delta: -1 | 1): InvState {
  const sel = delta < 0 ? Math.max(0, s.sel - 1) : Math.min(s.slots - 1, s.sel + 1);
  return { ...s, sel };
}

/** Select a slot outright (the hotbar's 1-9 keys). Out of range ⇒ unchanged, so a room
 *  with 5 slots simply ignores a 7. Deliberately does NOT enter inventory focus: the
 *  selection is the "held" slot, exactly like a Minecraft hotbar, and stealing focus
 *  would hand the arrow keys to the cursor when the player still wants to walk. */
export function selectSlot(s: InvState, index: number): InvState {
  if (index < 0 || index >= s.slots) return s;
  return { ...s, sel: index };
}

/** Resolve the drop prompt: a FILLED selected slot is dropped and the pending token
 *  takes its place at the back (FIFO); an EMPTY selected slot discards the pending
 *  token. Either way the prompt resolves and focus returns to the room. */
export function confirmDrop(s: InvState): { state: InvState; swapped: boolean } {
  if (s.drop === null) return { state: s, swapped: false };
  const items = [...s.items];
  let swapped = false;
  if (s.sel < items.length) {
    items.splice(s.sel, 1);
    items.push(s.drop);
    swapped = true;
  }
  return { state: { ...s, items, focused: false, drop: null }, swapped };
}

/** Remove the item at `index` (a placement), clamping the cursor to the new count. */
export function removeAt(s: InvState, index: number): { state: InvState; token: string | null } {
  if (index < 0 || index >= s.items.length) return { state: s, token: null };
  const items = [...s.items];
  const [token] = items.splice(index, 1);
  return { state: { ...s, items, sel: clamp(s.sel, 0, Math.max(0, items.length - 1)) }, token };
}

// --- the DOM system ----------------------------------------------------------

export interface InventoryHud {
  el: HTMLElement;
  count(): number;
  itemAt(index: number): string | undefined;
  isFull(): boolean;
  focused(): boolean;
  selected(): number;
  hasPendingDrop(): boolean;
  /** Take one copy of `token`. Returns true when stored; false when the inventory
   *  was full and the drop/cancel prompt opened instead. `onCancel` fires if that
   *  prompt is cancelled — use it to restore a lifted token. */
  pickupToken(token: string, onCancel: (() => void) | null): boolean;
  /** Remove the item at `index` (a placement). Returns the token, or null. */
  removeAt(index: number): string | null;
  enterFocus(): void;
  exitFocus(): void;
  moveCursor(delta: -1 | 1): void;
  /** Select a slot outright (hotbar 1-9). Out of range ⇒ no-op; never enters focus. */
  selectSlot(index: number): void;
  confirmDrop(): void;
  draw(): void;
  /** Anchor the strip (set by the host's camera pass). */
  setTop(px: number): void;
}

export function createInventoryHud(container: HTMLElement, slots: number): InventoryHud {
  // --- persistent inventory strip (progress is visible without any overlay) ---
  const strip = document.createElement("div");
  strip.className = "room-inventory";
  container.appendChild(strip);

  let state = createInvState(slots);
  let onCancelDrop: (() => void) | null = null;

  /** Always-visible HUD (Minecraft hotbar feel): N slots, FIFO order, a highlighted
   *  selected slot while in inventory focus, slightly dimmed while in room focus. */
  function draw() {
    strip.classList.toggle("focused", state.focused); // brightening = the real focus signal
    strip.innerHTML = "";
    for (let s = 0; s < state.slots; s++) {
      const slot = document.createElement("span");
      const filled = s < state.items.length;
      // The selected slot is the HELD one — what place/drop act on — so it stays marked
      // even out of inventory focus (focus brightens the whole strip on top of this).
      const selected = s === state.sel;
      slot.className = `room-inventory-slot${filled ? "" : " empty"}${selected ? " selected" : ""}`;
      slot.textContent = filled ? state.items[s] : "";
      const num = document.createElement("span"); // fixed slot number (1a hotbar)
      num.className = "room-inventory-num";
      num.textContent = String(s + 1);
      slot.appendChild(num);
      strip.appendChild(slot);
    }
  }

  return {
    el: strip,
    count: () => state.items.length,
    itemAt: (i) => state.items[i],
    isFull: () => state.items.length >= state.slots,
    focused: () => state.focused,
    selected: () => state.sel,
    hasPendingDrop: () => state.drop !== null,
    pickupToken(token, onCancel) {
      const r = pickup(state, token);
      state = r.state;
      if (!r.stored) onCancelDrop = onCancel;
      draw();
      return r.stored;
    },
    removeAt(index) {
      const r = removeAt(state, index);
      state = r.state;
      if (r.token !== null) draw();
      return r.token;
    },
    enterFocus() {
      state = enterFocus(state);
      draw();
    },
    exitFocus() {
      const r = exitFocus(state);
      state = r.state;
      if (r.cancelledDrop) onCancelDrop?.(); // un-lift: restore the token to its board
      onCancelDrop = null;
      draw();
    },
    moveCursor(delta) {
      state = moveCursor(state, delta);
      draw();
    },
    selectSlot(index) {
      state = selectSlot(state, index);
      draw();
    },
    confirmDrop() {
      if (state.drop === null) return;
      state = confirmDrop(state).state; // pickup resolved → back to room focus
      onCancelDrop = null;
      draw();
    },
    draw,
    setTop(px) {
      strip.style.top = `${px}px`;
    },
  };
}
