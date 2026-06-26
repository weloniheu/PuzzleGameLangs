import { describe, it, expect } from "vitest";
import { doorReaction, effectiveDoorState, type DoorData } from "./doors";

const none = new Set<string>();

describe("doorReaction — ONE mechanic, data-driven reaction", () => {
  it("open → transition to the door's target", () => {
    const door: DoorData = { target: "py-code-hello-001", state: "open" };
    expect(doorReaction(door, none)).toEqual({ kind: "transition", target: "py-code-hello-001" });
  });

  it("locked (no unlock earned) → blocked (locked)", () => {
    const door: DoorData = { target: "p2", state: "locked", unlock: "puzzle1.cleared" };
    expect(doorReaction(door, none)).toEqual({ kind: "blocked", reason: "locked" });
  });

  it("coming_soon → blocked (coming_soon), never transitions", () => {
    const door: DoorData = { target: "", state: "coming_soon" };
    expect(doorReaction(door, none)).toEqual({ kind: "blocked", reason: "coming_soon" });
  });

  it("locked + the matching unlock earned → transition (the unlock opens it)", () => {
    const door: DoorData = { target: "p2", state: "locked", unlock: "puzzle1.cleared" };
    const earned = new Set(["puzzle1.cleared"]);
    expect(doorReaction(door, earned)).toEqual({ kind: "transition", target: "p2" });
  });

  it("a locked door WITHOUT an unlock key stays blocked even if unlocks exist", () => {
    const door: DoorData = { target: "p2", state: "locked" };
    expect(doorReaction(door, new Set(["anything"]))).toEqual({ kind: "blocked", reason: "locked" });
  });

  it("coming_soon is NOT openable by an unlock (only locked doors are)", () => {
    const door: DoorData = { target: "x", state: "coming_soon", unlock: "puzzle1.cleared" };
    expect(effectiveDoorState(door, new Set(["puzzle1.cleared"]))).toBe("coming_soon");
    expect(doorReaction(door, new Set(["puzzle1.cleared"]))).toEqual({ kind: "blocked", reason: "coming_soon" });
  });
});
