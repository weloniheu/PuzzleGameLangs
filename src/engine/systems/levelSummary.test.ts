// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createLevelSummary, summaryChoices } from "./levelSummary";
import type { ScoreCard } from "../core/score";

describe("summaryChoices — the card always offers somewhere to go", () => {
  it("leads with the next level when the ladder has one", () => {
    const rows = summaryChoices({ id: "py-code-loops-001", label: "Loops I" });
    expect(rows.map((r) => r.label))
      .toEqual(["Loops I →", "↻ Play again", "☰ Choose a level", "⌂ Return to hub"]);
    expect(rows[0].action).toEqual({ kind: "next", id: "py-code-loops-001", flashColor: undefined });
    expect(rows[0].primary).toBe(true);
  });

  it("carries the destination's flash colour through to the transition", () => {
    const rows = summaryChoices({ id: "x", label: "X", flashColor: "#6cf" });
    expect(rows[0].action).toEqual({ kind: "next", id: "x", flashColor: "#6cf" });
  });

  it("promotes the hub when the ladder has nothing left open", () => {
    const rows = summaryChoices(null);
    expect(rows.map((r) => r.label))
      .toEqual(["⌂ Return to hub", "↻ Play again", "☰ Choose a level"]);
    expect(rows[0].primary).toBe(true);
    expect(rows[0].action).toEqual({ kind: "hub" });
  });

  it("marks exactly one primary choice — the one the cursor opens on", () => {
    for (const rows of [summaryChoices(null), summaryChoices({ id: "a", label: "A" })]) {
      expect(rows.filter((r) => r.primary)).toHaveLength(1);
    }
  });
});

// A finished run with one free row and one that cost points — enough to exercise both
// shapes of stat row without pulling in the real scorer.
const CARD: ScoreCard = {
  points: 860,
  grade: "A",
  stars: 2,
  lines: [
    { label: "Time", value: "1:02:05", penalty: 0 },
    { label: "Hints used", value: "3", penalty: 30 },
  ],
};

describe("createLevelSummary — the DOM the skin and the ledger depend on", () => {
  const mount = (container: HTMLElement) => {
    const summary = createLevelSummary({ container, onChoose: () => {} });
    summary.open({ title: "Ocean Words", card: CARD, next: null });
    return summary;
  };

  it("mounts INSIDE the container it was handed, so the room's skin reaches the card", () => {
    const container = document.createElement("div");
    container.className = "room-theme-tropical"; // what roomHost stamps for a themed pack
    mount(container);

    // The card's five --sum-* tokens are re-pointed by an ANCESTOR class. Move this
    // overlay to document.body and every skin silently falls back to grove — the CSS
    // still parses, the game still runs, and nothing else in the suite would notice.
    const card = container.querySelector(".room-summary-card")!;
    expect(card.closest(".room-theme-tropical")).toBe(container);
  });

  it("puts the penalty chip LEFT of the value, and only on a row that cost something", () => {
    const container = document.createElement("div");
    mount(container);

    const rows = [...container.querySelectorAll(".room-summary-row")];
    expect(rows).toHaveLength(2);
    // A free row is plain: label then value, no red anywhere.
    expect([...rows[0].children].map((e) => e.className))
      .toEqual(["room-summary-label", "room-summary-value"]);
    // A costly one wears its chip BEFORE the value, so the mono digits stay in one
    // right-hand column whether or not the row cost anything.
    expect([...rows[1].children].map((e) => e.className))
      .toEqual(["room-summary-label", "room-summary-penalty", "room-summary-value"]);
    expect(rows[1].querySelector(".room-summary-penalty")!.textContent).toBe("\u221230");
  });

  it("stamps the letter into the seal, with the shine over it", () => {
    const container = document.createElement("div");
    mount(container);

    const seal = container.querySelector(".room-summary-seal")!;
    expect([...seal.children].map((e) => e.className))
      .toEqual(["room-summary-seal-shine", "room-summary-letter"]);
    expect(seal.querySelector(".room-summary-letter")!.textContent).toBe("A");
  });
});
