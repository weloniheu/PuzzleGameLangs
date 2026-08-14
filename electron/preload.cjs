// ---------------------------------------------------------------------------
// Bridges the renderer's window.electronStorage (read by src/engine/core/
// storage.ts) to the main process over SYNCHRONOUS IPC. Synchronous matters:
// it's what lets storage.ts keep the exact getItem/setItem contract every
// existing save call site already has, with no async ripple through the game.
//
// contextIsolation is on and nodeIntegration is off (electron/main.cjs), so
// this is the renderer's only route to Node/fs — deliberately narrow: two
// string-in-string-out calls, nothing else exposed.
// ---------------------------------------------------------------------------
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronStorage", {
  getItem: (key) => ipcRenderer.sendSync("storage:getItem", key),
  setItem: (key, value) => { ipcRenderer.sendSync("storage:setItem", key, value); },
});
