import type { PuzzleRenderer, Puzzle, CombinePayload } from "../../schema/types";
import { createGridArena } from "./gridArena";

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * `combine` (word-logic) as a top-down board. The goal and a mixing bowl are
 * shown above; the objects and two action tiles (Mix / Empty) are floor tiles the
 * player walks onto and activates with Enter. Standing on an object toggles it in
 * or out of the bowl; standing on Mix runs the pack's recipes.
 *
 * The engine matches recipes purely by SET equality of item ids — it has no idea
 * scissors cut rope. `combine_match` decides the win against solution.inputs.
 */
export const combineRenderer: PuzzleRenderer = {
  render(container, puzzle: Puzzle, onSubmit) {
    const payload = puzzle.payload as CombinePayload;
    const labelOf = new Map(payload.items.map((it) => [it.id, it.label]));
    let bowl: string[] = [];

    container.innerHTML = "";

    const goal = document.createElement("p");
    goal.className = "combine-goal";
    goal.innerHTML = `🎯 <strong>Goal:</strong> ${payload.goal}`;
    container.appendChild(goal);

    const bowlEl = document.createElement("div");
    bowlEl.className = "combine-bowl";
    container.appendChild(bowlEl);

    const result = document.createElement("p");
    result.className = "combine-result";
    container.appendChild(result);

    function drawBowl() {
      bowlEl.innerHTML = bowl.length
        ? bowl.map((id) => `<span class="bowl-chip">${labelOf.get(id) ?? id}</span>`).join(" + ")
        : `<span class="bowl-empty">Walk onto objects below and press Enter to drop them in…</span>`;
    }

    function toggleItem(id: string) {
      bowl = bowl.includes(id) ? bowl.filter((x) => x !== id) : [...bowl, id];
      result.textContent = "";
      drawBowl();
      arena.refresh();
    }

    function mix() {
      if (bowl.length < 2) {
        result.textContent = "→ you need at least two things in the bowl.";
        result.classList.add("dud");
        return;
      }
      const recipe = payload.recipes.find((r) => sameSet(r.inputs, bowl));
      result.textContent = recipe ? `→ ${recipe.result}` : "→ nothing useful happens.";
      result.classList.toggle("dud", !recipe);
      onSubmit(bowl.slice()); // combine_match decides if this is the winning set
    }

    function empty() {
      bowl = [];
      result.textContent = "";
      drawBowl();
      arena.refresh();
    }

    const arenaHost = document.createElement("div");
    container.appendChild(arenaHost);

    const itemTiles = payload.items.map((it) => ({
      kind: "item" as const,
      id: it.id,
      spec: { label: it.label, className: "combine-item", onActivate: () => toggleItem(it.id) },
    }));
    const actionTiles = [
      { kind: "mix" as const, id: "", spec: { label: "🧪 Mix", className: "tile-action mix", onActivate: () => mix() } },
      { kind: "empty" as const, id: "", spec: { label: "↺ Empty", className: "tile-action", onActivate: () => empty() } },
    ];
    const all = [...itemTiles, ...actionTiles];

    const arena = createGridArena(arenaHost, {
      cols: Math.min(all.length, 4),
      caption: "Walk onto an object and press Enter to add/remove it. Stand on 🧪 Mix and press Enter to combine.",
      tiles: all.map((t) => t.spec),
      tileState: (_tile, i) => {
        const t = all[i];
        if (t.kind === "item" && bowl.includes(t.id)) return { className: "picked" };
        if (t.kind === "mix" && bowl.length < 2) return { className: "dimmed" };
        return undefined;
      },
    });

    drawBowl();
  },
};
