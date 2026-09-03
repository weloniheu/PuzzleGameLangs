// ---------------------------------------------------------------------------
// The authored ★★★ ROUTE for every shipped rule board. Test support only (nothing in
// the game imports it), shared by the two suites that need it:
//
//   • packPlaythrough.test.ts — proves each route wins within the board's par;
//   • levelCompletion.test.ts — replays each route MIRRORED through every transform a
//     level declares, which is what proves those `randomized` variants finishable.
//
// One home for the routes, so a board whose layout changes can only ever break in one
// place. The prose explaining each line stays with the suite that asserts it.
// ---------------------------------------------------------------------------

export type MoveName = "up" | "down" | "left" | "right";

const R: MoveName = "right", L: MoveName = "left", U: MoveName = "up", D: MoveName = "down";
const rep = (d: MoveName, n: number): MoveName[] => Array(n).fill(d);

/** board id → the route the pack claims solves it inside par. */
export const AUTHORED_ROUTES: Record<string, MoveName[]> = {
  "en-00-tutorial": rep(R, 4),
  "en-01-welcome": [R, R, R, R, D, D, R, R],
  "en-02-push": [D, D, R, R, R, R, U, U, R, R, R],
  "en-03-break-wall": [U, R, U, D, ...rep(R, 6), D],
  "en-04-make-win": [R, U, U, U, U, L, U, ...rep(R, 5), D, R, U, D, D, D, D],
  "en-05-become": [D, ...rep(R, 6), U, L, L, L, D, L, U, U, R, R, R, U, U],
  "en-06-through": [
    R, D, D,                   // shove STOP off its rule — the wall is just a wall now
    U, U, U, L, L, U,          // get behind the WIN word
    ...rep(R, 7),              // escort it through the breach to the far column
    D, R, U, U,                // push it up into FLAG IS ___
    D, D, D, L,                // the flag is WIN — go touch it
  ],
  "en-07-which-rule": [
    D, R, U, R, D, D,          // steer ROCK next to the waiting IS
    R, R, R, D, D, D, R, R, R, U, // loop around to the WIN word
    L, L, L,                   // push WIN into line: ROCK IS WIN
    D, L, U,                   // nudge it up into the rule row
    R,                         // the rock is WIN — touch it
  ],
  "en-08-two-locks": [
    U, U, R, U,                // break ROCK IS STOP — the plug is passable
    D, D, D, D, R, R, R,       // cross through the gap
    U, U, U, U, R, R, R,       // get above the WIN word
    D, D, D, D, D,             // drive it down into FLAG IS ___
    U, U, U, L,                // the flag is WIN — go claim it
  ],
  "haw-00-e-hele": rep(R, 4),
  "haw-01-ke-ala": [D, D, R, R, R, R, U, U, R, R, R],
  "haw-02-wawahi": [U, R, U, D, ...rep(R, 6), D],
  "haw-03-lanakila": [
    R, U, U, U, U,             // push LANAKILA up the column
    L, U,                      // get behind it
    R, R, R,                   // escort it along the top corridor
    D, R, U,                   // nudge it up into the rule's FIRST slot
    D, D, D, D, R, R,          // the flag wins now — go touch it
  ],
};
