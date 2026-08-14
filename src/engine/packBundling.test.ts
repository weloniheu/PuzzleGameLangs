// ---------------------------------------------------------------------------
// Guards the bug this test file was written for: the shipped build could not
// start, because packs were fetched from "/content/packs/*.json" while
// `content/` was never copied into dist/. The whole test suite passed the whole
// time — every other pack test reads from disk with readFileSync or imports the
// JSON directly, so nothing exercised the path the GAME actually uses.
//
// So these assert two things nothing else does:
//   1. every pack on disk is compiled into the bundle, and
//   2. the URLs main.ts asks for actually resolve through loadPack.
// A renamed or newly-added pack now fails here instead of at a player's launch.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack, bundledPackFiles } from "./packLoader";

const PACK_DIR = join(__dirname, "..", "..", "content", "packs");
const onDisk = readdirSync(PACK_DIR).filter((f) => f.endsWith(".json")).sort();

describe("pack bundling", () => {
  it("compiles every pack in content/packs into the bundle", () => {
    expect(onDisk.length).toBeGreaterThan(0);
    expect(bundledPackFiles()).toEqual(onDisk);
  });

  it("resolves each pack by its authored root-absolute URL", async () => {
    for (const file of onDisk) {
      const pack = await loadPack(`/content/packs/${file}`);
      expect(Array.isArray(pack.puzzles), `${file} has no puzzles array`).toBe(true);
    }
  });

  it("loads every pack URL referenced by main.ts", async () => {
    const main = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
    const urls = [...new Set(main.match(/\/content\/packs\/[\w.-]+\.json/g) ?? [])];

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) await expect(loadPack(url)).resolves.toBeDefined();
  });

  it("rejects an unknown pack with a message naming what IS bundled", async () => {
    await expect(loadPack("/content/packs/nope.v1.json")).rejects.toThrow(/not bundled/);
  });

  it("hands each caller its own copy, so runtime mutation cannot leak", async () => {
    const url = `/content/packs/${onDisk[0]}`;
    const first = await loadPack(url);
    const second = await loadPack(url);

    expect(first).not.toBe(second);
    expect(first.puzzles[0]).not.toBe(second.puzzles[0]);
  });
});
