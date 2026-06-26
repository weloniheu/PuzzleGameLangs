import { describe, it, expect } from "vitest";
import {
  defaultBindings,
  actionsFor,
  normalizeKey,
  bindingGlyph,
  bindingsGlyph,
  findConflict,
  isReserved,
  rebind,
  resolve,
  type Bindings,
} from "./keybindings";

describe("normalizeKey", () => {
  it("lowercases single chars and names Space", () => {
    expect(normalizeKey("W")).toBe("w");
    expect(normalizeKey("`")).toBe("`");
    expect(normalizeKey(" ")).toBe("Space");
    expect(normalizeKey("ArrowUp")).toBe("ArrowUp");
    expect(normalizeKey("Enter")).toBe("Enter");
  });
});

describe("glyphs", () => {
  it("renders single keys and sequences readably", () => {
    expect(bindingGlyph(["ArrowUp"])).toBe("↑");
    expect(bindingGlyph(["w"])).toBe("W");
    expect(bindingGlyph(["h"])).toBe("H");
    expect(bindingGlyph(["d", "d"])).toBe("dd");
    expect(bindingGlyph(["d", "w"])).toBe("dw");
    expect(bindingsGlyph([["ArrowUp"], ["w"]])).toBe("↑ / W");
  });
});

describe("defaults", () => {
  it("standard runs arrows AND wasd for movement; vim uses hjkl + dd/dw", () => {
    const std = defaultBindings("standard");
    expect(std.up).toEqual([["ArrowUp"], ["w"]]);
    expect(std.left).toEqual([["ArrowLeft"], ["a"]]);
    expect(actionsFor("standard").some((a) => a.id === "clearLine")).toBe(false);

    const vim = defaultBindings("vim");
    expect(vim.left).toEqual([["h"]]);
    expect(vim.clearLine).toEqual([["d", "d"]]); // dd sequence
    // vim exposes the editing actions (their exact keys are user-editable, so not asserted here)
    expect(actionsFor("vim").some((a) => a.id === "clearLine")).toBe(true);
    expect(actionsFor("vim").some((a) => a.id === "deleteToken")).toBe(true);
  });
});

describe("findConflict", () => {
  // Fixed fixture mirroring the vim scheme: pickup = dw, clearLine = dd, delete = x.
  const FIX: Bindings = {
    left: [["h"]], place: [["p"]],
    pickup: [["d", "w"]],     // dw
    clearLine: [["d", "d"]],  // dd
    deleteToken: [["x"]],     // x
  };

  it("flags an exact duplicate of another action", () => {
    expect(findConflict(FIX, "deleteToken", ["p"])?.action).toBe("place");
  });

  it("lets dd and dw coexist; a sequence diverging from both is free", () => {
    expect(findConflict(FIX, "newAction", ["d", "w"])?.action).toBe("pickup");    // exact dw
    expect(findConflict(FIX, "newAction", ["d", "d"])?.action).toBe("clearLine"); // exact dd
    expect(findConflict(FIX, "newAction", ["d", "z"])).toBeNull();               // diverges from both
  });

  it("blocks a single 'd' because it is a prefix of dd/dw", () => {
    const c = findConflict(FIX, "place", ["d"]);
    expect(c).not.toBeNull();
    expect(["clearLine", "pickup"]).toContain(c!.action);
  });

  it("blocks a longer sequence that has an existing binding as its prefix", () => {
    // 'h' is left; binding ["h","x"] would shadow / be shadowed by left
    expect(findConflict(FIX, "clearLine", ["h", "x"])?.action).toBe("left");
  });

  it("ignores the action's own bindings", () => {
    expect(findConflict(FIX, "left", ["h"])).toBeNull();
  });
});

describe("reserved keys", () => {
  it("treats Escape as reserved", () => {
    expect(isReserved(["Escape"])).toBe(true);
    expect(isReserved(["w"])).toBe(false);
  });
});

describe("rebind", () => {
  it("applies a valid rebind to the chosen slot without mutating the input", () => {
    const std = defaultBindings("standard");
    const res = rebind(std, "pickup", 0, ["e"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bindings.pickup).toEqual([["e"]]);
      expect(std.pickup).toEqual([["i"]]); // original untouched
    }
  });

  it("rebinds one movement slot, leaving the other live (dual standard movement)", () => {
    const std = defaultBindings("standard");
    const res = rebind(std, "up", 1, ["z"]); // replace the wasd slot
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bindings.up).toEqual([["ArrowUp"], ["z"]]);
  });

  it("blocks an exact-duplicate rebind and names the colliding action", () => {
    const std = defaultBindings("standard");
    const res = rebind(std, "pickup", 0, ["p"]); // 'p' is place
    expect(res).toEqual({ ok: false, reason: "conflict", conflictAction: "place" });
  });

  it("blocks a prefix-conflict rebind (single 'd' over vim dd/dw)", () => {
    const vim = defaultBindings("vim");
    const res = rebind(vim, "pickup", 0, ["d"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("conflict");
  });

  it("blocks rebinding to Esc (reserved)", () => {
    const std = defaultBindings("standard");
    expect(rebind(std, "pickup", 0, ["Escape"])).toEqual({ ok: false, reason: "reserved" });
  });

  it("rejects an empty binding", () => {
    const std = defaultBindings("standard");
    expect(rebind(std, "pickup", 0, [])).toEqual({ ok: false, reason: "empty" });
  });
});

describe("resolve", () => {
  it("fires a single-key action immediately (standard)", () => {
    const std = defaultBindings("standard");
    expect(resolve(std, ["w"])).toEqual({ kind: "fire", action: "up" });
    expect(resolve(std, ["ArrowLeft"])).toEqual({ kind: "fire", action: "left" });
    expect(resolve(std, ["p"])).toEqual({ kind: "fire", action: "place" });
  });

  // Fixed fixture mirroring the vim scheme: dd → clearLine, dw → pickup, x → delete.
  const SEQ: Bindings = {
    left: [["h"]], deleteToken: [["x"]],
    clearLine: [["d", "d"]], pickup: [["d", "w"]],
  };

  it("treats a sequence prefix as pending, then fires on completion", () => {
    expect(resolve(SEQ, ["d"])).toEqual({ kind: "pending" });              // prefix of dd and dw
    expect(resolve(SEQ, ["d", "d"])).toEqual({ kind: "fire", action: "clearLine" });
    expect(resolve(SEQ, ["d", "w"])).toEqual({ kind: "fire", action: "pickup" });
  });

  it("fires a single-key binding without pending", () => {
    expect(resolve(SEQ, ["h"])).toEqual({ kind: "fire", action: "left" });
    expect(resolve(SEQ, ["x"])).toEqual({ kind: "fire", action: "deleteToken" });
  });

  it("returns none for an unbound key or a broken sequence", () => {
    expect(resolve(SEQ, ["z"])).toEqual({ kind: "none" });
    expect(resolve(SEQ, ["d", "z"])).toEqual({ kind: "none" }); // diverges from dd and dw
  });
});
