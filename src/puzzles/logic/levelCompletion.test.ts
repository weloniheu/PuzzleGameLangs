// The completability stress test for the logic track — the counterpart to the vocab,
// grammar and coding suites.
//
// A rule board cannot be re-dealt safely: its word tiles ARE the rules, so permuting them
// can hand out a room that is impossible, and proving otherwise means planning over rules
// that rewrite themselves mid-solve — a search no test suite can afford. So `randomized`
// means something smaller here (see puzzles/logic/boardTransform.ts): the board is
// MIRRORED, whole, with any rule the flip reversed put back into reading order.
//
// That makes every variant provable without a solver, because a mirror maps the ROUTE as
// simply as it maps the board. For each transform a level declares, this asserts both
// halves of what the modifier promises:
//
//   • WINNABLE  — the authored route, mirrored the same way, still finishes the board;
//   • DIFFERENT — the authored route, UNCHANGED, no longer does.
import { describe, it, expect } from "vitest";
import enRoom from "../../../content/packs/logic.room.en.v1.json";
import hawRoom from "../../../content/packs/logic.room.haw.v1.json";
import enRules from "../../../content/packs/logic.rules.en.v1.json";
import hawRules from "../../../content/packs/logic.rules.haw.v1.json";
import { createBoard, step, DIRECTIONS, type Board } from "./ruleEngine";
import { transformBoard, transformRoute } from "./boardTransform";
import { AUTHORED_ROUTES, type MoveName } from "./authoredRoutes";
import type { LogicPack } from "./schema";
import type { BoardTransform, LogicRulesPayload, Pack, Puzzle } from "../../schema/types";

const TRACKS: [string, Pack, LogicPack][] = [
  ["logic.room.en.v1", enRoom as unknown as Pack, enRules as unknown as LogicPack],
  ["logic.room.haw.v1", hawRoom as unknown as Pack, hawRules as unknown as LogicPack],
];
const KINDS: BoardTransform[] = ["mirror-x", "mirror-y", "mirror-both"];

const boardIdOf = (pz: Puzzle) => (pz.payload as LogicRulesPayload).board_id;
const wins = (b: Board, moves: MoveName[]) => {
  for (const m of moves) if (step(b, DIRECTIONS[m]).status === "won") return true;
  return false;
};

describe.each(TRACKS)("%s — every randomized level is winnable AND different", (_name, room, rules) => {
  const randomized = room.puzzles.filter((p) => p.modifiers?.includes("randomized"));

  it("there are randomized levels to check", () => {
    expect(randomized.length).toBeGreaterThan(0);
  });

  it.each(randomized.map((p): [string, Puzzle] => [p.id, p]))("%s", (_id, pz) => {
    const def = rules.puzzles.find((b) => b.id === boardIdOf(pz))!;
    const route = AUTHORED_ROUTES[def.id];
    expect(route, `no authored route for board ${def.id}`).toBeTruthy();
    const fresh = (kind: BoardTransform) => {
      const b = createBoard(def, rules.vocab, rules.pattern);
      transformBoard(b, kind);
      return b;
    };

    // A level that claims `randomized` and rolls nothing would be a lie on the ladder:
    // its rung says Shuffled and the board would come up exactly as authored.
    const variants = pz.mechanics?.variants ?? [];
    expect(variants.length, `${pz.id} is randomized but declares no variants`).toBeGreaterThan(0);
    expect(variants.every((v) => KINDS.includes(v))).toBe(true);
    expect(new Set(variants).size).toBe(variants.length);

    for (const kind of variants) {
      expect(wins(fresh(kind), transformRoute(route, kind)), `${pz.id}/${kind} is not winnable`).toBe(true);
      expect(wins(fresh(kind), route), `${pz.id}/${kind} still falls to the ORIGINAL route`).toBe(false);
    }
  });
});

// The base levels are the control: they roll nothing, so the authored route wins as-is.
describe.each(TRACKS)("%s — a level WITHOUT the modifier is left exactly as authored", (_name, room, rules) => {
  const plain = room.puzzles.filter((p) => !p.modifiers?.includes("randomized"));

  it.each(plain.map((p): [string, Puzzle] => [p.id, p]))("%s", (_id, pz) => {
    const def = rules.puzzles.find((b) => b.id === boardIdOf(pz))!;
    expect(pz.mechanics?.variants).toBeUndefined();
    expect(wins(createBoard(def, rules.vocab, rules.pattern), AUTHORED_ROUTES[def.id])).toBe(true);
  });
});
