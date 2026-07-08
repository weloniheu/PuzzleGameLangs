// Standalone dev entry for the LOGIC puzzle type. Served by /logic.html so the game
// is PLAYABLE via `npm run dev` WITHOUT touching main.ts, roomRenderer, or the room
// manager. This is throwaway scaffolding; the real integration will be a
// RoomPuzzleModule adapter around startLogicGame() once that interface exists.
import { startLogicGame } from "./logicRenderer";
import { loadLogicPack } from "./packLoader";

const PACKS: Record<string, string> = {
  en: "/content/packs/logic.rules.en.v1.json",
  haw: "/content/packs/logic.rules.haw.v1.json",
};

const root = document.getElementById("logic-root")!;

async function boot(which: string) {
  root.innerHTML = "";
  try {
    const pack = await loadLogicPack(PACKS[which] ?? PACKS.en);
    startLogicGame(root, pack);
  } catch (e) {
    root.innerHTML = `<pre style="color:#e88">${(e as Error).message}</pre>`;
  }
}

// Language switch by URL hash (#haw), defaulting to English.
boot(location.hash.replace("#", "") || "en");
window.addEventListener("hashchange", () => boot(location.hash.replace("#", "") || "en"));
