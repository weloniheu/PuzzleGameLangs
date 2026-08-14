// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { paintTaskOverlay, removeTaskOverlay } from "./taskOverlay";

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
}

let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

describe("paintTaskOverlay", () => {
  it("shows the description", () => {
    paintTaskOverlay(container, { description: "Store 5 in x, then print x." });
    expect(container.querySelector(".task-overlay-desc")?.textContent).toBe("Store 5 in x, then print x.");
    expect(container.querySelector(".task-overlay-output")).toBeNull();
  });

  it("shows the output as its own block, distinct from the description", () => {
    paintTaskOverlay(container, { description: "Make the panel say: hello world", output: "hello world" });
    expect(container.querySelector(".task-overlay-desc")?.textContent).toBe("Make the panel say: hello world");
    expect(container.querySelector(".task-overlay-output")?.textContent).toBe("hello world");
  });

  it("never names the rebindable 'task' key, only the fixed Escape", () => {
    paintTaskOverlay(container, { description: "x" });
    const foot = container.querySelector(".task-overlay-foot")?.textContent ?? "";
    expect(foot).toContain("Esc");
    expect(foot.toLowerCase()).not.toContain("t —");
  });

  it("repaints in place — a second call does not stack a second scrim", () => {
    paintTaskOverlay(container, { description: "first" });
    paintTaskOverlay(container, { description: "second" });
    expect(container.querySelectorAll(".task-overlay-scrim")).toHaveLength(1);
    expect(container.querySelector(".task-overlay-desc")?.textContent).toBe("second");
  });
});

describe("removeTaskOverlay", () => {
  it("removes the scrim; a no-op when nothing is painted", () => {
    paintTaskOverlay(container, { description: "x" });
    removeTaskOverlay(container);
    expect(container.querySelector(".task-overlay-scrim")).toBeNull();
    expect(() => removeTaskOverlay(container)).not.toThrow();
  });
});
