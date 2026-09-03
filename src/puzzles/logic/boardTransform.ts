// ---------------------------------------------------------------------------
// BOARD TRANSFORMS — the `randomized` modifier's reading for the rule boards.
// PURE, DOM-free, tested.
//
// A Baba board cannot be re-dealt the way a vocab board can: its word tiles are not
// interchangeable furniture, they are the RULES, and permuting them can hand the player
// a room that cannot be finished (see content/packs/README.md). What a rule board wants
// is a smaller kind of different — the same puzzle, flipped, so nothing about it is
// unsolvable and nothing about the route the player memorized still works.
//
// So a transform MIRRORS the whole board — player, objects, walls, words, all of it —
// and then repairs the one thing a mirror breaks: a rule reads along an axis, so
// flipping that axis reverses it ("WALL IS STOP" → "STOP IS WALL"). Swapping the two
// outer words of each reversed rule puts it back, leaving the board's rules exactly as
// authored while every position in the room has moved.
//
// A mirror maps ROUTES as simply as it maps cells (left↔right, up↔down — see
// transformRoute), which is what makes a variant PROVABLE: replay the authored route
// mirrored the same way and the mirrored board has to win. Whether a given board
// survives a given mirror is a fact about that board, so it is declared per level
// (MechanicsConfig.variants) and proven per level, never assumed here.
// ---------------------------------------------------------------------------

import type { BoardTransform } from "../../schema/types";
import { activeRuleCells, type Board } from "./ruleEngine";

/** Does this transform flip the x axis / the y axis? */
export const flipsX = (kind: BoardTransform) => kind === "mirror-x" || kind === "mirror-both";
export const flipsY = (kind: BoardTransform) => kind === "mirror-y" || kind === "mirror-both";

/** The four movement names, as the boards' callers spell them. */
export type MoveName = "up" | "down" | "left" | "right";

/** A route through the mirrored board: the same walk, reflected. */
export function transformRoute(moves: readonly MoveName[], kind: BoardTransform): MoveName[] {
  const swapX: Record<MoveName, MoveName> = { left: "right", right: "left", up: "up", down: "down" };
  const swapY: Record<MoveName, MoveName> = { up: "down", down: "up", left: "left", right: "right" };
  return moves.map((m) => {
    let out = m;
    if (flipsX(kind)) out = swapX[out];
    if (flipsY(kind)) out = swapY[out];
    return out;
  });
}

/** The runs of three cells that the ACTIVE rules occupy, in reading order (left→right for
 *  a horizontal rule, top→bottom for a vertical one). Read off the live board, so a rule
 *  the player has broken simply isn't here. */
export function ruleRuns(board: Board): { cells: { x: number; y: number }[]; horizontal: boolean }[] {
  const live = activeRuleCells(board);
  const has = (x: number, y: number) => live.has(`${x},${y}`);
  const runs: { cells: { x: number; y: number }[]; horizontal: boolean }[] = [];
  // A run STARTS where a rule cell has no rule cell before it on that axis, so a rule is
  // grouped once, from its head, whichever direction it reads in.
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (!has(x, y) || has(x - 1, y) || !has(x + 1, y) || !has(x + 2, y)) continue;
      runs.push({ cells: [0, 1, 2].map((i) => ({ x: x + i, y })), horizontal: true });
    }
  }
  for (let x = 0; x < board.width; x++) {
    for (let y = 0; y < board.height; y++) {
      if (!has(x, y) || has(x, y - 1) || !has(x, y + 1) || !has(x, y + 2)) continue;
      runs.push({ cells: [0, 1, 2].map((i) => ({ x, y: y + i })), horizontal: false });
    }
  }
  return runs;
}

/**
 * Mirror `board` in place, then restore the reading order of every rule the mirror
 * reversed. The board's rules come out identical to the authored ones; everything else
 * has moved.
 */
export function transformBoard(board: Board, kind: BoardTransform): void {
  const runs = ruleRuns(board); // read BEFORE anything moves
  const mx = flipsX(kind);
  const my = flipsY(kind);
  const mapX = (x: number) => (mx ? board.width - 1 - x : x);
  const mapY = (y: number) => (my ? board.height - 1 - y : y);
  for (const e of board.entities) {
    e.x = mapX(e.x);
    e.y = mapY(e.y);
  }
  for (const run of runs) {
    // A horizontal rule only reverses when x flips; a vertical one only when y does.
    if (run.horizontal ? !mx : !my) continue;
    const head = { x: mapX(run.cells[0].x), y: mapY(run.cells[0].y) };
    const tail = { x: mapX(run.cells[2].x), y: mapY(run.cells[2].y) };
    const first = board.entities.find((e) => e.word && e.x === head.x && e.y === head.y);
    const last = board.entities.find((e) => e.word && e.x === tail.x && e.y === tail.y);
    if (!first || !last) continue; // nothing to swap — the rule wasn't two words and a link
    [first.x, last.x] = [last.x, first.x];
    [first.y, last.y] = [last.y, first.y];
  }
}
