import { describe, it, expect } from "vitest";
import { moveSelection, awaySequence } from "./portals";

describe("moveSelection — the destination chooser's cursor", () => {
  it("moves within the option list", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, -1, 3)).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(2, 1, 3)).toBe(2);
  });
});

describe("awaySequence — the strict teleport-away ordering", () => {
  it("runs flash → remove player → transition, in that order", () => {
    const order: string[] = [];
    awaySequence(
      (onDone) => { order.push("flash"); onDone(); },
      () => order.push("remove-player"),
      () => order.push("transition"),
    );
    expect(order).toEqual(["flash", "remove-player", "transition"]);
  });

  it("does NOTHING until the flash completes (no teardown while the bloom plays)", () => {
    const order: string[] = [];
    let finishFlash: () => void = () => {};
    awaySequence(
      (onDone) => { order.push("flash"); finishFlash = onDone; }, // async flash: hold the callback
      () => order.push("remove-player"),
      () => order.push("transition"),
    );
    expect(order).toEqual(["flash"]); // player + map untouched so far
    finishFlash();
    expect(order).toEqual(["flash", "remove-player", "transition"]);
  });
});
