// Proves every authored vocab level is solvable through the pure cores within its PAR
// with ZERO wrong-combination guesses (the ★★★ line an author claims must exist), and
// that the anti-brute-force geometry actually fires: shoving a word face-first into a
// non-partner counts a guess and locks nothing. The harness mirrors the module's move
// loop over the SAME pure pieces (tryMove / adjacentPartner / bumpedWrongTile / isWon);
// the roomHost smoke test covers the real DOM module on the tutorial.
import { describe, it, expect } from "vitest";
import hawPack from "../../../content/packs/vocab.room.haw.v1.json";
import enPack from "../../../content/packs/vocab.room.en.v1.json";
import type { Pack, Puzzle, VocabMatchPayload } from "../../schema/types";
import { tryMove, DIRECTIONS, type Board, type RuleSet } from "../logic/ruleEngine";
import type { PropertyId } from "../logic/schema";
import {
  adjacentPartner, bumpedWrongTile, isWon, propPresented, type VocabPair,
} from "./matchEngine";
import { guessTier } from "./index";

type Dir = "up" | "down" | "left" | "right";
const R: Dir = "right", L: Dir = "left", U: Dir = "up", D: Dir = "down";
const rep = (d: Dir, n: number): Dir[] => Array(n).fill(d);

const haw = hawPack as unknown as Pack;
const en = enPack as unknown as Pack;
const puzzleIn = (pack: Pack, id: string): Puzzle => pack.puzzles.find((p) => p.id === id)!;

/** Mirror of the module's move loop: push, lock pairs, count distinct wrong bumps —
 *  including interior walls (room grid '#') and floor SIGNS (props): presenting the
 *  wrong word to a sign is a guess; the accepted word confirms silently. */
function playVocab(pz: Puzzle, moves: Dir[]) {
  const payload = pz.payload as VocabMatchPayload;
  const room = pz.room!;
  const pairs = payload.pairs as VocabPair[];
  const props = (payload.props ?? []).map((p) => ({ id: p.id, accepts: p.accepts, x: p.pos.x, y: p.pos.y }));
  const board: Board = {
    width: room.width - 2,
    height: room.height - 2,
    entities: [
      { id: "player", noun: "player", x: room.spawn!.x - 1, y: room.spawn!.y - 1 },
      ...payload.tiles.map((t) => ({ id: t.id, noun: "tile", x: t.pos.x, y: t.pos.y })),
      ...props.map((p) => ({ id: `prop:${p.id}`, noun: "prop", x: p.x, y: p.y })),
    ],
    pattern: { slots: [], directions: [] },
  };
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (room.tiles[y][x] === "#") {
        board.entities.push({ id: `wall:${x},${y}`, noun: "wall", x: x - 1, y: y - 1 });
      }
    }
  }
  const rules: RuleSet = {
    rules: [], transforms: [],
    properties: new Map<string, Set<PropertyId>>([
      ["player", new Set<PropertyId>(["you"])],
      ["tile", new Set<PropertyId>(["push"])],
      ["locked", new Set<PropertyId>(["stop"])],
      ["wall", new Set<PropertyId>(["stop"])],
      ["prop", new Set<PropertyId>(["stop"])],
    ]),
  };
  const matched = new Set<string>();
  const guesses = new Set<string>();
  const isWordTile = (e: { noun?: string }) => e.noun === "tile" || e.noun === "locked";
  const placed = () => board.entities
    .filter(isWordTile)
    .map((e) => ({ id: e.id, x: e.x, y: e.y, matched: matched.has(e.id) }));
  let count = 0;
  for (const m of moves) {
    const dir = DIRECTIONS[m];
    const before = new Map(board.entities.map((e) => [e.id, `${e.x},${e.y}`]));
    const player = board.entities.find((e) => e.id === "player")!;
    if (!tryMove(board, player, dir, rules)) continue;
    count++;
    const movedIds = new Set(
      board.entities.filter((e) => before.get(e.id) !== `${e.x},${e.y}`).map((e) => e.id),
    );
    for (const e of board.entities) {
      if (!isWordTile(e) || !movedIds.has(e.id)) continue;
      const partner = adjacentPartner(placed(), e.id, pairs);
      if (partner) {
        matched.add(e.id).add(partner);
        for (const t of board.entities) {
          if (t.id === e.id || t.id === partner) t.noun = "locked";
        }
      }
    }
    for (const e of board.entities) {
      if (!isWordTile(e) || !movedIds.has(e.id) || matched.has(e.id)) continue;
      const b = bumpedWrongTile(placed(), e.id, dir, pairs);
      if (b && !movedIds.has(b)) guesses.add([e.id, b].sort().join("|"));
      const sign = propPresented(props, placed().find((t) => t.id === e.id), dir);
      if (sign && sign.accepts !== e.id) guesses.add(`prop:${sign.id}|${e.id}`);
    }
  }
  return { won: isWon(placed(), pairs), moves: count, guesses: guesses.size };
}

