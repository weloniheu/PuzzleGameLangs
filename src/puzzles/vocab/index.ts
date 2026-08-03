// ---------------------------------------------------------------------------
// The VOCAB module — implements RoomPuzzleModule for `vocab_match` rooms
// (registered by puzzle_type in puzzles/index.ts).
//
// Sokoban push-to-match, and the game IS the room: the tiles live on the engine
// grid, the player is the shared slime, and PUSHING IS THE LOGIC GAME'S —
// ruleEngine.tryMove is called with a HAND-BUILT RuleSet (player=you, tile=push,
// locked=stop), so vocab gets the exact same push/collision/train behavior with
// zero reimplementation. What counts as a MATCH comes from the pure matchEngine
// over the pack's `pairs` — the pack decides the semantics (word↔meaning,
// synonym↔synonym), this module never knows which.
//
// HELP key ("?"): stand beside any tile and press it to reveal the tile's
// meaning text (pack data) in a bubble above the tile. Free, keyboard-only,
// dismissed by pressing it again or by moving.
// ---------------------------------------------------------------------------

import type { Puzzle, VocabMatchPayload, VocabPropDef, VocabTileDef } from "../../schema/types";
import type { EngineContext, MountedPuzzle, RoomPuzzleModule } from "../../engine/puzzleModule";
import { floorOrigin } from "../../engine/core/room";
import { mulberry32, randomSeed, shufflePositions } from "../../engine/core/shuffle";
import type { PropertyId } from "../logic/schema";
import {
  tryMove,
  DIRECTIONS,
  type Board,
  type Entity,
  type RuleSet,
} from "../logic/ruleEngine";
import { starsFor } from "../logic/index";
import {
  adjacentPartner, bumpedWrongTile, isWon, propPresented,
  type PlacedTile, type VocabPair,
} from "./matchEngine";

// The synthetic rule set that drives the SHARED push core: the player moves (you),
// unmatched tiles push; locked tiles, interior walls and floor signs (props) stop.
const PUSH_RULES: RuleSet = {
  rules: [],
  properties: new Map<string, Set<PropertyId>>([
    ["player", new Set<PropertyId>(["you"])],
    ["tile", new Set<PropertyId>(["push"])],
    ["locked", new Set<PropertyId>(["stop"])],
    ["wall", new Set<PropertyId>(["stop"])],
    ["prop", new Set<PropertyId>(["stop"])],
  ]),
  transforms: [],
};

