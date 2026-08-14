// ---------------------------------------------------------------------------
// Desktop shell — SHIPPING_PLAN.md Phase 2. Loads the same dist/index.html the
// web build ships, over file://; no second codebase, no engine changes.
//
// Save data: writes ONE real JSON file under app.getPath("userData"), not
// localStorage — Steam Cloud syncs a file glob, not Chromium's opaque profile
// store. Read/write happens here (the only process with fs access);
// preload.cjs exposes it to the renderer as window.electronStorage, which
// src/engine/core/storage.ts already knows how to use.
// ---------------------------------------------------------------------------
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SAVE_FILE = path.join(app.getPath("userData"), "save.json");

function readSaveFile() {
  try {
    return JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSaveFile(data) {
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(data));
  } catch {
    // A failed save shouldn't crash the game — matches the try/catch every
    // call site already wraps its localStorage calls in (src/engine/core/storage.ts).
  }
}

ipcMain.on("storage:getItem", (event, key) => {
  const data = readSaveFile();
  event.returnValue = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
});

ipcMain.on("storage:setItem", (event, key, value) => {
  const data = readSaveFile();
  data[key] = value;
  writeSaveFile(data);
  event.returnValue = undefined;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 760,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  // Anything that isn't the app's own file:// page (an external link in
  // dialogue text, say) opens in the OS browser instead of hijacking the
  // game window.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // F11 / Cmd-Ctrl-F fullscreen toggle. Window chrome, not gameplay input —
  // doesn't touch or shadow any of the game's own keybindings (CLAUDE.md Rule 4).
  win.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return;
    const isToggle = input.key === "F11" || (input.key.toLowerCase() === "f" && input.control && input.meta);
    if (isToggle) win.setFullScreen(!win.isFullScreen());
  });

  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
}

Menu.setApplicationMenu(null);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
