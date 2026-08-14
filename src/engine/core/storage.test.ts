// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getItem, setItem } from "./storage";

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("returns null for a key that was never set", () => {
    expect(getItem("storage.test.never-set")).toBeNull();
  });

  it("round-trips a value through setItem/getItem", () => {
    setItem("storage.test.roundtrip", "hello");
    expect(getItem("storage.test.roundtrip")).toBe("hello");
  });

  it("overwrites an existing value", () => {
    setItem("storage.test.overwrite", "first");
    setItem("storage.test.overwrite", "second");
    expect(getItem("storage.test.overwrite")).toBe("second");
  });

  it("prefers window.electronStorage over localStorage when present", () => {
    const mem = new Map<string, string>();
    (window as unknown as { electronStorage: unknown }).electronStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    try {
      setItem("storage.test.bridge", "via-electron");
      expect(mem.get("storage.test.bridge")).toBe("via-electron");
      expect(localStorage.getItem("storage.test.bridge")).toBeNull();
    } finally {
      delete (window as unknown as { electronStorage?: unknown }).electronStorage;
    }
  });
});
