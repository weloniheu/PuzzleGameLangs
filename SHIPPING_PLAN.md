# SHIPPING_PLAN.md — getting SLIME playable by other people

Target: **playable in a browser** (fast, free) and **on Steam for macOS + Windows**
(slower, costs money, more paperwork). Both ship from the *same* `dist/` — there
is no fork, no second codebase, and no engine rewrite.

---

## 0. Where the project actually stands

Verified on 2026-08-10, branch `progression-update` (clean tree):

| | |
|---|---|
| Stack | plain TypeScript + Vite 5, **zero runtime dependencies**, DOM rendering (no canvas, no framework) |
| Build | `npm run build` — green, 315ms |
| Tests | `npm test` — **538 passing / 36 files**, including a full hub→level→solve→back smoke test |
| Output | `dist/` = 1.2 MB · JS 121 KB (39 KB gzip) · CSS 48 KB (10 KB gzip) |
| Save data | `localStorage`, 4 non-test call sites |
| Input | keyboard-only by design (CLAUDE.md Rule 4) |

**This is a genuinely good position to ship from.** No runtime dependencies means
no dependency hell, no native modules, no version churn. A DOM-based game runs in
any WebView with trivial GPU requirements — it will be fine on a low-end laptop and
on a Steam Deck. The test suite is real coverage, not decoration. The work below is
almost entirely packaging, not engineering.

### Three things broke every shipped build — all fixed in Phase 0 below

**B1 — Content packs were never bundled.** `src/main.ts:19-33` fetched
`/content/packs/*.json` at runtime, but `content/` sits outside `public/`, so Vite
never copied it and `dist/` had no `content/` directory. It worked in `npm run dev`
(the dev server serves the project root) and in tests (Node reads from disk), which
is exactly why it went unnoticed — but any real deploy 404'd on all seven packs and
the game could not start. **There was a second, independent instance of this bug** in
`src/puzzles/logic/packLoader.ts`, which fetched the logic rule packs through its own
loader.

**B2 — Fonts came from a CDN.** `index.html` `<link>`ed Fredoka and IBM Plex Mono
from `fonts.googleapis.com`. Acceptable on the web; on Steam it meant a
network-dependent, wrong-looking game offline.

**B3 — Art paths were root-absolute.** Portraits and portal icons are authored as
`/assets/snake.png` — in pack JSON and in the engine's module-icon map. A leading
slash means "server root", which is false both over `file://` and under
subdirectory hosting. Setting Vite's `base` does **not** fix this: `base` rewrites
paths Vite itself generates, never absolute URLs sitting in source strings or
content JSON.

---

## Phase 0 — Make `dist/` a real, self-contained build ✅ DONE

Completed 2026-08-10. `dist/` is now self-contained and loads with zero network
access. Result: **832 KB** (down from 1.2 MB) — smaller even after adding 136 KB of
fonts and inlining 400 KB of pack JSON, because the art was the real weight.

| | before | after |
|---|---|---|
| JS | 121 KB (39 KB gz) | 323 KB (65 KB gz) — packs now inlined |
| Art | 961 KB | 180 KB |
| Fonts | 0 (CDN) | 136 KB (self-hosted) |
| **Total `dist/`** | **1.2 MB** | **832 KB** |
| Tests | 538 | 543 |

**Does any of this affect local development? No.** `npm run dev`, `npm test` and
`npm run build` all behave exactly as before. Verified rather than assumed:
Vite 5.4 treats `base: "./"` as a build-only shortcut and still resolves the dev
server to `/` (`relativeBaseShortcut`, `dep-BK3b2jBa.js:66499`). Two side effects
worth knowing: **vitest now reads `vite.config.ts`** (it had no config of its own),
and a brand-new pack file may need a dev-server restart for the glob to notice it —
adding a language is still data-only.

### 0.1 Content packs are bundled, not fetched *(fixes B1)*

Moving `content/` into `public/` would have fixed web hosting but not desktop —
Chromium blocks `fetch()` under `file://`. The packs are inlined into the JS
instead, which is the one form that survives dev, web and `file://` alike.

