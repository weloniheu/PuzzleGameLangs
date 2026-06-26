import { describe, it, expect } from "vitest";
import { portalFlashColor, HUB_FLASH, FALLBACK_FLASH } from "./portalColors";

describe("portalFlashColor — destination-derived, red reserved for hub", () => {
  it("hub exit is RED, always", () => {
    expect(portalFlashColor({ hub: true })).toBe(HUB_FLASH);
  });

  it("hub RED is forced even when an override is present", () => {
    expect(portalFlashColor({ hub: true, override: "#ffffff" })).toBe(HUB_FLASH);
  });

  it("maps puzzle types to their category colors", () => {
    expect(portalFlashColor({ puzzleType: "code_build" })).toBe("#3b6ea5");      // code → blue
    expect(portalFlashColor({ puzzleType: "match" })).toBe("#3a9a55");           // language → green
    expect(portalFlashColor({ puzzleType: "combine" })).toBe("#d8b13a");         // logic → yellow
    expect(portalFlashColor({ puzzleType: "sentence_build" })).toBe("#8a5cc4");  // grammar → purple
  });

  it("a custom override wins over the type-derived default (non-hub)", () => {
    expect(portalFlashColor({ puzzleType: "code_build", override: "#c850ff" })).toBe("#c850ff");
  });

  it("falls back for an unmapped type or when nothing is given", () => {
    expect(portalFlashColor({ puzzleType: "fix_the_bug" })).toBe(FALLBACK_FLASH);
    expect(portalFlashColor({})).toBe(FALLBACK_FLASH);
  });
});
