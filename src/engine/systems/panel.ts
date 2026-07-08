// ---------------------------------------------------------------------------
// Panel — a generic dockable/poppable overlay window (shared engine system).
// Generalized VERBATIM from roomRenderer's terminal: same DOM shape (dockgrip,
// header(title+toggle), body, corner resize grip), same drag/resize/clamp
// behavior, same docked-band geometry. The coding terminal rebuilds on this
// primitive (puzzles/coding/terminal.ts); class names come from `classPrefix`
// so each use keeps its own scoped CSS.
//
//   docked → a bottom band that CROPS THE CAMERA (host reflows; tile unchanged)
//   popped → a free-floating, drag/resizable desktop-style window over the room
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface PanelGeo { x: number; y: number; w: number; h: number; }

/** Keep a popped window fully inside the bounds (clamps size FIRST, then position). */
export function clampGeo(geo: PanelGeo, boundsW: number, boundsH: number, minW: number, minH: number): PanelGeo {
  const w = clamp(geo.w, minW, boundsW);
  const h = clamp(geo.h, minH, boundsH);
  return {
    w,
    h,
    x: clamp(geo.x, 0, Math.max(0, boundsW - w)),
    y: clamp(geo.y, 0, Math.max(0, boundsH - h)),
  };
}

/** Docked band height: between its minimum and the available room (never below min). */
export function clampDockedHeight(desired: number, minH: number, maxH: number): number {
  return clamp(desired, minH, Math.max(minH, maxH));
}

export type PanelMode = "docked" | "popped";

export interface PanelDeps {
  container: HTMLElement;
  /** CSS class prefix, e.g. "room-terminal" → .room-terminal-header etc. */
  classPrefix: string;
  title: string;
  initialBody?: string;
  minW: number;
  minH: number;
  dockMinH: number;
  initial: { dockedH: number; x: number; y: number; w: number; h: number };
  /** Max docked-band height at drag time (e.g. room height minus one row). */
  maxDockedH(): number;
  /** Dock⇄pop toggled — the host reflows the camera (crop only; NEVER the tile). */
  onModeToggled(): void;
  /** Docked band height changed mid-drag — camera-only reflow (no breathing). */
  onDockResize(): void;
  /** A drag/resize gesture ended — the host refocuses gameplay. */
  onInteractEnd(): void;
}

export interface Panel {
  el: HTMLElement;
  body: HTMLElement;
  isDocked(): boolean;
  dockedH(): number;
  containsActive(): boolean; // is keyboard focus inside the panel? (esc routing)
  applyMode(): void;         // docked vs popped visuals
  clampAndPlace(): void;     // keep a popped window on-screen (relayout)
  layoutDocked(): void;      // write the docked band geometry (host camera pass)
}

