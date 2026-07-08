import { describe, it, expect } from "vitest";
import { resolveEscape, type EscContext } from "./focus";

const plain: EscContext = {
  destMenuOpen: false,
  settingsOpen: false,
  inventoryFocused: false,
  overlayFocused: false,
};

describe("resolveEscape — the esc ladder, every branch", () => {
  it("plain room → open settings (the 'second esc' from a forced room-focus state)", () => {
    expect(resolveEscape(plain)).toBe("open-settings");
  });

  it("destination menu open → close it, stay in the room", () => {
    expect(resolveEscape({ ...plain, destMenuOpen: true })).toBe("close-dest-menu");
  });

  it("settings open → back out (sub-tab → menu → closed)", () => {
    expect(resolveEscape({ ...plain, settingsOpen: true })).toBe("settings-back");
  });

  it("inventory focused → back to room focus (does NOT open settings)", () => {
    expect(resolveEscape({ ...plain, inventoryFocused: true })).toBe("exit-inventory");
  });

  it("focus inside an overlay panel (terminal) → drop focus back to the room", () => {
    expect(resolveEscape({ ...plain, overlayFocused: true })).toBe("refocus-room");
  });

  // Precedence: each rung outranks everything below it.
  it("dest menu outranks settings, inventory, and the overlay", () => {
    expect(
      resolveEscape({ destMenuOpen: true, settingsOpen: true, inventoryFocused: true, overlayFocused: true }),
    ).toBe("close-dest-menu");
  });

  it("settings outranks inventory and the overlay", () => {
    expect(
      resolveEscape({ ...plain, settingsOpen: true, inventoryFocused: true, overlayFocused: true }),
    ).toBe("settings-back");
  });

  it("inventory outranks the overlay", () => {
    expect(resolveEscape({ ...plain, inventoryFocused: true, overlayFocused: true })).toBe("exit-inventory");
  });
});
