import { describe, it, expect } from "vitest";
import { destinationMenu, HUB_ID, type DestinationOption } from "./progression";
import type { LevelEntry } from "../../schema/types";

const LEVELS: LevelEntry[] = [
  { id: "lvl1", label: "Greeting" },                       // first level — always available
  { id: "lvl2", label: "Your name", unlock: "p1.cleared" },
  { id: "lvl3", label: "The door", unlock: "p2.cleared" },
];

const ids = (opts: DestinationOption[]) => opts.map((o) => o.id);

describe("destinationMenu — Hub + unlocked levels of the current type", () => {
  it("always lists the Hub first", () => {
    const menu = destinationMenu(LEVELS, new Set());
    expect(menu[0]).toEqual({ kind: "hub", id: HUB_ID, label: "Hub" });
  });

  it("with no unlocks: only the first level (no skip-ahead to unbeaten levels)", () => {
    expect(ids(destinationMenu(LEVELS, new Set()))).toEqual([HUB_ID, "lvl1"]);
  });

  it("completing level 1 (its unlock earned) reveals exactly level 2", () => {
    expect(ids(destinationMenu(LEVELS, new Set(["p1.cleared"])))).toEqual([HUB_ID, "lvl1", "lvl2"]);
  });

  it("a not-yet-earned later unlock does NOT reveal its level", () => {
    // p2 earned but not p1: lvl2 stays hidden (its own key is what gates it, in order)
    const menu = ids(destinationMenu(LEVELS, new Set(["p2.cleared"])));
    expect(menu).toEqual([HUB_ID, "lvl1", "lvl3"]);
  });

  it("all unlocks earned → every level appears, in pack order", () => {
    expect(ids(destinationMenu(LEVELS, new Set(["p1.cleared", "p2.cleared"]))))
      .toEqual([HUB_ID, "lvl1", "lvl2", "lvl3"]);
  });

  it("honors a custom hub id/label", () => {
    const menu = destinationMenu([], new Set(), "home", "Home");
    expect(menu).toEqual([{ kind: "hub", id: "home", label: "Home" }]);
  });
});