// Scoped style (Rule 5): only .vocab-* classes; the room keeps the shared warm look.
const ROOM_STYLE = `
.vocab-tile-layer, .vocab-help-layer { position: absolute; top: 0; left: 0; }
.vocab-cell { position: absolute; display: flex; align-items: center; justify-content: center; }
.vocab-tile { font-weight: 800; line-height: 1.1; text-align: center; max-width: 92%;
  border-radius: 8px; padding: 8% 9%; background: linear-gradient(#8fd0a0, #66ab79);
  color: #0d2413; border: 1px solid rgba(10, 40, 18, 0.45);
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35); }
.vocab-tile.matched { background: linear-gradient(#d8c987, #b8a95d); color: #33290c;
  box-shadow: inset 0 0 0 2px rgba(90, 75, 25, 0.5), 0 0 10px rgba(230, 205, 120, 0.55); }
.vocab-help { position: absolute; transform: translate(-50%, -110%); left: 50%; top: 0;
  white-space: nowrap; font-weight: 700; color: #fff6e6; background: rgba(24, 19, 11, 0.92);
  border: 1px solid rgba(255, 224, 138, 0.55); border-radius: 8px; padding: 4px 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45); pointer-events: none; z-index: 4; }
.vocab-banner { position: fixed; left: 50%; transform: translateX(-50%);
  top: 52px; z-index: 40; pointer-events: none;
  font-weight: 800; font-size: 17px; color: #ffe08a;
  background: rgba(24, 19, 11, 0.88); border: 1px solid rgba(255, 224, 138, 0.5);
  border-radius: 999px; padding: 8px 18px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
.vocab-banner[hidden] { display: none; }
.vocab-banner .vocab-stars { color: #ffcf4a; letter-spacing: 2px; }

/* Live readout: moves vs par, wrong combinations tried (never refunded — testing a
   guess is PRICED), and remaining reveal charges. The ECONOMY axis made visible. */
.vocab-hud-chip { position: fixed; top: 72px; right: 18px; z-index: 40;
  pointer-events: none; font-weight: 700; font-size: 13px; color: #f2e6cf;
  background: rgba(24, 19, 11, 0.82); border: 1px solid rgba(242, 230, 207, 0.3);
  border-radius: 999px; padding: 5px 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); }
.vocab-hud-chip .over-par, .vocab-hud-chip .guesses { color: #e0a58a; }

/* Floor SIGNS (props): a glyph over a written plaque. The WORD is the truth; the
   picture may lie. Confirmed signs glow; exposed liars get struck through. */
.vocab-prop { position: absolute; inset: 6%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4%;
  border-radius: 10px; background: rgba(90, 64, 32, 0.28);
  box-shadow: inset 0 0 0 2px rgba(90, 64, 32, 0.5); }
.vocab-prop-glyph { line-height: 1; filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.4)); }
/* The plaque must stay READABLE at any label length — reading the word IS the mechanic,
   and an ellipsised "secreti…" hides the very thing the player is asked to judge. Longer
   labels wrap and shrink instead of truncating. */
.vocab-prop-sign { font-weight: 800; line-height: 1.05; color: #fff6e6;
  background: #4a3016; border-radius: 4px; padding: 2px 4px; max-width: 100%;
  overflow-wrap: anywhere; hyphens: auto; text-align: center;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4); }
.vocab-prop.confirmed { box-shadow: inset 0 0 0 2px rgba(120, 184, 94, 0.9), 0 0 12px rgba(120, 184, 94, 0.6); }
.vocab-prop.exposed { opacity: 0.75; }
.vocab-prop.exposed .vocab-prop-sign { text-decoration: line-through; background: #7a3020; }
.vocab-prop.exposed .vocab-prop-glyph { filter: grayscale(1) drop-shadow(0 2px 2px rgba(0, 0, 0, 0.4)); }
`;

/** Guess tier for the star rating: 0 wrong combos ★★★, ≤2 ★★, more ★. Combined with
 *  the move par by MIN — sloppy guessing caps the rating even on a fast solve. */
export function guessTier(guesses: number): number {
  if (guesses === 0) return 3;
  if (guesses <= 2) return 2;
  return 1;
}

