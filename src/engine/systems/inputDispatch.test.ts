import { describe, it, expect } from "vitest";
import { decide, type DispatchContext } from "./inputDispatch";
import { defaultBindings } from "../core/keybindings";

const roomCtx: DispatchContext = { dialogueBlocks: false, dialogueCanSkip: true, destMenuOpen: false };
const dlgCtx: DispatchContext = { ...roomCtx, dialogueBlocks: true };
const destCtx: DispatchContext = { ...roomCtx, destMenuOpen: true };
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

describe("decide — destination menu focus state", () => {
  it("Escape routes to the esc ladder; Enter/Space select", () => {
    expect(decide(destCtx, "Escape", [], standard)).toEqual({ kind: "dest-escape" });
    expect(decide(destCtx, "Enter", [], standard)).toEqual({ kind: "dest-select" });
    expect(decide(destCtx, " ", [], standard)).toEqual({ kind: "dest-select" });
  });

  it("arrows AND wksj move the cursor (up/left = −1, down/right = +1)", () => {
    for (const k of ["ArrowUp", "ArrowLeft", "w", "k"]) {
      expect(decide(destCtx, k, [], standard)).toEqual({ kind: "dest-move", delta: -1 });
    }
    for (const k of ["ArrowDown", "ArrowRight", "s", "j"]) {
      expect(decide(destCtx, k, [], standard)).toEqual({ kind: "dest-move", delta: 1 });
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
  });

  it("a broken sequence RESTARTS from the pressed key", () => {
    // pending "d", then "x": ["d","x"] matches nothing → restart from ["x"] → deleteToken
    expect(decide(roomCtx, "x", ["d"], vim)).toEqual({ kind: "fire", action: "deleteToken" });
    // pending "d", then an unbound key: restart also finds nothing → pass
    expect(decide(roomCtx, "z", ["d"], vim)).toEqual({ kind: "pass" });
  });
});
