// ---------------------------------------------------------------------------
// LOGIC pack loader + self-consistency validation. PURE (fetch is injectable).
//
// A pack is valid data the ENGINE can play without language knowledge, so the checks
// are structural only: the pattern is well-formed, every word-tile a puzzle places is
// declared in the vocab, and roles line up. This is the open/closed guard — it never
// looks at WHICH language, only that the shape holds.
// ---------------------------------------------------------------------------

import type { LogicPack } from "./schema";

export function validateLogicPack(pack: LogicPack): string[] {
  const errors: string[] = [];

  // --- pattern: needs exactly one subject + one predicate capture ---
  const captures = pack.pattern.slots.map((s) => s.capture).filter(Boolean);
  if (!captures.includes("subject")) errors.push("pattern has no `subject` slot");
  if (!captures.includes("predicate")) errors.push("pattern has no `predicate` slot");
  if (!pack.pattern.directions?.length) errors.push("pattern declares no reading directions");

  // --- vocab: build the text→entry index, flag dupes ---
  const vocab = new Map<string, (typeof pack.vocab)[number]>();
  for (const v of pack.vocab) {
    if (vocab.has(v.text)) errors.push(`duplicate vocab word "${v.text}"`);
    vocab.set(v.text, v);
  }

  // --- every placed word must be declared; positions must be in bounds ---
  for (const p of pack.puzzles) {
    for (const w of p.words) {
      if (!vocab.has(w.text)) errors.push(`${p.id}: word "${w.text}" is not in the vocab`);
      if (w.x < 0 || w.y < 0 || w.x >= p.width || w.y >= p.height) {
        errors.push(`${p.id}: word "${w.text}" is out of bounds at (${w.x},${w.y})`);
      }
    }
    for (const o of p.objects) {
      if (o.x < 0 || o.y < 0 || o.x >= p.width || o.y >= p.height) {
        errors.push(`${p.id}: object "${o.noun}" is out of bounds at (${o.x},${o.y})`);
      }
    }
  }
  return errors;
}

/** Fetch + validate a pack from a URL. Throws with the joined errors on invalid data. */
export async function loadLogicPack(url: string): Promise<LogicPack> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  const pack = (await res.json()) as LogicPack;
  const errors = validateLogicPack(pack);
  if (errors.length) throw new Error(`invalid logic pack:\n- ${errors.join("\n- ")}`);
  return pack;
}