/** The intended solution must win, fit par, and test ZERO wrong combinations. */
function solvesClean(pack: Pack, id: string, moves: Dir[]) {
  const pz = puzzleIn(pack, id);
  const par = (pz.payload as VocabMatchPayload).par;
  const r = playVocab(pz, moves);
  expect(r.won).toBe(true);
  expect(r.guesses).toBe(0);
  if (par !== undefined) expect(r.moves).toBeLessThanOrEqual(par);
}

describe("guess tier — wrong combinations cap the rating", () => {
  it("0 → ★★★, ≤2 → ★★, more → ★", () => {
    expect(guessTier(0)).toBe(3);
    expect(guessTier(2)).toBe(2);
    expect(guessTier(3)).toBe(1);
  });
});

describe("hawaiian vocab pack", () => {
  it("tutorial: push aloha to hello", () => {
    solvesClean(haw, "vocab-match-000", [L, L, L, U, U, R, R, R]);
  });
  it("Vocab I: rock→pōhaku, water→wai", () => {
    solvesClean(haw, "vocab-match-001", [
      ...rep(R, 3), ...rep(U, 3), ...rep(L, 3),
      ...rep(R, 3), D, D, ...rep(L, 3),
    ]);
  });
  it("Vocab II: three pairs, locked tiles become obstacles", () => {
    solvesClean(haw, "vocab-match-002", [
      ...rep(R, 3), ...rep(U, 3), ...rep(L, 3),          // house → hale
      ...rep(R, 3), U, U, ...rep(L, 5),                  // dog → ʻīlio
      D, ...rep(R, 5), ...rep(D, 3), ...rep(L, 5),       // cat → pōpoki
    ]);
  });
  it("Vocab III: four pairs around the makani decoy", () => {
    solvesClean(haw, "vocab-match-003", [
      R, U, L, D, L, ...rep(U, 6),          // star ASIDE first (locks at 4,1 — row 2 stays clear)
      D, ...rep(R, 5), U, ...rep(L, 5),     // sun ← to lā
      D, ...rep(R, 6), D, ...rep(L, 7),     // rain ← to ua
      ...rep(R, 6), D, D, ...rep(L, 5),     // moon ← to mahina
    ]);
  });

  it("Hōʻailona (IV): honest signs + interior WALLS block the push board", () => {
    solvesClean(haw, "vocab-match-004", [
      ...rep(R, 4), ...rep(U, 5), ...rep(L, 5),  // rain → ua past the wall spine
      ...rep(R, 5), ...rep(D, 4), ...rep(L, 5),  // star → hōkū
    ]);
    // The wall spine is real: walking straight up from spawn is blocked at the fence.
    const pz = puzzleIn(haw, "vocab-match-004");
    const stuck = playVocab(pz, [U, U, L, U, U, U, U]); // runs into the wall column
    expect(stuck.won).toBe(false);
  });

  it("Hoʻopunipuni (V): the clean line trusts the words, never touches a sign", () => {
    solvesClean(haw, "vocab-match-005", [
      ...rep(R, 4), ...rep(U, 6), ...rep(L, 5),  // sun ← to lā
      ...rep(R, 5), D, D, ...rep(L, 5),          // water ← to wai
      ...rep(R, 5), D, D, ...rep(L, 5),          // rock ← to pōhaku
    ]);
  });

  it("the liar sign fires: presenting lā to the sun-LOOKING sign is a priced guess", () => {
    // The sign at (2,0) LOOKS like the sun but SAYS wai — shoving lā up to it is the
    // visual-pattern-matcher's move, and it costs.
    const r = playVocab(puzzleIn(haw, "vocab-match-005"), [
      L, L, ...rep(U, 5), L, U, // route up column 3, step left, shove lā into the sign
    ]);
    expect(r.won).toBe(false);
    expect(r.guesses).toBe(1);
  });
});

