// @vitest-environment jsdom
// The BOOT path — main.ts's own side effects, which no other test covers.
//
// What this pins: the game used to open on a title screen and wait for ▶ Start before
// anything loaded. It now loads the world and puts the player in the hub directly, so
// "is it playable yet?" has no gate in front of it. The title screen still EXISTS (it is
// where Settings → Quit lands), it just isn't in the way on the way in.
import { describe, it, expect, vi } from "vitest";

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);
}

describe("boot", () => {
  it("drops the player straight into the hub — no Start screen to get past", async () => {
    document.body.innerHTML = '<div id="app"></div>'; // what index.html provides
    await import("./main");

    // The hub mounts on its own, once the bundled packs resolve.
    await vi.waitFor(() => expect(document.querySelector(".room-world")).toBeTruthy());
    expect(document.querySelector(".title-screen")).toBeNull();
    expect(document.querySelectorAll(".room-door-layer .tile-portal")).toHaveLength(4);
    expect(document.querySelector(".slime")).toBeTruthy();
    // …and the room owns the screen: the card host is hidden, fullscreen mode is on.
    expect((document.getElementById("app") as HTMLElement).hidden).toBe(true);
    expect(document.body.classList.contains("fullscreen-game")).toBe(true);
  });
});
