import { defineConfig } from "vite";

// Relative base. The default ("/") emits root-absolute asset paths in
// dist/index.html, which only resolve when the game is served from a domain
// root — it breaks both targets we ship to:
//   • a desktop shell loading dist/index.html over file://
//   • itch.io-style hosting, where the game lives in a subdirectory
//
// Vite treats "./" as a build-only shortcut: the dev server still resolves base
// to "/", so `npm run dev` is completely unaffected (vite 5.4 resolveConfig —
// `relativeBaseShortcut`).
//
// NOTE: vitest has no config of its own, so it reads THIS file. `base` has no
// bearing on the tests, but anything added here (plugins especially) will apply
// to the test run too.
export default defineConfig({
  base: "./",
});