`src/engine/packLoader.ts` now resolves through `import.meta.glob(..., { eager: true })`,
keyed by filename so callers keep passing the `/content/packs/x.json` URLs they
always did. `loadPack()` keeps its signature and its `async` return, so **no caller
changed**. Two deliberate details:

- **`structuredClone` on every load.** A bundled module is one shared object where
  each `fetch()` previously produced a fresh parse. Without the copy, any runtime
  mutation of a puzzle would leak into later loads of the same pack.
- **The same fix applied twice.** `src/puzzles/logic/packLoader.ts` had its own
  independent `fetch` for the logic rule packs — the same bug, missed on the first
  read of the code. Deleting the smoke test's `fetch` stub is what exposed it.

`src/engine/packBundling.test.ts` guards the regression: every pack on disk is in
the bundle, every URL `main.ts` references resolves, unknown packs fail loudly, and
two loads of one pack are independent objects.

### 0.2 Fonts are self-hosted *(fixes B2)*

Fredoka and IBM Plex Mono are both **SIL Open Font License**, so redistribution is
permitted. Pre-subset WOFF2 now live in `src/assets/fonts/` (in `src/`, not
`public/`, so Vite fingerprints them and rewrites the URLs for whatever `base` is
active). The `@font-face` block in `src/style.css` mirrors the exact families,
weights and `display: swap` the CDN link requested, so rendering is unchanged.

**The latin-ext subsets are not optional.** The Hawaiian content uses kahakō
(ā Ā ī ō Ō ū = U+0100–024F), which the latin subset does not cover — a latin-only
self-hosting job would have silently broken the Hawaiian packs. 136 KB for all
eight files; the browser fetches latin-ext only for the packs that need it.

### 0.3 `vite.config.ts` with `base: "./"`

Added. The default `/` emitted root-absolute asset paths that resolve only from a
domain root — broken over `file://` and under itch.io's subdirectories.

### 0.4 Art resized *(961 KB → 180 KB)*

The two snake portraits render in a 92px box but were shipping at 646×822 and
780×827 — roughly 10× oversized. Resized to 320px tall (≈3.4× headroom for hi-DPI),
alpha preserved. 82% smaller each. The full-resolution originals are untouched in
`imageAssets/SnakeAssets/`, which is what made this safe.

### 0.5 Art paths rebased *(fixes B3)*

New `src/engine/core/assetUrl.ts` rebases root-absolute art paths onto
`import.meta.env.BASE_URL`, applied at the three `img.src` sites (`dialogue.ts`,
`portals.ts`, `tutorialCard.ts`). Content keeps authoring `/assets/x.png` — the
documented convention in `schema/types.ts` — and no pack JSON needed editing. This
is path normalization, not content interpretation, so **CLAUDE.md Rule 1 holds**:
it never looks at language, level or pack.

### 0.6 Verify — done

Automated and static verification all pass:

- 543 tests green. The smoke test (`roomHost.smoke.test.ts`) plays the full
  hub → door → tutorial → pick up → place → build → run → unlock → back loop
  through the real manager, and now exercises the **real** bundled-pack path — its
  `globalThis.fetch` stub was deleted, because there is no longer a fetch to stub.
  That deletion is what caught the second loader in `puzzles/logic`.
- Every asset reference in the built `index.html` and CSS resolves to a file in
  `dist/` (10/10), and all 6 root-absolute art strings resolve once `assetUrl()`
  rebases them.
- Pack JSON confirmed inlined in the bundle; the only `fetch(` left is Vite's own
  modulepreload polyfill.

The one thing static checks can't cover — fonts, images and layout actually
rendering right — needed a human: jsdom doesn't render, and this sandbox can
neither bind a preview server nor open `file://` in its browser tool. Verified
by running `npm run dev` and `npm run build && npm run preview` directly.

---

## Phase 1 — Playable online *(recommended first release)*

After Phase 0 the game is a static site. Hosting it is nearly free work.

