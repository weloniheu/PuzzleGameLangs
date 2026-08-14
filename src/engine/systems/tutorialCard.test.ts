// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { paintTutorialCard, tutorialModuleMeta } from "./tutorialCard";
import type { DialogueBeat, TutorialDemo } from "../../schema/types";

// The tutorial CARD is the whole visual surface of a guided tutorial, and its one job that
// content depends on is: draw the right picture for the step. These pin the two rules the
// authoring spec (content/TUTORIAL_SCRIPTS.md) promises pack authors.

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
}

const beat = (over: Partial<DialogueBeat> = {}): DialogueBeat => ({
  id: "b", speaker: "narrator", text: "text", trigger: "guided_tutorial", ...over,
});

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

const paint = (b: DialogueBeat) =>
  paintTutorialCard(container, { beat: b, idx: 0, total: 1, module: { label: "Coding" } });

describe("which picture a step draws", () => {
  // An INTERACTIVE step illustrates the action it is waiting on, for free — content never
  // has to name it, which is why `demo` is optional.
  it("defaults to the action a waitFor step is waiting on", () => {
    paint(beat({ waitFor: "pickup" }));
    expect(container.querySelector(".tdemo-pickup")).toBeTruthy();
  });

  // The point of the CONCEPT demos: an informational step has no action to draw, but a new
  // IDEA still needs a picture. Before `demo` existed these steps were text-only.
  it("draws the requested picture on an informational step, which has no action", () => {
    paint(beat({ demo: "indent" }));
    expect(container.querySelector(".tdemo-indent")).toBeTruthy();
  });

  it("stays text-only when a step asks for neither", () => {
    paint(beat({}));
    expect(container.querySelector(".tutorial-card-demo")).toBeNull();
  });

  it("lets an explicit demo override the waitFor default", () => {
    paint(beat({ waitFor: "place", demo: "loop" }));
    expect(container.querySelector(".tdemo-loop")).toBeTruthy();
    expect(container.querySelector(".tdemo-place")).toBeNull();
  });

  // Every kind in the closed set must actually render something — a content author picking
  // a legal value must never get an empty box.
  it("renders a non-empty picture for every kind in the closed set", () => {
    const kinds: TutorialDemo[] = [
      "move", "interact", "pickup", "place", "drop", "build", "run", "enter_door", "push", "combine",
      "prefilled", "loop", "indent", "function", "argument", "shuffle", "lowlight",
    ];
    for (const kind of kinds) {
      container.innerHTML = "";
      paint(beat({ demo: kind }));
      const demo = container.querySelector(`.tdemo-${kind}`);
      expect(demo, `missing demo for "${kind}"`).toBeTruthy();
      expect(demo!.childElementCount, `empty demo for "${kind}"`).toBeGreaterThan(0);
    }
  });
});

describe("module badge", () => {
  // The hub borrows code_build's room shell but is not that module's puzzle, so it gets its
  // own badge rather than being labelled "Coding".
  it("names the hub as itself, not the module whose shell it borrows", () => {
    expect(tutorialModuleMeta("code_build", "hub").label).toBe("Hub");
    expect(tutorialModuleMeta("code_build", "py-code-tutorial-000").label).toBe("Coding");
  });
});

describe("layout", () => {
  // A waitFor step must not cover the mechanic it is asking the player to perform.
  it("docks undimmed for an interactive step and takes over the screen for an informational one", () => {
    paint(beat({ waitFor: "push" }));
    expect(container.querySelector(".tutorial-card-scrim")!.classList).toContain("tutorial-card-scrim--live");
    paint(beat({}));
    expect(container.querySelector(".tutorial-card-scrim")!.classList).not.toContain("tutorial-card-scrim--live");
  });
});
