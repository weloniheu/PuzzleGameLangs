import { describe, it, expect } from "vitest";
import { moveSelection, focusRow, awaySequence } from "./portals";
import type { LadderRow } from "../core/ladder";

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

describe("focusRow — where the cursor lands on a rung change", () => {
  const rows = (...r: LadderRow[]): LadderRow[] =>
    [...r, { kind: "back", label: "← Back" }, { kind: "hub", label: "⌂ Return to hub" }];

  it("lands on the CURRENT row when the player is in this rung", () => {
    expect(focusRow(rows(
      { kind: "level", label: "Tutorial" },
      { kind: "level", label: "Logic I", current: true },
    ))).toBe(1);
  });

  it("otherwise lands on the first choice, never on the nav rows", () => {
    expect(focusRow(rows({ kind: "enter", label: "English" }))).toBe(0);
  });

  it("falls back to row 0 when a rung has nothing but nav rows", () => {
    expect(focusRow(rows())).toBe(0);
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