**Recommend itch.io.** It is the natural home for an indie web game: free, hosts
HTML5 builds directly (upload a zip of `dist/`, tick "This file will be played in
the browser"), gives you a real page with screenshots and a devlog, and provides an
audience that plays experimental puzzle games and leaves feedback. That feedback is
worth a great deal *before* you spend $100 and two weeks of lead time on Steam.

Alternatives if you'd rather self-host: Cloudflare Pages, Netlify, or GitHub Pages —
all free for a static site, all connect to the GitHub repo and rebuild on push.
There's no reason not to do both; itch for reach, a Pages deploy for a stable URL.

**Effort: an afternoon.** This should be your first release regardless of Steam.

---

## Phase 2 — Wrap it as a desktop app

### Recommendation: Electron

| | Electron | Tauri v2 |
|---|---|---|
| Bundle size | ~150 MB | ~10 MB |
| Toolchain | Node only | **requires Rust** |
| Renderer | bundled Chromium — identical on both OSes | system WebView (WKWebView / WebView2), behaviour differs |
| Steamworks | `steamworks.js`, very well-trodden | possible, much thinner community |
| macOS signing/notarization | mature, `electron-builder` handles it | workable, fewer worked examples |

**Take Electron.** The size advantage of Tauri is the only real argument for it, and
it is irrelevant here: Steam ships multi-GB games routinely and players never see
the number. Against that, Electron gives you a Chromium that behaves identically to
the browser you developed in, a mature signing/notarization path, and the
better-documented Steamworks binding. Rust in the toolchain is a real cost for a
solo project with no other Rust in it.

### Work involved

- `electron-builder` config; app id, product name, icons (`.icns` for macOS, `.ico`
  for Windows).
- A minimal main process: create the window, load `dist/index.html`, strip the
  default menu bar, disable devtools in production, block external navigation.
- **Window sizing is the one real UI task.** `src/style.css:39` pins the game to
  `#app { max-width: 720px; }`. In a maximized desktop window that renders as a
  narrow strip down the middle of a large screen, which reads as broken. Decide on a
  scaling approach — a CSS `transform: scale()` on the app root driven by viewport
  size is the lowest-risk option since it needs no layout changes and cannot leak
  into per-renderer styles (CLAUDE.md Rule 5). Add fullscreen toggle (F11 / Cmd-Ctrl-F)
  and a sensible minimum window size.
- **macOS: build a universal binary** (`electron-builder --universal`) so one build
  covers Intel and Apple Silicon rather than maintaining two depots.

### Save data — do the small refactor now

`localStorage` works in Electron and persists per-user, so it ships fine as-is. But
**Steam Cloud sync requires saves as real files on disk**, which `localStorage` is
not. There are only 4 non-test call sites (`src/engine/core/codex.ts` and
`src/puzzles/{grammar,logic,vocab}/index.ts`). Putting them behind a tiny
`storage.ts` adapter now — web backend writes `localStorage`, desktop backend writes
JSON under `app.getPath("userData")` — is maybe an hour of work and makes Cloud a
later config change instead of a refactor under release pressure.

**Effort: 2-4 days**, most of it window sizing and first-time signing setup.

---

## Phase 3 — Steam

### The money and the calendar

| Item | Cost | Notes |
|---|---|---|
| Steam Direct fee | **$100 USD per title** | applies whether the title is free or paid — it's a publishing fee, not a price-based one; recoupable against revenue once the app earns $1,000 adjusted gross (a permanently-free title may never recoup it). Only exception: a demo linked to an *already-published paid* app on your account doesn't need its own fee — a standalone free demo does. |
| Apple Developer Program | **$99 USD/yr** | for Developer ID signing + notarization of the macOS build |
| Windows code signing | **$0** | Steam distributes through its own client; not required |

> Verify both figures and every asset dimension below against current Steamworks
> and Apple documentation when you actually start — Valve and Apple both change
> these, and this plan is written from a mid-2026 understanding.

**The schedule is the part people get wrong.** Two hard gates:

1. **Payee/tax onboarding must clear before you can do anything else** — bank details,
   tax interview, identity verification. Days, sometimes longer.
2. **Your store page must be public for a minimum of 2 weeks before release day.**
   This is not negotiable and it is not a review queue — it is a mandatory waiting
   period. Valve *also* reviews your build separately (a few business days).

So the realistic floor from "I paid the $100" to "players can buy it" is **3-4 weeks**,
almost none of which is coding.

### Signing, honestly

- **Windows:** unsigned is fine on Steam.
- **macOS:** sign it. Apple Silicon requires *at minimum* an ad-hoc signature for a
  binary to execute at all, so "unsigned" is not actually an option on modern Macs.
  Use a real Developer ID certificate and notarize — `electron-builder` automates
  both once the cert is in your keychain. This is the single most likely place for a
  first-time desktop release to lose a day; budget for it.

### Store page assets

Steam requires a specific set of capsule images. From memory the set is roughly:
header 460×215, small capsule 231×87, main capsule 616×353, vertical capsule 374×448,
library capsule 600×900, library hero 3840×1240, library logo 1280×720 — **check the
current Steamworks requirements rather than trusting this list.** Plus at least 5
screenshots (1920×1080) and, in practice, a trailer — a store page without one
converts badly.

You will also complete a content-rating questionnaire and write the store
description, feature list, and system requirements.

**This is the largest single chunk of unglamorous work in the whole plan**, and it is
art/marketing work rather than programming. Plan for it explicitly instead of
discovering it at the end.

### Uploading the build

Builds go up via **SteamPipe** (`steamcmd` plus `app_build.vdf` / `depot_build.vdf`
scripts). Structure: one depot for Windows, one for macOS, each with its own launch
option in the app config. Point each depot at the *unpacked* application directory —
have `electron-builder` emit `dir` targets rather than a `.dmg`/`.exe` installer,
since Steam does its own installation and patching.

Start uploading to a `beta` branch early. Getting a build to actually launch out of
the Steam client is a fiddly first-timer step and you do not want to be discovering
that in your release week.

---

## Phase 4 — Steam features worth adding after launch

None of these are required to ship. A game can go live with zero Steamworks API calls.

- **Achievements — you are already 90% there.** `src/engine/core/achievements.ts`
  plus the unlock-key model in `PROGRESSION.md` is *exactly* the shape Steam
  achievements take. Each earned unlock key (`coding.tutorial.cleared`,
  `vocab1.cleared`, …) maps to one Steam achievement, defined in the Steamworks
  partner site and fired via `steamworks.js` from the main process. Low effort,
  high perceived polish, and it directly reuses a system you already built.
- **Steam Cloud** — trivial once Phase 2's `storage.ts` adapter writes real files;
  Auto-Cloud just needs a path and a glob, no code.
- **Controller support without breaking Rule 4** — Steam Input can remap a gamepad
  to keyboard events at the OS level, so you ship a default controller config and
  write *no code*. Since the game receives ordinary keystrokes, CLAUDE.md Rule 4
  stays intact. This is also the cheapest route to being Steam Deck playable.

---

## Sequence and effort

```
Phase 0  Fix the build            ✅ DONE   ← was blocking everything
Phase 1  Ship on itch.io          ½ day    ← real players, real feedback, $0
Phase 2  Electron wrapper         2-4 days
Phase 3  Steam paperwork + store  3-4 weeks wall-clock, mostly waiting + art
Phase 4  Achievements / Cloud     after launch
```

Phase 0 is merged; moving through Phases 1-3 now rather than pausing to collect
itch.io feedback first.

## Open questions

1. **Free or paid on Steam?** **Decided: free, positioned as a demo.** Note this
   doesn't waive the $100 Steam Direct fee (see Phase 3) — that only applies to a
   demo linked to an already-published paid app, which this isn't. Being free also
   lowers the content-quantity bar Steam buyers judge paid titles against (see Q2),
   but a Steam store page still expects enough to justify a listing.
2. **How much play time is in the game right now?** The four tracks in
   `PROGRESSION.md` look substantial on paper, but I have not timed a playthrough.
   Steam buyers judge this hard; itch players are far more forgiving of a short game.
3. **Is the Hawaiian-language content reviewed by a speaker?** Not a technical gate,
   but it is a public release of ʻōlelo Hawaiʻi teaching material — worth being
   deliberate about before it ships under a Purple Maiʻa-adjacent name.
4. **Steam Deck a goal?** If yes, Phase 4's controller config moves up, because
   keyboard-only is a hard blocker for Deck playability.
