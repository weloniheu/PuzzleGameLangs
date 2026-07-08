import { describe, it, expect } from "vitest";
import {
  createInvState, pickup, enterFocus, exitFocus, moveCursor, confirmDrop, removeAt,
} from "./inventoryHud";

describe("inventory reducer — pickup (FIFO) and the full-inventory drop prompt", () => {
  it("stores in FIFO order while there's room", () => {
    let s = createInvState(3);
    s = pickup(s, "print").state;
    s = pickup(s, "(").state;
    expect(s.items).toEqual(["print", "("]);
    expect(s.focused).toBe(false);
  });

  it("a FULL pickup does not store: it opens the drop prompt (focus, cursor at 0)", () => {
    let s = createInvState(2);
    s = pickup(s, "a").state;
    s = pickup(s, "b").state;
    s = { ...s, sel: 1 };
    const r = pickup(s, "c");
    expect(r.stored).toBe(false);
    expect(r.state.items).toEqual(["a", "b"]); // nothing stored yet
    expect(r.state.focused).toBe(true);
    expect(r.state.sel).toBe(0);
    expect(r.state.drop).toBe("c");
  });
});

describe("inventory reducer — the drop/cancel decision", () => {
  const full = () => {
    let s = createInvState(2);
    s = pickup(s, "a").state;
    s = pickup(s, "b").state;
    return pickup(s, "c").state; // prompt open, pending "c"
  };

  it("confirm on a FILLED slot swaps: selected drops, pending joins at the back", () => {
    const r = confirmDrop({ ...full(), sel: 0 });
    expect(r.swapped).toBe(true);
    expect(r.state.items).toEqual(["b", "c"]);
    expect(r.state.focused).toBe(false); // pickup resolved → back to room focus
    expect(r.state.drop).toBeNull();
  });

  it("confirm on an EMPTY slot discards the pending token", () => {
    let s = createInvState(3);
    s = pickup(s, "a").state;
    s = { ...s, focused: true, sel: 2, drop: "c" }; // cursor past the items
    const r = confirmDrop(s);
    expect(r.swapped).toBe(false);
    expect(r.state.items).toEqual(["a"]); // pending gone
    expect(r.state.drop).toBeNull();
  });

  it("confirm without a prompt is a no-op", () => {
    const s = createInvState(2);
    expect(confirmDrop(s)).toEqual({ state: s, swapped: false });
  });

  it("leaving focus CANCELS a pending drop (caller restores any lifted token)", () => {
    const r = exitFocus(full());
    expect(r.cancelledDrop).toBe(true);
    expect(r.state.drop).toBeNull();
    expect(r.state.focused).toBe(false);
    expect(exitFocus(createInvState(2)).cancelledDrop).toBe(false);
  });
});

describe("inventory reducer — cursor + placement", () => {
  it("the cursor is bounded by the SLOT count, not the item count", () => {
    let s = enterFocus(createInvState(3)); // empty inventory
    s = moveCursor(s, 1);
    s = moveCursor(s, 1);
    expect(s.sel).toBe(2); // may sit on an empty slot
    s = moveCursor(s, 1);
    expect(s.sel).toBe(2); // clamped at slots-1
    s = moveCursor(moveCursor(moveCursor(s, -1), -1), -1);
    expect(s.sel).toBe(0); // clamped at 0
  });

  it("entering focus clamps a stale cursor into the slot range", () => {
    const s = enterFocus({ ...createInvState(2), sel: 5 });
    expect(s.sel).toBe(1);
  });

  it("removeAt takes one item (a placement) and clamps the cursor to the new count", () => {
    let s = createInvState(4);
    s = pickup(s, "a").state;
    s = pickup(s, "b").state;
    s = { ...s, sel: 1 };
    const r = removeAt(s, 1);
    expect(r.token).toBe("b");
    expect(r.state.items).toEqual(["a"]);
    expect(r.state.sel).toBe(0);
  });

  it("removeAt out of bounds returns null and changes nothing", () => {
    const s = pickup(createInvState(2), "a").state;
    expect(removeAt(s, 1)).toEqual({ state: s, token: null });
    expect(removeAt(s, -1)).toEqual({ state: s, token: null });
  });
});