export const vocabModule: RoomPuzzleModule = {
  puzzleType: "vocab_match",

  mount(ctx: EngineContext, puzzle: Puzzle): MountedPuzzle {
    // Vocab CONTENT (engine hardcodes none): tiles, pairings, help + feedback text.
    const payload = puzzle.payload as VocabMatchPayload;
    const defs = new Map<string, VocabTileDef>(payload.tiles.map((t) => [t.id, t]));
    // `randomized` (Axis 3): permute the word-tiles' spawn cells within the authored
    // set — runtime seed, fresh each mount, so re-entering rearranges the board.
    // Signs/walls never move; reset() rebuilds from this same arrangement.
    const tiles: VocabTileDef[] = puzzle.modifiers?.includes("randomized")
      ? shufflePositions(payload.tiles, mulberry32(randomSeed()))
      : payload.tiles;
    const pairs: VocabPair[] = payload.pairs;
    const feedback = payload.feedback ?? {};
    const { x: ox, y: oy } = floorOrigin(ctx.room);

    const styleEl = document.createElement("style");
    styleEl.id = "vocab-room-style";
    styleEl.textContent = ROOM_STYLE;
    ctx.container.appendChild(styleEl);

    const tileLayer = document.createElement("div"); // the pushable tiles
    tileLayer.className = "vocab-tile-layer";
    ctx.addLayer(tileLayer, "over");
    const helpLayer = document.createElement("div"); // the "?" reveal bubble (above all)
    helpLayer.className = "vocab-help-layer";
    ctx.addLayer(helpLayer, "over");

    const banner = document.createElement("div");
    banner.className = "vocab-banner";
    banner.hidden = true;
    ctx.container.appendChild(banner);

    // --- the board: the SHARED push core's data model, over the room's floor ---
    // The board is the room's floor area (the ring is walls = the boundary).
    const board: Board = {
      width: ctx.room.width - ox * 2,
      height: ctx.room.height - oy * 2,
      entities: [],
      pattern: { slots: [], directions: [] }, // rule scanning is never used here
    };
    const props: VocabPropDef[] = payload.props ?? [];
    function buildEntities() {
      const spawn = ctx.room.spawn;
      board.entities = [
        { id: "player", noun: "player", x: spawn.x - ox, y: spawn.y - oy },
        ...tiles.map((t): Entity => ({ id: t.id, noun: "tile", x: t.pos.x, y: t.pos.y })),
        // Floor signs are solid scenery (STOP) — they never move or match.
        ...props.map((p): Entity => ({ id: `prop:${p.id}`, noun: "prop", x: p.pos.x, y: p.pos.y })),
      ];
      // INTERIOR WALLS: the room grid's inner '#' cells become stop entities, so level
      // geometry (drawn by the engine's tile layer) also blocks the push board.
      for (let y = 0; y < board.height; y++) {
        for (let x = 0; x < board.width; x++) {
          if (ctx.room.grid[y + oy][x + ox] === "wall") {
            board.entities.push({ id: `wall:${x},${y}`, noun: "wall", x, y });
          }
        }
      }
    }
    buildEntities();
    const player = () => board.entities.find((e) => e.id === "player")!;
    const isWordTile = (e: Entity) => e.noun === "tile" || e.noun === "locked";

    let matched = new Set<string>();
    const history: Array<{ entities: Entity[]; matched: Set<string>; moves: number }> = [];
    let moves = 0;
    // DISTINCT wrong combinations tested (face-first bumps into a non-partner).
    // Never refunded by undo/reset — the knowledge was bought; the price stands.
    const guesses = new Set<string>();
    const revealed = new Set<string>(); // tiles the HELP key has shown (charges spent)
    let won = false;
    let helpFor: string | null = null; // tile id whose meaning bubble is showing
    let disposed = false;

    const movesChip = document.createElement("div");
    movesChip.className = "vocab-hud-chip";
    ctx.container.appendChild(movesChip);

    function updateChip() {
      movesChip.innerHTML = "";
      if (payload.par) {
        const count = document.createElement("span");
        if (moves > payload.par) count.className = "over-par";
        count.textContent = `Moves ${moves}`;
        movesChip.append(count, ` · Par ${payload.par}`);
      } else {
        movesChip.append(`Moves ${moves}`);
      }
      if (guesses.size) {
        const g = document.createElement("span");
        g.className = "guesses";
        g.textContent = ` · ✗ ${guesses.size}`;
        movesChip.appendChild(g);
      }
      if (payload.reveal_charges !== undefined) {
        movesChip.append(` · ? ${Math.max(0, revealBudget() - revealed.size)}`);
      }
    }

    /** The matcher's view of the board — WORD tiles only (signs/walls are scenery). */
    const placedTiles = (): PlacedTile[] =>
      board.entities
        .filter(isWordTile)
        .map((e) => ({ id: e.id, x: e.x, y: e.y, matched: matched.has(e.id) }));

    // Sign state: confirmed (right word presented / honest sign accused) and exposed
    // (liar caught). Catching a liar GRANTS a reveal charge — knowledge pays for
    // knowledge; accusing an honest sign is a counted guess.
    const confirmedProps = new Set<string>();
    const exposedProps = new Set<string>();
    let bonusCharges = 0;
    const revealBudget = () =>
      payload.reveal_charges === undefined ? Infinity : payload.reveal_charges + bonusCharges;
    const propLites = () => props.map((p) => ({ id: p.id, accepts: p.accepts, x: p.pos.x, y: p.pos.y }));

    function draw() {
      if (disposed) return;
      const tile = ctx.tile();
      tileLayer.innerHTML = "";
      for (const e of board.entities) {
        // the slime IS the player; walls render via the engine tile layer; signs below
        if (!isWordTile(e)) continue;
        const box = document.createElement("div");
        box.className = "vocab-cell";
        box.style.width = `${tile}px`;
        box.style.height = `${tile}px`;
        box.style.transform = `translate(${(e.x + ox) * tile}px, ${(e.y + oy) * tile}px)`;
        const chip = document.createElement("div");
        chip.className = `vocab-tile${matched.has(e.id) ? " matched" : ""}`;
        chip.textContent = defs.get(e.id)?.text ?? e.id;
        chip.style.fontSize = `${Math.round(tile * 0.2)}px`;
        box.appendChild(chip);
        tileLayer.appendChild(box);
      }
      // Floor signs: glyph + written plaque, with confirmed/exposed state.
      for (const p of props) {
        const box = document.createElement("div");
        box.className = "vocab-cell";
        box.style.width = `${tile}px`;
        box.style.height = `${tile}px`;
        box.style.transform = `translate(${(p.pos.x + ox) * tile}px, ${(p.pos.y + oy) * tile}px)`;
        const el = document.createElement("div");
        el.className = `vocab-prop${confirmedProps.has(p.id) ? " confirmed" : ""}${exposedProps.has(p.id) ? " exposed" : ""}`;
        const glyph = document.createElement("span");
        glyph.className = "vocab-prop-glyph";
        glyph.textContent = p.glyph;
        glyph.style.fontSize = `${Math.round(tile * 0.4)}px`;
        const sign = document.createElement("span");
        sign.className = "vocab-prop-sign";
        sign.textContent = p.label;
        // Scale the plaque down for longer words so the whole label still fits the cell —
        // an English shelf reads "extravagant" where a Hawaiian one reads "ua".
        const fit = p.label.length > 6 ? Math.max(0.1, 0.17 - (p.label.length - 6) * 0.012) : 0.17;
        sign.style.fontSize = `${Math.max(8, Math.round(tile * fit))}px`;
        el.append(glyph, sign);
        box.appendChild(el);
        tileLayer.appendChild(box);
      }
      // The help bubble sits above its tile, in a layer of its own.
      helpLayer.innerHTML = "";
      if (helpFor !== null) {
        const e = board.entities.find((t) => t.id === helpFor);
        const text = defs.get(helpFor)?.help;
        if (e && text) {
          const anchor = document.createElement("div");
          anchor.className = "vocab-cell";
          anchor.style.width = `${tile}px`;
          anchor.style.height = `${tile}px`;
          anchor.style.transform = `translate(${(e.x + ox) * tile}px, ${(e.y + oy) * tile}px)`;
          const bubble = document.createElement("div");
          bubble.className = "vocab-help";
          bubble.textContent = text;
          bubble.style.fontSize = `${Math.round(tile * 0.22)}px`;
          anchor.appendChild(bubble);
          helpLayer.appendChild(anchor);
        }
      }
      const p = player();
      ctx.movePlayer({ x: p.x + ox, y: p.y + oy }); // pin the slime (camera follows)
    }

    function finish() {
      won = true;
      const solvedText = feedback.solved ?? "✦ All pairs matched! ✦";
      // Rate the solve when the level carries a par: the rating is the LOWER of the
      // move tier and the guess tier — a fast solve built on wrong-combo testing
      // still caps out. Any solve clears the level; stars only price the style.
      if (payload.par) {
        const stars = Math.min(starsFor(moves, payload.par), guessTier(guesses.size));
        banner.innerHTML = "";
        const starsEl = document.createElement("span");
        starsEl.className = "vocab-stars";
        starsEl.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
        banner.append(starsEl, ` ${solvedText}`);
        try {
          const key = `vocab.stars.${puzzle.id}`;
          const prev = Number(localStorage.getItem(key) ?? 0);
          if (stars > prev) localStorage.setItem(key, String(stars));
        } catch { /* storage unavailable — the rating is a reward, not progress */ }
      } else {
        banner.textContent = solvedText;
      }
      banner.hidden = false;
      ctx.onSolved(); // earns this room's unlock — the next level appears in the exit menu
    }

    function move(dir: { dx: number; dy: number }) {
      history.push({
        entities: board.entities.map((e) => ({ ...e })),
        matched: new Set(matched),
        moves,
      });
      const before = new Map(board.entities.map((e) => [e.id, `${e.x},${e.y}`]));
      if (!tryMove(board, player(), dir, PUSH_RULES)) {
        history.pop(); // fully blocked — nothing to undo
        return;
      }
      moves++;
      helpFor = null; // moving dismisses the reveal
      // GUIDED TUTORIAL: report what ACTUALLY happened — a step, and any tile shoved.
      ctx.dialogue.notify("move");
      if (board.entities.some((e) => e.id !== "player" && before.get(e.id) !== `${e.x},${e.y}`)) {
        ctx.dialogue.notify("push");
      }
      const movedIds = new Set(
        board.entities.filter((e) => before.get(e.id) !== `${e.x},${e.y}`).map((e) => e.id),
      );
      // Any tile that moved may now sit beside its partner → LOCK the pair.
      for (const e of board.entities) {
        if (e.id === "player" || !movedIds.has(e.id)) continue;
        const partner = adjacentPartner(placedTiles(), e.id, pairs);
        if (partner) {
          matched.add(e.id).add(partner);
          for (const t of board.entities) {
            if (t.id === e.id || t.id === partner) t.noun = "locked"; // STOP for the push core
          }
        }
      }
      // ANTI-BRUTE-FORCE: a tile shoved face-first against a STATIONARY non-partner is
      // a tested combination. Each DISTINCT wrong combo is priced once (see guessTier);
      // train members moving together never count.
      for (const e of board.entities) {
        if (!isWordTile(e) || !movedIds.has(e.id) || matched.has(e.id)) continue;
        const bumped = bumpedWrongTile(placedTiles(), e.id, dir, pairs);
        if (bumped && !movedIds.has(bumped)) {
          const combo = [e.id, bumped].sort().join("|");
          if (!guesses.has(combo)) {
            guesses.add(combo);
            const text = feedback.mismatch;
            if (text) ctx.dialogue.play([{ id: `vocab-miss-${combo}`, speaker: "narrator", text, trigger: "help" }]);
          }
        }
        // PRESENTING to a SIGN: shoving a word face-first against a floor sign asks
        // "does this word belong here?". The sign's WORD is the truth — the accepted
        // tile confirms (free meaning reveal, sign glows); anything else is a priced
        // guess with the sign's corrective line (the picture may have lied).
        const sign = propPresented(propLites(), placedTiles().find((t) => t.id === e.id), dir);
        if (sign) {
          const def = props.find((p) => p.id === sign.id)!;
          if (sign.accepts === e.id) {
            confirmedProps.add(sign.id);
            // Meaning confirmed — a FREE reveal: mark it seen and refund the budget.
            if (!revealed.has(e.id)) { revealed.add(e.id); bonusCharges++; }
            helpFor = e.id;
          } else {
            const combo = `prop:${sign.id}|${e.id}`;
            if (!guesses.has(combo)) {
              guesses.add(combo);
              const text = def.wrong ?? feedback.mismatch;
              if (text) ctx.dialogue.play([{ id: `vocab-sign-${combo}`, speaker: "narrator", text, trigger: "help" }]);
            }
          }
        }
      }
      draw();
      updateChip();
      if (isWon(placedTiles(), pairs)) finish();
    }

    function undo() {
      if (won || !history.length) return;
      const prev = history.pop()!;
      board.entities = prev.entities;
      matched = prev.matched;
      moves = prev.moves; // undo REFUNDS moves — experimenting with ROUTES is free…
      helpFor = null;     // …but `guesses` stays: tested combinations were bought.
      draw();
      updateChip();
    }
    function reset() {
      buildEntities();
      matched = new Set();
      history.length = 0;
      moves = 0;
      won = false;
      helpFor = null;
      banner.hidden = true;
      draw();
      updateChip();
    }

    /** HELP: reveal the meaning of a tile ORTHOGONALLY beside the player. With
     *  `reveal_charges` set, only that many DISTINCT tiles may be revealed per level
     *  (re-viewing an already-revealed tile stays free); unlimited when unset.
     *  Toggles off on a second press or on movement. */
    function help() {
      if (helpFor !== null) { helpFor = null; draw(); return; } // dismiss
      const p = player();
      const beside = board.entities.find(
        (e) => isWordTile(e) && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1,
      );
      if (!beside) {
        const text = feedback.help_none;
        if (text) ctx.dialogue.play([{ id: "vocab-help-none", speaker: "narrator", text, trigger: "help" }]);
        return;
      }
      if (!revealed.has(beside.id) && revealed.size >= revealBudget()) {
        const text = feedback.reveal_spent;
        if (text) ctx.dialogue.play([{ id: "vocab-reveal-spent", speaker: "narrator", text, trigger: "help" }]);
        return;
      }
      revealed.add(beside.id);
      helpFor = beside.id;
      draw();
      updateChip();
    }

    /** ACCUSE (Enter beside a sign): put the sign itself on trial. A liar is exposed —
     *  corrective line + ONE bonus reveal charge (knowledge pays for knowledge). An
     *  honest sign is confirmed, but the slander is a counted guess. */
    function accuse(cell: { x: number; y: number }): boolean {
      const bx = cell.x - ox;
      const by = cell.y - oy;
      const sign = props.find(
        (p) => Math.abs(p.pos.x - bx) + Math.abs(p.pos.y - by) === 1,
      );
      if (!sign || won) return false;
      if (exposedProps.has(sign.id) || confirmedProps.has(sign.id)) return true; // verdict already known
      if (sign.honest) {
        confirmedProps.add(sign.id);
        const combo = `accuse|${sign.id}`;
        guesses.add(combo);
        const text = feedback.false_accuse;
        if (text) ctx.dialogue.play([{ id: `vocab-${combo}`, speaker: "narrator", text, trigger: "help" }]);
      } else {
        exposedProps.add(sign.id);
        bonusCharges++;
        const text = sign.exposed;
        if (text) ctx.dialogue.play([{ id: `vocab-exposed-${sign.id}`, speaker: "narrator", text, trigger: "help" }]);
      }
      draw();
      updateChip();
      return true;
    }

    draw();
    updateChip();

    return {
      // Enter beside a floor sign = ACCUSE it; otherwise Enter falls through to the
      // engine (the menu portal at spawn is the exit). Content keeps signs away from
      // the spawn cell so the exit is never shadowed.
      onInteract: (pos) => accuse(pos),
      onAction(actionId) {
        const dir = DIRECTIONS[actionId]; // up / down / left / right — same ids as the bindings
        if (dir) {
          if (won) return false; // a finished board releases movement (walk to the portal)
          move(dir);
          return true;
        }
        if (actionId === "undo") { undo(); return true; }
        if (actionId === "reset") { reset(); return true; }
        if (actionId === "help") { help(); return true; }
        return false;
      },
      relayout: () => draw(),
      teardown: () => {
        disposed = true; // DOM (layers, banner, style) dies with the room's container wipe
      },
      panel: null,
    };
  },
};
