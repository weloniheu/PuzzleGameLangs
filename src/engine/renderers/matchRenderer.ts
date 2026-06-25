import type { PuzzleRenderer, Puzzle, MatchPayload } from "../../schema/types";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Block {
  word: string;       // a `right` value — the meaning the player pushes around
  x: number;
  y: number;
  el: HTMLElement;
  startX: number;
  startY: number;
}
interface Slot {
  label: string;      // a `left` value — the target word, drawn on the floor
  x: number;
  y: number;
  el: HTMLElement;
}

const CELLW = 96;
const CELLH = 88;

/**
 * Renders a `match` puzzle as a top-down, Sokoban-style pushing game.
 *
 * The `right` values become word blocks scattered on a grid; the `left` values
 * become labelled target slots. The player (🐢) walks with arrow keys / WASD (or
 * the on-screen D-pad) and pushes each meaning block onto the word it matches —
 * classic one-tile collision: walk into a block and it slides one cell if the
 * cell beyond is clear.
 *
 * The contract with the engine is UNCHANGED from the click version: when every
 * slot is occupied it reports the resulting left->right mapping via onSubmit,
 * and `set_match` decides correctness. This renderer still knows nothing about
 * Hawaiian, Spanish, or C++ — only the `match` payload shape.
 */
export const matchRenderer: PuzzleRenderer = {
  render(container, puzzle: Puzzle, onSubmit) {
    const payload = puzzle.payload as MatchPayload;
    const lefts = payload.pairs.map((p) => p.left);
    const rights = payload.pairs.map((p) => p.right);
    const correctOf: Record<string, string> = {};
    payload.pairs.forEach((p) => (correctOf[p.left] = p.right));

    const N = payload.pairs.length;
    const cols = 2 * N + 1;       // slots on odd columns, gaps between them
    const rows = 6;
    const slotCols = lefts.map((_, i) => 1 + i * 2);

    container.innerHTML = "";

    const caption = document.createElement("p");
    caption.className = "arena-caption";
    caption.textContent = "Push each meaning onto the word it matches.";
    container.appendChild(caption);

    const wrap = document.createElement("div");
    wrap.className = "arena-wrap";

    const arena = document.createElement("div");
    arena.className = "arena";
    arena.tabIndex = 0;
    arena.style.width = `${cols * CELLW}px`;
    arena.style.height = `${rows * CELLH}px`;
    arena.style.backgroundSize = `${CELLW}px ${CELLH}px`;
    wrap.appendChild(arena);
    container.appendChild(wrap);

    // --- build slots (the `left` targets, fixed on the floor) ---
    const slots: Slot[] = lefts.map((label, i) => {
      const el = document.createElement("div");
      el.className = "cell slot";
      el.style.width = `${CELLW}px`;
      el.style.height = `${CELLH}px`;
      el.textContent = label;
      const x = slotCols[i];
      const y = 0;
      el.style.transform = `translate(${x * CELLW}px, ${y * CELLH}px)`;
      arena.appendChild(el);
      return { label, x, y, el };
    });

    // --- build blocks (the shuffled `right` meanings) ---
    const shuffledRights = shuffle(rights);
    const blocks: Block[] = shuffledRights.map((word, i) => {
      const el = document.createElement("div");
      el.className = "cell block";
      el.style.width = `${CELLW}px`;
      el.style.height = `${CELLH}px`;
      el.textContent = word;
      const x = slotCols[i];   // start in a slot column, two rows below it
      const y = 2;
      arena.appendChild(el);
      return { word, x, y, el, startX: x, startY: y };
    });

    // --- the player ---
    const player = { x: Math.floor(cols / 2), y: rows - 1, startX: Math.floor(cols / 2), startY: rows - 1 };
    const playerEl = document.createElement("div");
    playerEl.className = "player";
    const playerFace = document.createElement("span");
    playerFace.className = "player-face";
    playerFace.textContent = "🐢";
    playerEl.appendChild(playerFace);
    arena.appendChild(playerEl);

    let solved = false;
    // Fail-safe memory: the last block we shoved into a wall and the direction we
    // shoved it. A second bump in the same direction ejects it (see `move`).
    let lastWallBump: { block: Block; dx: number; dy: number } | null = null;

    const isWall = (x: number, y: number) => x < 0 || x >= cols || y < 0 || y >= rows;
    const blockAt = (x: number, y: number) => blocks.find((b) => b.x === x && b.y === y);
    const slotAt = (x: number, y: number) => slots.find((s) => s.x === x && s.y === y);

    function draw() {
      const boardFull = slots.every((s) => blockAt(s.x, s.y));
      blocks.forEach((b) => {
        b.el.style.transform = `translate(${b.x * CELLW}px, ${b.y * CELLH}px)`;
        b.el.classList.toggle("seated", Boolean(slotAt(b.x, b.y)));
        if (!boardFull) b.el.classList.remove("correct", "wrong");
      });
      slots.forEach((s) => s.el.classList.toggle("filled", Boolean(blockAt(s.x, s.y))));
      playerEl.style.transform = `translate(${player.x * CELLW}px, ${player.y * CELLH}px)`;
    }

    function evaluate() {
      const full = slots.every((s) => blockAt(s.x, s.y));
      if (!full) return;
      // Mark each seated block right/wrong so the learner sees what to fix...
      let allOk = true;
      const mapping: Record<string, string> = {};
      slots.forEach((s) => {
        const b = blockAt(s.x, s.y)!;
        mapping[s.label] = b.word;
        const ok = b.word === correctOf[s.label];
        if (!ok) allOk = false;
        b.el.classList.toggle("correct", ok);
        b.el.classList.toggle("wrong", !ok);
      });
      // ...but the validator is still the source of truth for "solved".
      onSubmit(mapping);
      if (allOk) {
        solved = true;
        arena.classList.add("solved");
      }
    }

    function move(dx: number, dy: number) {
      if (solved) return;
      if (dx < 0) playerFace.classList.add("flip");
      else if (dx > 0) playerFace.classList.remove("flip");

      const nx = player.x + dx;
      const ny = player.y + dy;
      if (isWall(nx, ny)) return;

      const pushed = blockAt(nx, ny);
      if (pushed) {
        const tx = nx + dx;
        const ty = ny + dy;
        const blockedByBlock = Boolean(blockAt(tx, ty));
        const blockedByWall = isWall(tx, ty);

        if (blockedByBlock) {
          // Another block is behind it — a real obstacle. Nothing moves.
          lastWallBump = null;
          return;
        }

        if (blockedByWall) {
          // The block is jammed against the outer wall. A block that's already
          // seated in a slot is *meant* to sit there — leave it. Otherwise, give
          // the player a fail-safe so a block can never get permanently trapped:
          // the FIRST bump just thunks; a SECOND bump in the same direction ejects
          // the block AND the player one cell back, away from the wall.
          if (slotAt(pushed.x, pushed.y)) {
            lastWallBump = null;
            return;
          }
          const repeat =
            lastWallBump &&
            lastWallBump.block === pushed &&
            lastWallBump.dx === dx &&
            lastWallBump.dy === dy;
          if (repeat) {
            const bx = player.x - dx; // the player's retreat cell, away from the wall
            const by = player.y - dy;
            if (!isWall(bx, by) && !blockAt(bx, by)) {
              pushed.x = player.x; // block slides into the player's old spot...
              pushed.y = player.y;
              player.x = bx;       // ...and the player backs off one more cell
              player.y = by;
              lastWallBump = null;
              playerEl.classList.add("eject");
              setTimeout(() => playerEl.classList.remove("eject"), 220);
              draw();
              evaluate();
            }
            return;
          }
          lastWallBump = { block: pushed, dx, dy };
          return;
        }

        pushed.x = tx;
        pushed.y = ty;
      }
      lastWallBump = null;
      player.x = nx;
      player.y = ny;

      playerEl.classList.remove("step");
      void playerEl.offsetWidth; // restart the little bounce animation
      playerEl.classList.add("step");

      draw();
      evaluate();
    }

    function reset() {
      if (solved) return;
      lastWallBump = null;
      blocks.forEach((b) => {
        b.x = b.startX;
        b.y = b.startY;
        b.el.classList.remove("correct", "wrong", "seated");
      });
      player.x = player.startX;
      player.y = player.startY;
      draw();
    }

    const KEYS: Record<string, [number, number]> = {
      ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
      ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
      ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
      ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    };
    arena.addEventListener("keydown", (e) => {
      if (e.key === "r" || e.key === "R") {
        reset();
        e.preventDefault();
        return;
      }
      const delta = KEYS[e.key];
      if (!delta) return;
      e.preventDefault(); // stop the page scrolling on arrow keys
      move(delta[0], delta[1]);
    });
    arena.addEventListener("pointerdown", () => arena.focus({ preventScroll: true }));

    // --- on-screen controls (touch / no-keyboard) ---
    const controls = document.createElement("div");
    controls.className = "arena-controls";

    const dpad = document.createElement("div");
    dpad.className = "dpad";
    const pad: Array<[string, number, number, string]> = [
      ["↑", 0, -1, "up"],
      ["←", -1, 0, "left"],
      ["↓", 0, 1, "down"],
      ["→", 1, 0, "right"],
    ];
    pad.forEach(([glyph, dx, dy, pos]) => {
      const btn = document.createElement("button");
      btn.className = `pad-btn ${pos}`;
      btn.textContent = glyph;
      btn.onclick = () => {
        arena.focus({ preventScroll: true });
        move(dx, dy);
      };
      dpad.appendChild(btn);
    });
    controls.appendChild(dpad);

    const resetBtn = document.createElement("button");
    resetBtn.className = "reset-btn";
    resetBtn.textContent = "↺ Reset (R)";
    resetBtn.onclick = () => {
      arena.focus({ preventScroll: true });
      reset();
    };
    controls.appendChild(resetBtn);
    container.appendChild(controls);

    draw();
    arena.focus({ preventScroll: true });
  },
};
