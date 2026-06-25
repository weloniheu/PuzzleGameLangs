import type { PuzzleType, Difficulty } from "../schema/types";

// The schema is injected verbatim into the prompt so the model fills a fixed
// contract. We import the raw text (Vite `?raw`) and parse it so the prompt gets
// the exact source. (Strict JSON today; if the schema ever grows comments, parse
// it comment-tolerantly here.)
import schemaRaw from "../schema/puzzle.schema.json?raw";
const schema = JSON.parse(schemaRaw);

export interface GenerationRequest {
  language: string;       // OPEN content axis, e.g. "hawaiian"
  puzzle_type: PuzzleType; // CLOSED — must be one the engine supports
  difficulty: Difficulty;
  count: number;
  concept?: string;       // e.g. "common greetings"
}

/**
 * Concrete, per-language difficulty rubric (roadmap Phase 7). Difficulty must
 * be defined in CONTENT terms or the LLM guesses. Extend this table per language.
 */
const RUBRICS: Record<string, Partial<Record<Difficulty, string>>> = {
  hawaiian: {
    1: "very common 1-2 syllable nouns/greetings (aloha, wai, pua)",
    2: "common everyday words, 2-3 syllables",
    3: "less common nouns and simple verbs",
    4: "short phrases and idiomatic expressions",
    5: "full sentences and culturally specific terms",
  },
};

/** A worked example pins the exact JSON shape the model must produce. */
const FEW_SHOT = {
  id: "haw-match-greetings-001",
  schema_version: "1.0.0",
  language: "hawaiian",
  puzzle_type: "match",
  validator_type: "set_match",
  difficulty: 1,
  prompt: "Match each Hawaiian word to its English meaning.",
  payload: { pairs: [
    { left: "aloha", right: "love / hello" },
    { left: "mahalo", right: "thank you" },
    { left: "wai", right: "water" },
  ]},
  solution: { mapping: { aloha: "love / hello", mahalo: "thank you", wai: "water" } },
  hints: ["One of these is the most common Hawaiian greeting."],
  metadata: { concept: "common greetings", generator: "human", reviewed: true },
};

/**
 * Turns a plain request ("make beginner Hawaiian puzzles") into a CONSTRAINED
 * prompt. Returns { system, user } — feed to your LLM API with structured/JSON
 * output forced (tool-use or response_format). This file makes NO network call
 * and holds NO key: generation runs author-side, never in the game client.
 */
export function buildGenerationPrompt(req: GenerationRequest): { system: string; user: string } {
  const rubric = RUBRICS[req.language]?.[req.difficulty] ?? "(define a rubric for this language/difficulty)";

  const system = [
    "You generate puzzles for a language-learning game. You ONLY fill the provided",
    "schema. You may ONLY use puzzle types the engine supports; never invent a new",
    "puzzle_type or validator_type. Output a JSON ARRAY of puzzle objects and nothing",
    "else — no prose, no markdown fences.",
    "",
    "JSON Schema the output must conform to:",
    JSON.stringify(schema),
    "",
    "Allowed puzzle_type values: match, fill_blank, reorder, predict_output, fix_the_bug.",
    "For puzzle_type 'match', use validator_type 'set_match'.",
    "Every puzzle's solution must be solvable against its payload (every left has",
    "exactly one right that exists in the pairs).",
    "",
    "Example of one valid puzzle object:",
    JSON.stringify(FEW_SHOT),
  ].join("\n");

  const user = [
    `Generate ${req.count} puzzle(s).`,
    `language: ${req.language}`,
    `puzzle_type: ${req.puzzle_type}`,
    `difficulty: ${req.difficulty} — meaning: ${rubric}`,
    req.concept ? `concept/theme: ${req.concept}` : "",
    `Set metadata.reviewed to false (a human reviews before shipping).`,
  ].filter(Boolean).join("\n");

  return { system, user };
}
