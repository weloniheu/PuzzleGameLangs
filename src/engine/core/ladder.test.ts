import { describe, it, expect } from "vitest";
import {
  languageRung, mechanicRung, levelRung, resolveMechanic,
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
  it("frames the list with ← Back first and ⌂ Return to hub last", () => {
    const rung = languageRung(data(), "Coding portal");
    expect(rung.title).toBe("Coding portal");
    expect(rung.rows[0].kind).toBe("back");
    expect(rung.rows.at(-1)).toMatchObject({ kind: "hub", id: HUB_ID });
  });

  it("groups by language in pack order, using the pack's display label", () => {
    const rung = languageRung(data(), "t");
    expect(labels(rung.rows)).toEqual(["← Back", "English", "ʻŌlelo Hawaiʻi", "JavaScript", "⌂ Return to hub"]);
  });

  it("a language with no available level is greyed (locked), not hidden", () => {
    // haw1 needs en1.cleared — not earned yet.
    const rung = languageRung(data(), "t");
    expect(kinds(rung.rows)).toEqual(["back", "enter", "locked", "locked", "hub"]);
    // earning the key opens it
    const open = languageRung(data(["en1.cleared"]), "t");
    expect(kinds(open.rows)).toEqual(["back", "enter", "enter", "locked", "hub"]);
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
    expect(labels(rung.rows)).toEqual(["← Back", "Base", "Shuffled", "⌂ Return to hub"]);
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
    expect(labels(rung.rows)).toEqual(["← Back", "First", "⌂ Return to hub"]);
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
