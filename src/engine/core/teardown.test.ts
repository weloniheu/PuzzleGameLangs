import { describe, it, expect } from "vitest";
import { createTeardown } from "./teardown";

describe("createTeardown — leaving a room destroys EVERYTHING it tracked", () => {
  it("runs every registered undo once, in order", () => {
    const t = createTeardown();
    const calls: string[] = [];
    t.add(() => calls.push("a"));
    t.add(() => calls.push("b"));
    t.add(() => calls.push("c"));
    expect(t.size).toBe(3);
    t.run();
    expect(calls).toEqual(["a", "b", "c"]);
  });

  it("NULLS the tracked list after teardown (no handler ref survives)", () => {
    const t = createTeardown();
    t.add(() => {});
    t.add(() => {});
    expect(t.size).toBe(2);
    t.run();
    expect(t.size).toBe(0); // list cleared — nothing left to leak into the next room
  });

  it("is idempotent: a second run() does not re-fire the undos", () => {
    const t = createTeardown();
    let count = 0;
    t.add(() => { count += 1; });
    t.run();
    t.run();
    expect(count).toBe(1);
  });

  it("a thrown undo does not strand the rest", () => {
    const t = createTeardown();
    const calls: string[] = [];
    t.add(() => { calls.push("before"); });
    t.add(() => { throw new Error("boom"); });
    t.add(() => { calls.push("after"); });
    expect(() => t.run()).not.toThrow();
    expect(calls).toEqual(["before", "after"]);
    expect(t.size).toBe(0);
  });

  it("refuses to re-arm a dead registry (add after run is a no-op)", () => {
    const t = createTeardown();
    t.run();
    t.add(() => { throw new Error("should never run"); });
    expect(t.size).toBe(0);
    expect(() => t.run()).not.toThrow();
  });
});
