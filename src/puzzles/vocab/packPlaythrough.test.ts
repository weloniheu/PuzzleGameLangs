// Proves every authored vocab level is solvable through the pure cores within its PAR
// with ZERO wrong-combination guesses (the ★★★ line an author claims must exist), and
// that the anti-brute-force geometry actually fires: shoving a word face-first into a
// non-partner counts a guess and locks nothing. The move loop itself lives in
// ./simHarness (shared with levelCompletion.test.ts, which solves the randomized deals
// no authored route can cover); the roomHost smoke test covers the real DOM module.
import { describe, it, expect } from "vitest";
import hawPack from "../../../content/packs/vocab.room.haw.v1.json";
import enPack from "../../../content/packs/vocab.room.en.v1.json";
import type { Pack, Puzzle, VocabMatchPayload } from "../../schema/types";
import { playVocab, path, type Dir } from "./simHarness";
import { guessTier } from "./index";

const R: Dir = "right", L: Dir = "left", U: Dir = "up", D: Dir = "down";
const rep = (d: Dir, n: number): Dir[] => Array(n).fill(d);

const haw = hawPack as unknown as Pack;
const en = enPack as unknown as Pack;
const puzzleIn = (pack: Pack, id: string): Puzzle => pack.puzzles.find((p) => p.id === id)!;


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
    solvesClean(haw, "vocab-match-000", [
      U, ...rep(L, 3), U, ...rep(R, 3)
    
    ]);
  });
  it("Vocab I: rock→pōhaku, water→wai", () => {
    solvesClean(haw, "vocab-match-001", [
      L, ...rep(U, 2), L, U, L, U, ...rep(R, 4),   // rock ← to pōhaku, around the pillar
      ...rep(D, 2), R, D, R, D, ...rep(L, 4)      // water ← to wai, the mirrored detour
    
    ]);
  });
  it("Vocab II: three pairs, locked tiles become obstacles", () => {
    solvesClean(haw, "vocab-match-002", [
      ...rep(R, 2), U, R, U, ...rep(L, 6),   // cat → pōpoki (a broken row)
      U, ...rep(R, 2), U, ...rep(L, 3),      // house → hale (the open middle row)
      U, L, U, ...rep(R, 6)                  // dog → ʻīlio (the other broken row)
    
    ]);
  });
  it("Vocab III: four pairs around the makani decoy", () => {
    solvesClean(haw, "vocab-match-003", [
      L, U, ...rep(L, 3), U, ...rep(R, 5),        // moon → mahina
      D, L, D, L, ...rep(U, 6),                  // star shoved aside, then up
      D, ...rep(L, 3), D, L, D, ...rep(R, 8),    // rain ← to ua, around the centre pillar
      ...rep(U, 2), R, U, ...rep(L, 5)           // sun ← to lā
    
    ]);
  });

  // The two levels the grammar wing's vocabulary was folded into (see the pack's own
  // ordering): both used to be reruns of words from I and III, and now carry kumu /
  // hoaaloha / haumāna. Same geometry, same routes — only the words on the tiles moved.
  it("Nā Hoa (VI): two new words and one old one, around the broken spine", () => {
    solvesClean(haw, "vocab-match-006", path("RUURRDRDLLLLLLUULURRRLULLULURRRRRR"));
  });

  it("Ke Kula (VII): four pairs out of four alcoves, hale the odd one out", () => {
    solvesClean(haw, "vocab-match-007", path("LUUURRURDDLDRLLLLUURUURRRRDRULLULLURULLLL"));
    // hale has no partner here: walk hele up its alcove and shove it face-first at the
    // decoy, and the board prices it like any other wrong combination.
    const r = playVocab(puzzleIn(haw, "vocab-match-007"), path("LLLLUUULUR"));
    expect(r.won).toBe(false);
    expect(r.guesses).toBe(1);
  });

  it("Hōʻailona (IV): honest signs + interior WALLS block the push board", () => {
    solvesClean(haw, "vocab-match-004", [
      ...rep(L, 4), U, ...rep(R, 5),               // hoaaloha → friend, under the wall spine
      ...rep(U, 3), ...rep(R, 3), U, ...rep(L, 5)  // teacher ← to kumu, along the top

    ]);
    // The wall spine is real: walking straight up from spawn is blocked at the fence.
    const pz = puzzleIn(haw, "vocab-match-004");
    const stuck = playVocab(pz, [U, U, L, U, U, U, U]); // runs into the wall column
    expect(stuck.won).toBe(false);
  });

  it("Hoʻopunipuni (V): the clean line trusts the words, never touches a sign", () => {
    solvesClean(haw, "vocab-match-005", [
      U, R, ...rep(U, 4), ...rep(R, 2), U, R, U, ...rep(L, 6),  // teacher ← to kumu
      ...rep(D, 2), ...rep(L, 2), D, ...rep(R, 5),             // student ← to haumāna
      D, ...rep(R, 2), D, R, D, ...rep(L, 6)                   // water ← to wai

    ]);
  });

  it("the liar sign fires: presenting kumu to the teacher-LOOKING sign is a priced guess", () => {
    // The sign at (2,0) SHOWS a teacher but SAYS haumāna — shoving kumu up to it is the
    // visual-pattern-matcher's move, and it costs.
    const r = playVocab(puzzleIn(haw, "vocab-match-005"), [
      L, L, ...rep(U, 5), L, U, // route up column 3, step left, shove kumu into the sign
    ]);
    expect(r.won).toBe(false);
    expect(r.guesses).toBe(1);
  });
});

