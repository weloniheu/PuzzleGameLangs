import { describe, it, expect } from "vitest";
import {
  languageRung, mechanicRung, levelRung, resolveMechanic, ladderPath,
  type LadderData, type LadderLevel, type LadderRow,
} from "./ladder";
import { HUB_ID } from "./progression";

// A two-language, two-mechanic type (like logic after the Shuffled/Shrouded fade).
const LEVELS: LadderLevel[] = [
  { id: "en1", label: "First",  language: "en", languageLabel: "English", mechanic: "base" },
  { id: "en2", label: "Second", language: "en", languageLabel: "English", mechanic: "base", unlock: "en1.cleared" },
  { id: "en1-shuffled", label: "First", language: "en", languageLabel: "English", mechanic: "shuffled", unlock: "en1.cleared" },
  { id: "haw1", label: "First", language: "haw", languageLabel: "ʻŌlelo Hawaiʻi", mechanic: "base", unlock: "en1.cleared" },
];

const data = (unlocks: string[] = [], currentId: string | null = null): LadderData => ({
  levels: LEVELS,
  lockedLanguages: [{ label: "JavaScript", beat: "Coming soon!" }],
  unlocks: new Set(unlocks),
  currentId,
});

const labels = (rows: LadderRow[]) => rows.map((r) => r.label);
const kinds = (rows: LadderRow[]) => rows.map((r) => r.kind);

describe("languageRung — one row per language + coming-soon siblings, framed by nav", () => {
  it("ends every rung with ← Back then ⌂ Return to hub (choices first)", () => {
    const rung = languageRung(data(), "Coding portal");
    expect(rung.title).toBe("Coding portal");
    expect(rung.rows.at(-2)!.kind).toBe("back");
    expect(rung.rows.at(-1)).toMatchObject({ kind: "hub", id: HUB_ID });
    expect(rung.rows[0].kind).not.toBe("back");
  });

  it("groups by language in pack order, using the pack's display label", () => {
    const rung = languageRung(data(), "t");
    expect(labels(rung.rows)).toEqual(["English", "ʻŌlelo Hawaiʻi", "JavaScript", "← Back", "⌂ Return to hub"]);
  });

  it("a language with no available level is greyed (locked), not hidden", () => {
    // haw1 needs en1.cleared — not earned yet.
    const rung = languageRung(data(), "t");
    expect(kinds(rung.rows)).toEqual(["enter", "locked", "locked", "back", "hub"]);
    // earning the key opens it
    const open = languageRung(data(["en1.cleared"]), "t");
    expect(kinds(open.rows)).toEqual(["enter", "enter", "locked", "back", "hub"]);
  });

  it("locked_languages rows carry their beat and never an enter key", () => {
    const js = languageRung(data(), "t").rows.find((r) => r.label === "JavaScript")!;
    expect(js).toMatchObject({ kind: "locked", beat: "Coming soon!" });
    expect(js.key).toBeUndefined();
  });

  it("tags CURRENT on the group containing the current level", () => {
    const rung = languageRung(data([], "en2"), "t");
    expect(rung.rows.find((r) => r.label === "English")?.current).toBe(true);
    expect(rung.rows.find((r) => r.label === "ʻŌlelo Hawaiʻi")?.current).toBe(false);
  });
});

describe("mechanicRung — the chosen language's mechanics in canonical order", () => {
  it("lists mechanics in canonical order with display labels", () => {
    const rung = mechanicRung(data(["en1.cleared"]), "en");
    expect(rung.title).toBe("English — mechanic");
    expect(labels(rung.rows)).toEqual(["Base", "Shuffled", "← Back", "⌂ Return to hub"]);
  });

  it("greys a mechanic whose levels are all locked", () => {
    const rung = mechanicRung(data(), "en"); // en1-shuffled needs en1.cleared
    expect(rung.rows.find((r) => r.label === "Shuffled")?.kind).toBe("locked");
    expect(rung.rows.find((r) => r.label === "Base")?.kind).toBe("enter");
  });

  it("tags CURRENT on the mechanic containing the current level", () => {
    const rung = mechanicRung(data(["en1.cleared"], "en1-shuffled"), "en");
    expect(rung.rows.find((r) => r.label === "Shuffled")?.current).toBe(true);
  });
});

describe("levelRung — only AVAILABLE levels, in pack order (no skip-ahead)", () => {
  it("hides levels whose unlock is not earned", () => {
    const rung = levelRung(data(), "en", "base");
    expect(labels(rung.rows)).toEqual(["First", "← Back", "⌂ Return to hub"]);
  });

  it("an earned unlock reveals its level, keeping pack order", () => {
    const rung = levelRung(data(["en1.cleared"]), "en", "base");
    expect(rung.rows.filter((r) => r.kind === "level").map((r) => r.id)).toEqual(["en1", "en2"]);
  });

  it("level rows carry id + flash color and the CURRENT tag", () => {
    const stamped = data([], "en1");
    stamped.levels = stamped.levels.map((lv) => ({ ...lv, flashColor: "#123456" }));
    const rung = levelRung(stamped, "en", "base");
    const row = rung.rows.find((r) => r.kind === "level")!;
    expect(row).toMatchObject({ id: "en1", current: true, flashColor: "#123456" });
    expect(rung.title).toBe("Base — level");
  });
});

describe("ladderPath — the chooser opens on the rung the player is standing in", () => {
  it("drills to the current level's language → mechanic rung", () => {
    expect(ladderPath(data([], "en1-shuffled"))).toEqual([{}, { lang: "en" }, { lang: "en", mech: "shuffled" }]);
  });

  it("no current level (a hub door) opens at the language rung", () => {
    expect(ladderPath(data())).toEqual([{}]);
  });

  it("an unknown current id falls back to the language rung", () => {
    expect(ladderPath(data([], "nope"))).toEqual([{}]);
  });
});

describe("resolveMechanic — tier wins; else the modifiers signature", () => {
  it("uses mechanics.tier when set", () => {
    expect(resolveMechanic({ mechanics: { tier: "mixed" } })).toBe("mixed");
  });
  it("derives from the modifiers signature (order-insensitive)", () => {
    expect(resolveMechanic({})).toBe("base");
    expect(resolveMechanic({ modifiers: [] })).toBe("base");
    expect(resolveMechanic({ modifiers: ["randomized"] })).toBe("shuffled");
    expect(resolveMechanic({ modifiers: ["randomized", "lowlight"] })).toBe("shrouded");
    expect(resolveMechanic({ modifiers: ["lowlight", "randomized"] })).toBe("shrouded");
  });
  it("an unrecognized signature still yields a stable opaque key", () => {
    expect(resolveMechanic({ modifiers: ["lowlight"] })).toBe("lowlight");
  });
  it("handles a missing puzzle (unregistered level id)", () => {
    expect(resolveMechanic(null)).toBe("base");
  });
});
