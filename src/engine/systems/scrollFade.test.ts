// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { scrollEdges, attachScrollFade } from "./scrollFade";

/** jsdom's scrollTop/scrollHeight/clientHeight are real getters with no layout engine
 *  behind them (scrollHeight has no setter at all) — redefine them as plain writable
 *  properties so a test can fake a scroll position without a real layout pass. */
function stubScrollGeometry(
  el: HTMLElement,
  geo: { scrollTop: number; scrollHeight: number; clientHeight: number },
): void {
  for (const [key, value] of Object.entries(geo)) {
    Object.defineProperty(el, key, { value, writable: true, configurable: true });
  }
}

describe("scrollEdges", () => {
  it("shows neither edge when everything fits (no overflow)", () => {
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toEqual({ top: false, bottom: false });
  });

  it("shows only bottom at the top of an overflowing list", () => {
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 500, clientHeight: 200 })).toEqual({ top: false, bottom: true });
  });

  it("shows only top at the bottom of an overflowing list", () => {
    expect(scrollEdges({ scrollTop: 300, scrollHeight: 500, clientHeight: 200 })).toEqual({ top: true, bottom: false });
  });

  it("shows both edges in the middle", () => {
    expect(scrollEdges({ scrollTop: 150, scrollHeight: 500, clientHeight: 200 })).toEqual({ top: true, bottom: true });
  });

  it("absorbs sub-pixel rounding at the exact ends", () => {
    expect(scrollEdges({ scrollTop: 0.4, scrollHeight: 500, clientHeight: 200 }).top).toBe(false);
    expect(scrollEdges({ scrollTop: 300, scrollHeight: 500.4, clientHeight: 200 }).bottom).toBe(false);
  });
});

describe("attachScrollFade", () => {
  it("paints the initial state immediately, before any scroll event", () => {
    const scroller = document.createElement("div");
    stubScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
    const top = document.createElement("div");
    const bottom = document.createElement("div");
    attachScrollFade(scroller, top, bottom);
    expect(top.classList.contains("visible")).toBe(false);
    expect(bottom.classList.contains("visible")).toBe(true);
  });

  it("repaints on scroll", () => {
    const scroller = document.createElement("div");
    stubScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
    const top = document.createElement("div");
    const bottom = document.createElement("div");
    attachScrollFade(scroller, top, bottom);
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event("scroll"));
    expect(top.classList.contains("visible")).toBe(true);
    expect(bottom.classList.contains("visible")).toBe(false);
  });
});