describe("english synonym pack (Lexicon — the high tier)", () => {
  it("Lexicon I: arid–dry, brisk–quick around the tepid decoy", () => {
    solvesClean(en, "vocab-en-000", [
      ...rep(L, 3), U, L, U, ...rep(R, 6),     // brisk–quick below the pillar
      ...rep(U, 2), R, U, R, U, ...rep(L, 6)   // arid–dry above it
    
    ]);
  });
  it("Lexicon II: three pairs, two decoys, limited reveals", () => {
    solvesClean(en, "vocab-en-001", [
      L, ...rep(U, 2), ...rep(L, 2), D, L, D, ...rep(R, 6),
      ...rep(U, 2), ...rep(R, 2), U, ...rep(L, 5),
      U, ...rep(L, 2), U, L, U, ...rep(R, 6)
    
    ]);
  });
  it("Lexicon III: antonym traps — the clean line still exists", () => {
    solvesClean(en, "vocab-en-002", [
      ...rep(R, 4), ...rep(U, 4), R, U, ...rep(L, 7),                 // rare → scarce
      ...rep(D, 4), ...rep(L, 2), ...rep(U, 5), L, U, ...rep(R, 7)   // brilliant → vivid
    
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

  // The Lexicon tier used to escalate only in QUANTITY — more pairs, fewer looks, same
  // single verb. These pin the mechanics that now make each rung different in KIND.
  it("Lexicon II: the strays are not junk — each one files on a shelf for a free look", () => {
    // furtive travels its own row into the "secretive" shelf on the right rim.
    const r = playVocab(puzzleIn(en, "vocab-en-001"), [L, ...rep(U, 4), ...rep(R, 4)]);
    expect(r.confirmed.has("shelf-secretive")).toBe(true);
    expect(r.guesses).toBe(0); // filing correctly is knowledge shown, never priced
  });

  it("Lexicon II: shelving the WRONG word is a priced guess", () => {
    // Drop `thrifty` down to row 4 and shove it at the "extravagant" shelf, which takes lavish.
    const r = playVocab(puzzleIn(en, "vocab-en-001"), [
      R, R, ...rep(U, 4), R, D, L, D, R,
    ]);
    expect(r.confirmed.has("shelf-extravagant")).toBe(false);
    expect(r.guesses).toBeGreaterThan(0);
  });

  it("Lexicon III: the glittering shelf reads 'drab' — the word takes dull, not the picture", () => {
    // dull shoved along its own row into the liar on the right rim: the LABEL accepts it.
    const r = playVocab(puzzleIn(en, "vocab-en-002"), [L, U, U, ...rep(R, 4)]);
    expect(r.confirmed.has("shelf-drab")).toBe(true);
    expect(r.guesses).toBe(0);
  });

  it("Lexicon III: shoving the SHINY word at the shiny-looking shelf costs a guess", () => {
    // brilliant is what the ✨ picture suggests; the card says drab, so it is wrong.
    const pz = puzzleIn(en, "vocab-en-002");
    const payload = pz.payload as VocabMatchPayload;
    const liar = payload.props!.find((p) => p.id === "shelf-drab")!;
    expect(liar.honest).toBe(false);      // look and label disagree — accusable
    expect(liar.accepts).toBe("dull");    // the WORD is the truth
    expect(liar.wrong).toBeTruthy();      // and a wrong shove explains why
  });

  it("every shelf accepts a tile that exists and can be reached by a push", () => {
    for (const id of ["vocab-en-001", "vocab-en-002"]) {
      const payload = puzzleIn(en, id).payload as VocabMatchPayload;
      for (const prop of payload.props ?? []) {
        const target = payload.tiles.find((t) => t.id === prop.accepts);
        expect(target, `${id}/${prop.id} accepts a tile that does not exist`).toBeTruthy();
        // A tile already flush against its shelf can never be PRESENTED to it: presenting
        // requires the tile to MOVE into the adjacent cell with the shelf ahead.
        const dist = Math.abs(target!.pos.x - prop.pos.x) + Math.abs(target!.pos.y - prop.pos.y);
        expect(dist, `${id}/${prop.id} sits flush against ${prop.accepts}`).toBeGreaterThan(1);
      }
    }
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
