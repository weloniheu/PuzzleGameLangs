import { describe, it, expect } from "vitest";
import { checkSentence, firstIssue, type GrammarWord } from "./grammarCheck";

// A small English word bank (the checker never knows it's English).
const W: Record<string, GrammarWord> = {
  dog: { text: "the dog", role: "subject" },
  cat: { text: "the cat", role: "subject" },
  runs: { text: "runs", role: "verb" },
  chases: { text: "chases", role: "verb" },
  ball: { text: "the ball", role: "object" },
  banana: { text: "banana!", role: "decoy" },
  now: { text: "now", role: "adverb" },
};

const SVO = [["subject", "verb", "object"]];
const SV = [["subject", "verb"]];

describe("checkSentence — the happy path and its alternates", () => {
  it("a correct sentence passes", () => {
    expect(checkSentence([W.dog, W.chases, W.ball], SVO)).toEqual({ valid: true });
  });

  it("an ALTERNATE valid word in a slot passes (several subjects are legal)", () => {
    expect(checkSentence([W.cat, W.chases, W.ball], SVO)).toEqual({ valid: true });
    expect(checkSentence([W.dog, W.runs], SV)).toEqual({ valid: true });
    expect(checkSentence([W.cat, W.runs], SV)).toEqual({ valid: true });
  });
});

describe("checkSentence — what gets flagged, and where", () => {
  it("a wrong-role word is flagged in ITS slot only", () => {
    expect(checkSentence([W.runs, W.chases, W.ball], SVO)).toEqual({
      valid: false,
      slots: ["wrong-role", "ok", "ok"],
    });
  });

  it("right words in the wrong order flag every misplaced slot", () => {
    // subject and object swapped: both nouns, both in the wrong role-slot
    expect(checkSentence([W.ball, W.chases, W.dog], SVO)).toEqual({
      valid: false,
      slots: ["wrong-role", "ok", "wrong-role"],
    });
    // fully reversed: everything is misplaced
    expect(checkSentence([W.ball, W.dog, W.chases], SVO)).toEqual({
      valid: false,
      slots: ["wrong-role", "wrong-role", "wrong-role"],
    });
  });

  it("a partial fill is flagged as empty (not wrong)", () => {
    expect(checkSentence([W.dog, null, W.ball], SVO)).toEqual({
      valid: false,
      slots: ["ok", "empty", "ok"],
    });
    expect(checkSentence([null, null, null], SVO)).toEqual({
      valid: false,
      slots: ["empty", "empty", "empty"],
    });
  });

  it("a decoy word (a role no structure uses) never fits", () => {
    expect(checkSentence([W.dog, W.chases, W.banana], SVO)).toEqual({
      valid: false,
      slots: ["ok", "ok", "wrong-role"],
    });
  });
});

describe("checkSentence — multiple acceptable structures (flexible-order languages)", () => {
  const FLEX = [
    ["adverb", "subject", "verb"],
    ["subject", "verb", "adverb"],
  ];

  it("an arrangement matching ANY declared structure passes", () => {
    expect(checkSentence([W.now, W.dog, W.runs], FLEX)).toEqual({ valid: true });
    expect(checkSentence([W.dog, W.runs, W.now], FLEX)).toEqual({ valid: true });
  });

  it("a miss reports against the CLOSEST structure (smallest fix)", () => {
    // [subject, verb, verb]: one slot off the s-v-adv structure, two off adv-s-v.
    expect(checkSentence([W.dog, W.runs, W.chases], FLEX)).toEqual({
      valid: false,
      slots: ["ok", "ok", "wrong-role"],
    });
  });

  it("a structure with a different length than the frame is ignored", () => {
    expect(checkSentence([W.dog, W.runs], [["subject", "verb", "object"], ["subject", "verb"]]))
      .toEqual({ valid: true });
  });

  it("no structure fitting the frame at all → every slot flagged (bad data guard)", () => {
    expect(checkSentence([W.dog, W.runs], [["subject", "verb", "object"]])).toEqual({
      valid: false,
      slots: ["wrong-role", "wrong-role"],
    });
  });
});

describe("firstIssue — which slot the feedback names", () => {
  it("an empty slot outranks a wrong-role slot (fill the frame first)", () => {
    expect(firstIssue(["wrong-role", "empty", "ok"])).toBe(1);
  });
  it("otherwise the first wrong-role slot", () => {
    expect(firstIssue(["ok", "wrong-role", "wrong-role"])).toBe(1);
  });
  it("-1 when everything is ok", () => {
    expect(firstIssue(["ok", "ok"])).toBe(-1);
  });
});