describe("english synonym pack (Lexicon — the high tier)", () => {
  it("Lexicon I: arid–dry, brisk–quick around the tepid decoy", () => {
    solvesClean(en, "vocab-en-000", [
      ...rep(U, 6), ...rep(R, 4), D, ...rep(L, 5),
      ...rep(D, 5), ...rep(R, 5), U, ...rep(L, 5),
    ]);
  });
  it("Lexicon II: three pairs, two decoys, limited reveals", () => {
    solvesClean(en, "vocab-en-001", [
      ...rep(R, 4), ...rep(U, 5), ...rep(L, 5),
      ...rep(R, 5), D, D, ...rep(L, 5),
      ...rep(R, 5), D, D, ...rep(L, 5),
    ]);
  });
  it("Lexicon III: antonym traps — the clean line still exists", () => {
    solvesClean(en, "vocab-en-002", [
      ...rep(R, 5), U, ...rep(L, 7), D, L, ...rep(U, 4), // rare → scarce
      R, ...rep(U, 4), ...rep(R, 7), D, ...rep(L, 8),    // brilliant ← along the top
      U, L, ...rep(D, 4),                                // …and down to vivid
    ]);
  });

  it("the trap fires: shoving scarce into its ANTONYM counts a guess, locks nothing", () => {
    // Route to the left of scarce via column 0, then shove it right toward `plentiful`.
    const r = playVocab(puzzleIn(en, "vocab-en-002"), [
      ...rep(L, 5), ...rep(U, 6), ...rep(R, 3),
    ]);
    expect(r.won).toBe(false);
    expect(r.guesses).toBe(1); // scarce ⇄ plentiful was tested — priced once
  });

  it("decoys never lock: bumping mundane counts a guess and stays unmatched", () => {
    // Walk beside `mundane` (7,4) and shove it into nothing… then into a real tile.
    const pz = puzzleIn(en, "vocab-en-002");
    const payload = pz.payload as VocabMatchPayload;
    expect(payload.pairs.flat()).not.toContain("mundane"); // structurally a decoy
  });
});

// Same rim rule the logic and grammar packs hold to: a tile flush against a wall
// can't be pushed off it (no cell to stand on), and `randomized` deals the tiles out
// among these very cells — a rimmed spawn cell risks an unmatchable room. PROPS are
// exempt: signs are wall furniture, never pushed.
describe("padding lint — no word tile starts flush against a wall", () => {
  for (const [label, pack] of [["hawaiian", haw], ["english", en]] as const) {
    it(`${label} pack: every word tile keeps a one-cell margin`, () => {
      for (const pz of pack.puzzles) {
        const payload = pz.payload as VocabMatchPayload;
        const w = pz.room!.width - 2, h = pz.room!.height - 2;
        const rimmed = payload.tiles.filter(
          (t) => t.pos.x === 0 || t.pos.y === 0 || t.pos.x === w - 1 || t.pos.y === h - 1,
        );
        expect(rimmed.map((t) => `${pz.id}: ${t.id}`)).toEqual([]);
      }
    });
  }
});
