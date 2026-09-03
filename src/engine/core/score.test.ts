import { describe, it, expect } from "vitest";
import {
  scoreRun, gradeFor, starsFor, formatDuration,
  MAX_POINTS, PAR_SECONDS, PAR_STEPS,
} from "./score";

const clean = { elapsedMs: 10_000, steps: 20, hints: 0, misses: 0 };
const penaltyOf = (label: string, card: ReturnType<typeof scoreRun>) =>
  card.lines.find((l) => l.label === label)!.penalty;

describe("scoreRun", () => {
  it("a fast, hintless, first-try run is full marks", () => {
    const card = scoreRun(clean);
    expect(card.points).toBe(MAX_POINTS);
    expect(card.grade).toBe("S");
    expect(card.stars).toBe(3);
    expect(card.lines.every((l) => l.penalty === 0)).toBe(true);
  });

  it("charges per failed run and per hint", () => {
    expect(scoreRun({ ...clean, misses: 2 }).points).toBe(MAX_POINTS - 120);
    expect(scoreRun({ ...clean, hints: 3 }).points).toBe(MAX_POINTS - 225);
  });

  it("time and steps only charge for what went OVER par", () => {
    // Exactly at par is free; a second/step past it is not.
    expect(penaltyOf("Time", scoreRun({ ...clean, elapsedMs: PAR_SECONDS * 1000 }))).toBe(0);
    expect(penaltyOf("Time", scoreRun({ ...clean, elapsedMs: (PAR_SECONDS + 10) * 1000 }))).toBe(20);
    expect(penaltyOf("Steps", scoreRun({ ...clean, steps: PAR_STEPS }))).toBe(0);
    expect(penaltyOf("Steps", scoreRun({ ...clean, steps: PAR_STEPS + 40 }))).toBe(20);
  });

  it("a level's own par (CONTENT) replaces the engine default", () => {
    // A long level says so: the same 5-minute run that would be way over the default
    // is exactly on time here.
    const long = { ...clean, elapsedMs: 300_000, steps: 400 };
    expect(penaltyOf("Time", scoreRun(long))).toBeGreaterThan(0);
    expect(penaltyOf("Time", scoreRun(long, { seconds: 300 }))).toBe(0);
    expect(penaltyOf("Steps", scoreRun(long, { steps: 400 }))).toBe(0);
  });

  it("time and step penalties are capped — a slow run is never a zero", () => {
    const crawl = scoreRun({ elapsedMs: 10 * 3600_000, steps: 100_000, hints: 0, misses: 0 });
    expect(penaltyOf("Time", crawl)).toBe(250);
    expect(penaltyOf("Steps", crawl)).toBe(150);
    expect(crawl.points).toBe(MAX_POINTS - 400);
  });

  it("clamps at zero — enough hints and retries can't go negative", () => {
    const card = scoreRun({ ...clean, hints: 50, misses: 50 });
    expect(card.points).toBe(0);
    expect(card.grade).toBe("D");
  });

  it("finishing at all is worth a star, however it went", () => {
    expect(scoreRun({ ...clean, hints: 50, misses: 50 }).stars).toBe(1);
  });

  it("reports each measured cost as its own row", () => {
    const card = scoreRun({ elapsedMs: 65_000, steps: 30, hints: 1, misses: 2 });
    expect(card.lines).toEqual([
      { label: "Time", value: "1:05", penalty: 0 },
      { label: "Steps", value: "30", penalty: 0 },
      { label: "Hints used", value: "1", penalty: 75 },
      { label: "Failed runs", value: "2", penalty: 120 },
    ]);
    expect(card.points).toBe(MAX_POINTS - 195);
  });
});

describe("gradeFor / starsFor", () => {
  it("grades on the cut points", () => {
    expect(["S", "A", "B", "C", "D"].map((_, i) => gradeFor([1000, 900, 800, 600, 100][i])))
      .toEqual(["S", "A", "B", "C", "D"]);
    expect(gradeFor(950)).toBe("S"); // boundaries land on the better grade
    expect(gradeFor(949)).toBe("A");
  });

  it("hands out 3 / 2 / 1 stars, never 0", () => {
    expect(starsFor(1000)).toBe(3);
    expect(starsFor(850)).toBe(3);
    expect(starsFor(849)).toBe(2);
    expect(starsFor(700)).toBe(2);
    expect(starsFor(699)).toBe(1);
    expect(starsFor(0)).toBe(1);
  });
});

describe("formatDuration", () => {
  it("reads as m:ss, growing an hours field only when needed", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9_000)).toBe("0:09");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(600_000)).toBe("10:00");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});
