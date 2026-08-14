// ---------------------------------------------------------------------------
// Rebase a ROOT-ABSOLUTE asset path onto whatever base the build is using.
//
// Art paths are authored as "/assets/snake.png" — by CONTENT (portrait / icon
// fields, see schema/types.ts) and by the engine's own module-icon map. A
// leading slash means "the server root", which is true for `npm run dev` and
// false for both of our shipping targets: a desktop shell loads dist/index.html
// over file:// (where "/assets/..." points at the filesystem root), and
// subdirectory hosting (itch.io) serves the game below the root.
//
// Vite injects BASE_URL — "/" in dev, "./" in a relative-base build — so doing
// the rebase here keeps content authored the documented way and fixes every
// consumer at once. Setting `base` in vite.config.ts is NOT enough on its own:
// it rewrites paths Vite itself generates, never absolute URLs sitting in
// source strings or pack JSON.
//
// This is path normalization, not content interpretation: it does not look at
// the language, level or pack. CLAUDE.md Rule 1 is untouched.
// ---------------------------------------------------------------------------

/** Already-resolvable forms — remote URLs and embedded data — pass through. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function assetUrl(path: string): string {
  if (!path) return path;
  if (ABSOLUTE.test(path)) return path;

  const base = import.meta.env?.BASE_URL ?? "/";
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
