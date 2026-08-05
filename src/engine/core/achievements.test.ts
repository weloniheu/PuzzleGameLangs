import { describe, it, expect } from "vitest";
import {
  buildAchievements, groupAchievements, achievementTotals, trackLabel,
  type AchievementSource,
} from "./achievements";
import type { LadderLevel } from "./ladder";

const lv = (id: string, label: string, language: string, mechanic: string, languageLabel?: string): LadderLevel =>
  ({ id, label, language, mechanic, languageLabel });

const SOURCES: AchievementSource[] = [
  {
    puzzleType: "logic_rules",
    levels: [
      lv("l1", "Logic I", "en", "base", "English"),
      lv("l1-sh", "Logic I", "en", "shuffled", "English"),
      lv("l2", "Logic II", "en", "base", "English"),
      lv("h1", "Loiloi ʻEkahi", "haw", "base", "ʻŌlelo Hawaiʻi"),
    ],
  },
  {
    puzzleType: "code_build",
    levels: [lv("c1", "Tutorial", "python", "base", "Python"), lv("c-none", "No grant", "python", "base", "Python")],
  },
];

const GRANTS: Record<string, string> = {
  l1: "logic1.cleared", "l1-sh": "logic1.shuffled.cleared", l2: "logic2.cleared",
  h1: "haw0.cleared", c1: "coding.tutorial.cleared",
};
const grantOf = (id: string) => GRANTS[id];

describe("buildAchievements", () => {
  it("makes one achievement per granting level, in pack order", () => {
    const defs = buildAchievements(SOURCES, grantOf);
    expect(defs.map((d) => d.key)).toEqual([
      "logic1.cleared", "logic1.shuffled.cleared", "logic2.cleared", "haw0.cleared", "coding.tutorial.cleared",
    ]);
  });

  it("skips levels whose room grants nothing (they can't be earned)", () => {
    expect(buildAchievements(SOURCES, grantOf).some((d) => d.label === "No grant")).toBe(false);
  });

  it("suffixes the mechanic on non-base variants so reused labels stay distinct", () => {
    const defs = buildAchievements(SOURCES, grantOf);
    expect(defs.map((d) => d.label)).toContain("Logic I");
    expect(defs.map((d) => d.label)).toContain("Logic I · Shuffled");
  });

  it("groups by track and language label", () => {
    const defs = buildAchievements(SOURCES, grantOf);
    expect(defs[0].group).toBe("Logic — English");
    expect(defs[3].group).toBe("Logic — ʻŌlelo Hawaiʻi");
    expect(defs[4].group).toBe("Coding — Python");
  });

  it("keeps the FIRST level to claim a key (base wins over a variant re-grant)", () => {
    const dupes = buildAchievements(SOURCES, (id) => (id === "l1-sh" ? "logic1.cleared" : GRANTS[id]));
    expect(dupes.filter((d) => d.key === "logic1.cleared")).toHaveLength(1);
    expect(dupes.find((d) => d.key === "logic1.cleared")!.label).toBe("Logic I");
  });

  it("falls back to the capitalized language key when the pack declares no label", () => {
    const defs = buildAchievements(
      [{ puzzleType: "logic_rules", levels: [lv("l1", "Logic I", "en", "base")] }],
      grantOf,
    );
    expect(defs[0].group).toBe("Logic — En");
  });
});

describe("groupAchievements / totals", () => {
  const defs = buildAchievements(SOURCES, grantOf);

  it("counts earned per group and overall", () => {
    const groups = groupAchievements(defs, new Set(["logic1.cleared", "coding.tutorial.cleared"]));
    expect(groups.map((g) => [g.title, `${g.earned}/${g.total}`])).toEqual([
      ["Logic — English", "1/3"],
      ["Logic — ʻŌlelo Hawaiʻi", "0/1"],
      ["Coding — Python", "1/1"],
    ]);
    expect(achievementTotals(groups)).toEqual({ earned: 2, total: 5 });
  });

  it("marks every row unearned on a fresh save", () => {
    const groups = groupAchievements(defs, new Set());
    expect(groups.every((g) => g.rows.every((r) => !r.earned))).toBe(true);
    expect(achievementTotals(groups)).toEqual({ earned: 0, total: 5 });
  });

  it("has no groups (and zero totals) when there is nothing to earn", () => {
    expect(achievementTotals(groupAchievements([], new Set()))).toEqual({ earned: 0, total: 0 });
  });
});

describe("trackLabel", () => {
  it("names the known puzzle types and falls back to the key itself", () => {
    expect(trackLabel("vocab_match")).toBe("Language");
    expect(trackLabel("fix_the_bug")).toBe("fix_the_bug");
  });
});
