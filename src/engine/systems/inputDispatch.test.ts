import { describe, it, expect } from "vitest";
import { decide, type DispatchContext } from "./inputDispatch";
import { defaultBindings, rebind } from "../core/keybindings";

const roomCtx: DispatchContext = {
  dialogueBlocks: false, dialogueCanSkip: true, destMenuOpen: false, taskOverlayOpen: false,
};
const dlgCtx: DispatchContext = { ...roomCtx, dialogueBlocks: true };
const destCtx: DispatchContext = { ...roomCtx, destMenuOpen: true };
const taskCtx: DispatchContext = { ...roomCtx, taskOverlayOpen: true };
const standard = defaultBindings("standard");
const vim = defaultBindings("vim");

describe("decide — dialogue focus state (highest precedence)", () => {
  it("Enter / Space / Spacebar advance the beat", () => {
    expect(decide(dlgCtx, "Enter", [], standard)).toEqual({ kind: "dialogue-advance" });
    expect(decide(dlgCtx, " ", [], standard)).toEqual({ kind: "dialogue-advance" });
    expect(decide(dlgCtx, "Spacebar", [], standard)).toEqual({ kind: "dialogue-advance" });
  });

  it("Escape skips a skippable sequence, is swallowed otherwise", () => {
    expect(decide(dlgCtx, "Escape", [], standard)).toEqual({ kind: "dialogue-skip" });
    expect(decide({ ...dlgCtx, dialogueCanSkip: false }, "Escape", [], standard)).toEqual({ kind: "swallow" });
  });

  it("suppresses ALL gameplay keys (movement doesn't leak through)", () => {
    expect(decide(dlgCtx, "ArrowUp", [], standard)).toEqual({ kind: "swallow" });
    expect(decide(dlgCtx, "i", [], standard)).toEqual({ kind: "swallow" });
  });

  it("outranks the destination menu", () => {
    expect(decide({ ...dlgCtx, destMenuOpen: true }, "Enter", [], standard)).toEqual({ kind: "dialogue-advance" });
  });
});

