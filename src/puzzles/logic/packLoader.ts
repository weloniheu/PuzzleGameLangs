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

  // --- typology LINT: the label is documentation, but it must not CONTRADICT the
  //     declared pattern (the one thing the label actually claims). Predicate-first
  //     (V…) orders must capture the predicate before the subject; S… orders the
  //     reverse. Nothing here ever selects behavior from the label. ---
  const claim = `${pack.typology?.pattern_family ?? ""} ${pack.typology?.word_order ?? ""}`.trim();
  if (claim) {
    const firstCapture = pack.pattern.slots.find((s) => s.capture)?.capture;
    const predicateFirst = /predicate-first/i.test(claim) || /^v/i.test(pack.typology?.word_order ?? "");
    const subjectFirst = /^s/i.test(pack.typology?.word_order ?? "");
    if (predicateFirst && firstCapture !== "predicate") {
      errors.push(`typology claims predicate-first ("${claim}") but the pattern captures "${firstCapture}" first`);
    } else if (subjectFirst && firstCapture !== "subject") {
      errors.push(`typology claims subject-first ("${claim}") but the pattern captures "${firstCapture}" first`);
    }
  }

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
    if (p.par !== undefined && (!Number.isInteger(p.par) || p.par < 1)) {
      errors.push(`${p.id}: par must be a positive integer`);
    }
  }
  return errors;
}

// Bundled, not fetched — same reasoning as engine/packLoader.ts: "/content/..."
// is never copied into dist/, and fetch() is blocked over file:// in a desktop
// build. The logic rule packs are a separate set from the engine's, so they need
// their own glob.
const BUNDLED = import.meta.glob<LogicPack>("../../../content/packs/logic.rules.*.json", {
  eager: true,
  import: "default",
});
const BY_FILE = new Map<string, LogicPack>(
  Object.entries(BUNDLED).map(([spec, pack]) => [spec.slice(spec.lastIndexOf("/") + 1), pack])
);

/** Look up + validate a pack by URL. Throws with the joined errors on invalid data. */
export async function loadLogicPack(url: string): Promise<LogicPack> {
  const bundled = BY_FILE.get(url.slice(url.lastIndexOf("/") + 1));
  if (!bundled) {
    throw new Error(
      `failed to load ${url}: not bundled. Available: ${[...BY_FILE.keys()].sort().join(", ")}`
    );
  }
  // Fresh copy per call — the shared module object must not accumulate the
  // board mutations a played level makes.
  const pack = structuredClone(bundled);
  const errors = validateLogicPack(pack);
  if (errors.length) throw new Error(`invalid logic pack:\n- ${errors.join("\n- ")}`);
  return pack;
}
