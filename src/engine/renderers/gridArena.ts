// ---------------------------------------------------------------------------
// Shared top-down "walk-and-press-Enter" arena.
//
// Several puzzle types are really just "pick from a set of buttons". Instead of
// HTML buttons you click with a mouse, this turns each button into a floor TILE:
// the player (🐢) walks the grid with arrow keys / WASD (or the on-screen D-pad),
// stands on a tile, and presses Enter (or the ⏎ button) to activate it — exactly
// like the match puzzle's board, so the whole game feels like one world.
//
// It is puzzle-agnostic: it knows nothing about grammar, recipes, or code. A
// renderer hands it labelled tiles + onActivate callbacks and an optional
// per-tile state function (for "used"/"picked"/"disabled" styling), and drives
// the rest from its own display area above the arena.
// ---------------------------------------------------------------------------

const DEFAULT_W = 144;
const DEFAULT_H = 80;

export interface ArenaTileSpec {
  label: string;
  className?: string;
  onActivate?: () => void;
}

export interface ArenaTile {
  spec: ArenaTileSpec;
  x: number;
  y: number;
  el: HTMLElement;
}

/** Optional per-frame state for a tile (e.g. selected, disabled). */
export type TileState = { label?: string; className?: string } | void;

export interface ArenaConfig {
  cols: number;
  tiles: ArenaTileSpec[];
  caption?: string;
  cellW?: number;
  cellH?: number;
  tileState?: (tile: ArenaTile, index: number) => TileState;
}

export interface ArenaHandle {
  tiles: ArenaTile[];
  refresh(): void;
  focus(): void;
}

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
  ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
};

export function createGridArena(container: HTMLElement, cfg: ArenaConfig): ArenaHandle {
  const CELLW = cfg.cellW ?? DEFAULT_W;
  const CELLH = cfg.cellH ?? DEFAULT_H;
  const cols = cfg.cols;
  const tileRows = Math.ceil(cfg.tiles.length / cols);
  const rows = tileRows + 1; // one empty row at the bottom for the player to spawn

  const caption = document.createElement("p");
  caption.className = "arena-caption";
  caption.textContent = cfg.caption ?? "Walk with arrow keys / WASD · stand on a tile and press Enter (⏎).";
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

  const tiles: ArenaTile[] = cfg.tiles.map((spec, i) => {
    const el = document.createElement("div");
    el.style.width = `${CELLW}px`;
    el.style.height = `${CELLH}px`;
    const x = i % cols;
    const y = Math.floor(i / cols);
    el.style.transform = `translate(${x * CELLW}px, ${y * CELLH}px)`;
    arena.appendChild(el);
    const tile: ArenaTile = { spec, x, y, el };
    // Mouse/touch shortcut: clicking a tile walks the player onto it and activates.
    el.addEventListener("click", () => {
      player.x = x;
      player.y = y;
      activate();
    });
    return tile;
  });

  const player = { x: Math.floor(cols / 2), y: rows - 1 };
  const playerEl = document.createElement("div");
  playerEl.className = "player on-tile";
  playerEl.style.width = `${CELLW}px`;  // match the cell so the 🐢 centres on a tile
  playerEl.style.height = `${CELLH}px`;
  const face = document.createElement("span");
  face.className = "player-face";
  face.textContent = "🐢";
  playerEl.appendChild(face);
  arena.appendChild(playerEl);

  const isWall = (x: number, y: number) => x < 0 || x >= cols || y < 0 || y >= rows;
  const tileAt = (x: number, y: number) => tiles.find((t) => t.x === x && t.y === y);

  function refresh() {
    tiles.forEach((t, i) => {
      const st = cfg.tileState ? cfg.tileState(t, i) : undefined;
      t.el.textContent = st?.label ?? t.spec.label;
      t.el.className = ["cell", "tile", t.spec.className ?? "", st?.className ?? ""].filter(Boolean).join(" ");
      if (t.x === player.x && t.y === player.y) t.el.classList.add("here");
    });
    playerEl.style.transform = `translate(${player.x * CELLW}px, ${player.y * CELLH}px)`;
  }

  function move(dx: number, dy: number) {
    if (dx < 0) face.classList.add("flip");
    else if (dx > 0) face.classList.remove("flip");
    const nx = player.x + dx;
    const ny = player.y + dy;
    if (isWall(nx, ny)) return;
    player.x = nx;
    player.y = ny;
    playerEl.classList.remove("step");
    void playerEl.offsetWidth;
    playerEl.classList.add("step");
    refresh();
  }

  function activate() {
    const t = tileAt(player.x, player.y);
    if (!t || !t.spec.onActivate) {
      refresh();
      return;
    }
    t.el.classList.remove("press");
    void t.el.offsetWidth;
    t.el.classList.add("press");
    t.spec.onActivate();
    refresh();
  }

  arena.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
      return;
    }
    const delta = KEYS[e.key];
    if (!delta) return;
    e.preventDefault();
    move(delta[0], delta[1]);
  });
  arena.addEventListener("pointerdown", () => arena.focus({ preventScroll: true }));

  // --- on-screen controls (touch / no-keyboard): D-pad with a centre ⏎ button ---
  const controls = document.createElement("div");
  controls.className = "arena-controls";
  const dpad = document.createElement("div");
  dpad.className = "dpad with-enter";
  const buttons: Array<[string, string, () => void]> = [
    ["↑", "up", () => move(0, -1)],
    ["←", "left", () => move(-1, 0)],
    ["⏎", "enter", () => activate()],
    ["→", "right", () => move(1, 0)],
    ["↓", "down", () => move(0, 1)],
  ];
  buttons.forEach(([glyph, pos, fn]) => {
    const btn = document.createElement("button");
    btn.className = `pad-btn ${pos}`;
    btn.textContent = glyph;
    btn.onclick = () => {
      arena.focus({ preventScroll: true });
      fn();
    };
    dpad.appendChild(btn);
  });
  controls.appendChild(dpad);
  container.appendChild(controls);

  refresh();
  arena.focus({ preventScroll: true });

  return { tiles, refresh, focus: () => arena.focus({ preventScroll: true }) };
}
