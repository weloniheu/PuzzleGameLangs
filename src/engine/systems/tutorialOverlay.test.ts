// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { mountGuidedTutorial } from "./tutorialOverlay";
import type { DialogueBeat, Puzzle } from "../../schema/types";

// The CARD-GAME tutorial driver (match / combine / sentence_build). It owns its own key
// handling rather than going through the room's input dispatch, so the promise the
// authoring spec makes — plays ONCE per puzzle TYPE (ever, persisted), Escape always
// leaves and counts as "seen" too — needs pinning here.

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
}

const beats: DialogueBeat[] = [
  { id: "1", speaker: "narrator", text: "step one", trigger: "guided_tutorial" },
  { id: "2", speaker: "narrator", text: "step two", trigger: "guided_tutorial", waitFor: "push" },
  { id: "3", speaker: "narrator", text: "step three", trigger: "guided_tutorial" },
];

const puzzle = (guided = beats) =>
  ({ id: "eng-match-pos-001", puzzle_type: "match", payload: { guided_tutorial: guided } } as unknown as Puzzle);

let container: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

const key = (k: string) =>
  container.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const showing = () => container.querySelector(".tutorial-card")?.textContent ?? "";

describe("card-game tutorial: plays once per puzzle TYPE, always escapable", () => {
  it("does not replay for a LATER mount of the same puzzle before this one ever finished", () => {
    mountGuidedTutorial(container, puzzle()).notify("push");
    expect(showing()).toContain("step one");

    // Still mid-run (never finished/skipped) — nothing has been marked seen yet.
    const second = document.createElement("div");
    document.body.appendChild(second);
    mountGuidedTutorial(second, puzzle());
    expect(second.querySelector(".tutorial-card")?.textContent).toContain("step one");
  });

  it("a FINISHED run does not replay on a later mount of the same puzzle_type", () => {
    const t = mountGuidedTutorial(container, puzzle());
    key("Enter");        // step 1 → step 2 (waitFor push)
    t.notify("push");    // step 2 → step 3
    key("Enter");         // step 3 → finish()
    expect(container.querySelector(".tutorial-card")).toBeNull();

    // A later mount, even a DIFFERENT puzzle id, of the SAME puzzle_type stays silent.
    const second = document.createElement("div");
    document.body.appendChild(second);
    const t2 = mountGuidedTutorial(second, { ...puzzle(), id: "haw-match-001" });
    expect(t2.active()).toBe(false);
    expect(second.querySelector(".tutorial-card")).toBeNull();
  });

  it("Escape-skipping counts as seen too — a later mount of the same type stays silent", () => {
    mountGuidedTutorial(container, puzzle());
    key("Escape");
    expect(container.querySelector(".tutorial-card")).toBeNull();

    const second = document.createElement("div");
    document.body.appendChild(second);
    const t2 = mountGuidedTutorial(second, puzzle());
    expect(t2.active()).toBe(false);
    expect(second.querySelector(".tutorial-card")).toBeNull();
  });

  it("seen-tracking is per puzzle_type — a DIFFERENT type still plays", () => {
    const t = mountGuidedTutorial(container, puzzle());
    key("Enter"); t.notify("push"); key("Enter"); // finish "match"

    const second = document.createElement("div");
    document.body.appendChild(second);
    const combinePuzzle = { ...puzzle(), puzzle_type: "combine" } as unknown as Puzzle;
    const t2 = mountGuidedTutorial(second, combinePuzzle);
    expect(t2.active()).toBe(true);
    expect(second.querySelector(".tutorial-card")?.textContent).toContain("step one");
  });

  it("Escape ends the whole run from an informational step", () => {
    mountGuidedTutorial(container, puzzle());
    expect(showing()).toContain("step one");
    key("Escape");
    expect(container.querySelector(".tutorial-card")).toBeNull();
  });

  it("Escape also works from a waitFor step, where gameplay keys pass through", () => {
    const t = mountGuidedTutorial(container, puzzle());
    key("Enter");                       // step 1 → step 2 (waits for a push)
    expect(showing()).toContain("step two");
    expect(t.active()).toBe(true);
    key("Escape");                      // the way out for someone who knows the mechanic
    expect(container.querySelector(".tutorial-card")).toBeNull();
    expect(t.active()).toBe(false);
    // The run is over: a later push must not resurrect it.
    t.notify("push");
    expect(container.querySelector(".tutorial-card")).toBeNull();
  });

  it("advances through the real action on a waitFor step", () => {
    const t = mountGuidedTutorial(container, puzzle());
    key("Enter");
    expect(showing()).toContain("step two");
    t.notify("push");
    expect(showing()).toContain("step three");
  });

  it("mounts nothing when the puzzle carries no tutorial", () => {
    const t = mountGuidedTutorial(container, puzzle([]));
    expect(t.active()).toBe(false);
    expect(container.querySelector(".tutorial-card")).toBeNull();
  });
});