export function createPanel(deps: PanelDeps): Panel {
  const p = deps.classPrefix;
  const geo = {
    mode: "docked" as PanelMode,
    dockedH: deps.initial.dockedH,
    x: deps.initial.x, y: deps.initial.y, w: deps.initial.w, h: deps.initial.h,
  };

  const el = document.createElement("div");
  el.className = p;
  const header = document.createElement("div");
  header.className = `${p}-header`;
  const title = document.createElement("span");
  title.className = `${p}-title`;
  title.textContent = deps.title;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `${p}-toggle`;
  header.append(title, toggle);
  const body = document.createElement("div");
  body.className = `${p}-body`;
  if (deps.initialBody !== undefined) body.textContent = deps.initialBody;
  const resizeGrip = document.createElement("div");
  resizeGrip.className = `${p}-resize`;
  const dockGrip = document.createElement("div"); // top-edge drag to set docked height
  dockGrip.className = `${p}-dockgrip`;
  el.append(dockGrip, header, body, resizeGrip);
  deps.container.appendChild(el);

  /** Keep the popped window fully inside the game window. */
  function clampPopped() {
    const g = clampGeo(geo, deps.container.clientWidth, window.innerHeight, deps.minW, deps.minH);
    geo.x = g.x; geo.y = g.y; geo.w = g.w; geo.h = g.h;
  }
  /** Write the popped geometry onto the element. */
  function placePopped() {
    el.style.left = `${geo.x}px`;
    el.style.top = `${geo.y}px`;
    el.style.width = `${geo.w}px`;
    el.style.height = `${geo.h}px`;
  }
  /** Apply the docked-vs-popped visual mode (docked geometry is the host's camera pass). */
  function applyMode() {
    const popped = geo.mode === "popped";
    el.classList.toggle("popped", popped);
    el.classList.toggle("docked", !popped);
    toggle.textContent = popped ? "▭ dock" : "◳ pop out";
    resizeGrip.hidden = !popped;  // corner grip = popped only
    dockGrip.hidden = popped;     // top edge grip = docked only
    if (popped) { clampPopped(); placePopped(); }
  }

  // Toggle dock/pop — camera-only reflow; MUST NOT re-tile (no tile change → no breathing).
  toggle.onclick = () => {
    geo.mode = geo.mode === "docked" ? "popped" : "docked";
    applyMode();
    deps.onModeToggled();
  };

  // Drag by the header (popped only).
  let drag: { px: number; py: number; x: number; y: number } | null = null;
  header.addEventListener("pointerdown", (e) => {
    if (geo.mode !== "popped" || e.target === toggle) return;
    drag = { px: e.clientX, py: e.clientY, x: geo.x, y: geo.y };
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  header.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const W = deps.container.clientWidth, H = window.innerHeight;
    geo.x = clamp(drag.x + (e.clientX - drag.px), 0, Math.max(0, W - geo.w));
    geo.y = clamp(drag.y + (e.clientY - drag.py), 0, Math.max(0, H - geo.h));
    placePopped();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    header.releasePointerCapture(e.pointerId);
    deps.onInteractEnd();
  };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  // Resize by the corner (popped only); grows right/down, clamped to the window edge.
  let rez: { px: number; py: number; w: number; h: number } | null = null;
  resizeGrip.addEventListener("pointerdown", (e) => {
    if (geo.mode !== "popped") return;
    rez = { px: e.clientX, py: e.clientY, w: geo.w, h: geo.h };
    resizeGrip.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });
  resizeGrip.addEventListener("pointermove", (e) => {
    if (!rez) return;
    const W = deps.container.clientWidth, H = window.innerHeight;
    geo.w = clamp(rez.w + (e.clientX - rez.px), deps.minW, W - geo.x);
    geo.h = clamp(rez.h + (e.clientY - rez.py), deps.minH, H - geo.y);
    placePopped();
  });
  const endRez = (e: PointerEvent) => {
    if (!rez) return;
    rez = null;
    resizeGrip.releasePointerCapture(e.pointerId);
    deps.onInteractEnd();
  };
  resizeGrip.addEventListener("pointerup", endRez);
  resizeGrip.addEventListener("pointercancel", endRez);

  // Drag the docked band's TOP edge up/down to set its height (docked only). This is
  // a camera crop — it changes how many room rows are visible, NEVER the tile size.
  let dockRez: { py: number; h: number } | null = null;
  dockGrip.addEventListener("pointerdown", (e) => {
    if (geo.mode !== "docked") return;
    dockRez = { py: e.clientY, h: geo.dockedH };
    dockGrip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  dockGrip.addEventListener("pointermove", (e) => {
    if (!dockRez) return;
    geo.dockedH = clampDockedHeight(dockRez.h + (dockRez.py - e.clientY), deps.dockMinH, deps.maxDockedH()); // up = taller
    deps.onDockResize(); // camera-only; tile unchanged → no breathing
  });
  const endDockRez = (e: PointerEvent) => {
    if (!dockRez) return;
    dockRez = null;
    dockGrip.releasePointerCapture(e.pointerId);
    deps.onInteractEnd();
  };
  dockGrip.addEventListener("pointerup", endDockRez);
  dockGrip.addEventListener("pointercancel", endDockRez);

  return {
    el,
    body,
    isDocked: () => geo.mode === "docked",
    dockedH: () => geo.dockedH,
    containsActive: () => el.contains(document.activeElement),
    applyMode,
    clampAndPlace: () => {
      clampPopped();
      if (geo.mode === "popped") placePopped();
    },
    layoutDocked: () => {
      el.style.left = "0px";
      el.style.top = `${window.innerHeight - geo.dockedH}px`;
      el.style.width = `${deps.container.clientWidth}px`;
      el.style.height = `${geo.dockedH}px`;
    },
  };
}