describe("decide — task overlay open (board frozen)", () => {
  it("Escape closes it", () => {
    expect(decide(taskCtx, "Escape", [], standard)).toEqual({ kind: "task-close" });
  });

  it("the bound 'task' key (t, by default) closes it too — same key that opened it", () => {
    expect(decide(taskCtx, "t", [], standard)).toEqual({ kind: "task-close" });
    expect(decide(taskCtx, "t", [], vim)).toEqual({ kind: "task-close" });
  });

  it("a rebound 'task' key closes it under its new binding, not the old default", () => {
    const res = rebind(standard, "task", 0, ["y"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(decide(taskCtx, "y", [], res.bindings)).toEqual({ kind: "task-close" });
      expect(decide(taskCtx, "t", [], res.bindings)).toEqual({ kind: "swallow" });
    }
  });

  it("suppresses everything else — movement doesn't leak through a frozen board", () => {
    expect(decide(taskCtx, "ArrowUp", [], standard)).toEqual({ kind: "swallow" });
    expect(decide(taskCtx, "i", [], standard)).toEqual({ kind: "swallow" });
    expect(decide(taskCtx, "Enter", [], standard)).toEqual({ kind: "swallow" });
  });

  it("outranks the destination menu (can't both be open, but the check order still matters)", () => {
    expect(decide({ ...taskCtx, destMenuOpen: true }, "Escape", [], standard)).toEqual({ kind: "task-close" });
  });
});

describe("decide — room focus fires 'task' like any other bound action (opens the overlay)", () => {
  it("the default 't' key fires the task action", () => {
    expect(decide(roomCtx, "t", [], standard)).toEqual({ kind: "fire", action: "task" });
  });
});

describe("decide — destination menu focus state", () => {
  it("Escape routes to the esc ladder; Enter/Space select", () => {
    expect(decide(destCtx, "Escape", [], standard)).toEqual({ kind: "dest-escape" });
    expect(decide(destCtx, "Enter", [], standard)).toEqual({ kind: "dest-select" });
    expect(decide(destCtx, " ", [], standard)).toEqual({ kind: "dest-select" });
  });

  it("the CHOSEN movement keys move the cursor (up/left = −1, down/right = +1)", () => {
    // standard: arrows AND wasd are both live
    for (const k of ["ArrowUp", "ArrowLeft", "w", "a"]) {
      expect(decide(destCtx, k, [], standard)).toEqual({ kind: "dest-move", delta: -1 });
    }
    for (const k of ["ArrowDown", "ArrowRight", "s", "d"]) {
      expect(decide(destCtx, k, [], standard)).toEqual({ kind: "dest-move", delta: 1 });
    }
    // vim: hjkl navigate the menu too
    for (const k of ["k", "h"]) {
      expect(decide(destCtx, k, [], vim)).toEqual({ kind: "dest-move", delta: -1 });
    }
    for (const k of ["j", "l"]) {
      expect(decide(destCtx, k, [], vim)).toEqual({ kind: "dest-move", delta: 1 });
    }
  });

  it("a REBOUND movement key navigates the menu; its replaced default no longer does", () => {
    // Rebind standard's wasd-up slot from "w" to "e".
    const res = rebind(standard, "up", 1, ["e"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(decide(destCtx, "e", [], res.bindings)).toEqual({ kind: "dest-move", delta: -1 });
      expect(decide(destCtx, "w", [], res.bindings)).toEqual({ kind: "swallow" });
    }
  });

  it("suppresses everything else (gameplay keys don't reach the room)", () => {
    expect(decide(destCtx, "i", [], standard)).toEqual({ kind: "swallow" });
    expect(decide(destCtx, "p", [], standard)).toEqual({ kind: "swallow" });
  });
});

describe("decide — esc + bindings (room focus)", () => {
  it("Escape is reserved for the esc ladder", () => {
    expect(decide(roomCtx, "Escape", [], standard)).toEqual({ kind: "escape" });
  });

  it("a bound single key fires its action (normalized: 'W' → up)", () => {
    expect(decide(roomCtx, "ArrowUp", [], standard)).toEqual({ kind: "fire", action: "up" });
    expect(decide(roomCtx, "W", [], standard)).toEqual({ kind: "fire", action: "up" });
    expect(decide(roomCtx, "i", [], standard)).toEqual({ kind: "fire", action: "pickup" });
  });

  it("an unbound key passes through", () => {
    expect(decide(roomCtx, "z", [], standard)).toEqual({ kind: "pass" });
  });

  it("a sequence prefix goes pending, then fires on completion (vim dd)", () => {
    const first = decide(roomCtx, "d", [], vim);
    expect(first).toEqual({ kind: "pending", pending: ["d"] });
    expect(decide(roomCtx, "d", ["d"], vim)).toEqual({ kind: "fire", action: "clearLine" });
    expect(decide(roomCtx, "w", ["d"], vim)).toEqual({ kind: "fire", action: "pickup" }); // dw
    expect(decide(roomCtx, "x", ["d"], vim)).toEqual({ kind: "fire", action: "discard" }); // dx
  });

  it("the whole d-operator family stays distinct — dd / dw / dx never shadow each other", () => {
    // They diverge at the SECOND key, so each is reachable and none is a prefix of another.
    const fired = ["d", "w", "x"].map((k) => decide(roomCtx, k, ["d"], vim));
    expect(fired).toEqual([
      { kind: "fire", action: "clearLine" },
      { kind: "fire", action: "pickup" },
      { kind: "fire", action: "discard" },
    ]);
    // Bare `x` is still vim's delete-under-cursor, NOT the inventory discard.
    expect(decide(roomCtx, "x", [], vim)).toEqual({ kind: "fire", action: "deleteToken" });
  });

  it("a broken sequence RESTARTS from the pressed key", () => {
    // pending "d", then "p": ["d","p"] matches nothing → restart from ["p"] → place
    expect(decide(roomCtx, "p", ["d"], vim)).toEqual({ kind: "fire", action: "place" });
    // pending "d", then an unbound key: restart also finds nothing → pass
    expect(decide(roomCtx, "z", ["d"], vim)).toEqual({ kind: "pass" });
  });

  it("standard binds the inventory discard to a bare 'x' (no vim operator prefix)", () => {
    expect(decide(roomCtx, "x", [], standard)).toEqual({ kind: "fire", action: "discard" });
  });
});
