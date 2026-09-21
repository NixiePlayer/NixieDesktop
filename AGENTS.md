# TanStack Intent

Before editing routes, the router, or TanStack Vite integration, run
`pnpm dlx @tanstack/intent@latest list`, then load the matching `router-core`,
`router-plugin`, or `devtools-vite` skill.

# Nixie

Unofficial YouTube Music desktop client for macOS, Windows and Linux. Electron main process, sandboxed preload bridge, React renderer. It reaches YouTube through InnerTube (`youtubei.js`) using a session adopted from a signed-in browser on the same device. `CONTEXT.md` holds the glossary and ADRs, `SPEC.md` the product spec. Git history of this file holds the longer reasoning behind the rules below.

## Rules

- Never use em dashes anywhere: code, comments, docs, tests, commits, generated content.
- Conventional Commits (`type(scope): subject`), scoped when there is an obvious scope (`player`, `electron`, `explore`, `settings`, ...). Add a body when the subject cannot carry the reasoning: what was wrong, why this change, what it costs.
- Keep this file current and short. When a convention changes here, change `CONTRIBUTING.md` too. `README.md` and `CONTRIBUTING.md` do not restate this file.
- Node 24 and pnpm 12.3.4 (`packageManager` and `engines.pnpm` must match, `engine-strict=true`). Exact dependency versions only, no ranges.
- Run `pnpm check` before calling work done. CI runs it on Ubuntu and Windows plus `pnpm audit --audit-level high`. Actions are pinned to commit SHAs.
- Files are LF everywhere (`.gitattributes`); oxfmt fails on CRLF.

## Commands

- `pnpm dev`: Electron + Vite development app.
- `pnpm check`: format, lint, typecheck, unit tests, route generation, production build.
- `pnpm fmt:fix`, `pnpm lint:fix`, `pnpm test`, `pnpm typecheck`.
- `pnpm package:mac` / `package:win` / `package:linux`: local unpublished packages. The "skipping afterSign hook" warning on Windows and Linux is expected.
- `pnpm dist`: release gates plus signed, notarized, stapled macOS DMG and ZIP. Slow; run under `caffeinate -is`.

## Layout

- `electron/`: privileged main process (`main.ts`), preload bridge, `youtube-adapter.ts`, `media-protocol.ts` (`nixie://`), `state-store.ts`, `lyrics.ts`, `browser-cookies.ts`, native host for the Nixie Link extension (`native-host*`).
- `src/shared/`: serializable IPC contracts (`contracts.ts`) and pure logic shared by both processes. Entity narrowing and display helpers live in `entities.ts`, never in components.
- `src/routes/`: TanStack Router file routes, hash history. Data loading is route loaders only; there is no query client.
- `src/lib/`: framework-free stores and logic (`audio-engine.ts`, `api.ts`, `library.ts`, `rating.ts`, `updates.ts`, `theme.ts`, `i18n.ts`, `platform.ts`, `swipe-nav.ts`).
- `src/player.tsx`: React binding over the audio engine: `usePlayer()` actions, `usePlayback()` state, `usePlaybackPosition()` high-frequency position.
- `src/components/`: app components. `src/components/ui/` is generated shadcn/Base UI source: change it through the shadcn CLI and current docs, not by hand.
- `src/locales/{en,it}/`: dictionaries. `scripts/`: dev setup, licences, release hooks. `build/`: icons and NSIS include.

## Coding style

- Small, explicit, low-complexity code. No abstractions for one caller, no new dependencies for what a few lines do.
- Unit test framework-free logic with Vitest next to the source (`*.test.ts`). English strings are what tests assert, so do not reword them in passing.
- Type imports use `import type` (`typescript/consistent-type-imports`). Follow TanStack Router type inference: do not cast or annotate inferred router values.
- Style with Tailwind utilities and the semantic tokens. `src/styles.css` holds tokens and a few global rules only, no page CSS and no `::-webkit-scrollbar` rules (they break overlay scrollbars).
- Focus rings resolve through `--ring`, which is transparent except on text inputs. Do not hard-code a focus colour.
- A box is never sized by its label: selects, menus and rails state their width; a label that changes (language or state) stacks every wording in one grid cell with the unused ones `invisible`. Growable text truncates or line-clamps.
- Pages respond to their own width with `@container` queries, not viewport breakpoints, since the rail and Now panel change the column width without resizing the window.
- In dialogs, name controls with `aria-labelledby`, not `htmlFor`.
- A prop returning JSX is named `render*`.
- Playback controls are explicit: a card or row title navigates, only the play button over artwork starts playback (`TrackRow` also plays from the rest of its row). Nested interactive elements are invalid; links inside rows stop propagation.

## i18n

- English and Italian, no i18n dependency. `src/locales/en/<namespace>.ts` is the source; `it` is typed `typeof en`, so a missing key fails typecheck. Strings needing a count or name are functions.
- Components read `useMessages()`; code outside React calls `messages()` when it speaks. Never hold a label in a module-level constant.
- `src/shared/` helpers that print take the dictionary as an argument. Main uses `messagesFor(appLanguage())`.
- The app language is also sent to InnerTube, so parsers of upstream wording must handle both languages (`LEAD_SHELVES`, `expandPlays`, `episodeLengths`, `regionCode`). Auto playlists (`LM`, `SE`, `RDPN`) are always named through `autoPlaylist(id, m)`, never their raw title.
- Adding a language: a locale folder, a `Language` member, `resolveLanguage`, the settings option, and the upstream-wording parsers above.

## Security and privacy

- Never disable sandboxing, context isolation, CSP, sender validation or `webSecurity` to work around upstream.
- Never log cookies, signed URLs, parser objects, arbitrary URLs, filesystem paths or lyric text. Unknown errors go through `LocalLogger.failure`; `write` takes fixed descriptions and counts only.
- The renderer gets plain DTOs, opaque tokens and `nixie:` URLs only. Parser objects, cookies, signed URLs and feedback tokens stay in main. Images go through `registerArtwork`; allowed hosts are in `media-protocol.ts`.
- Never build a filesystem path from renderer input. Validate IPC payloads in main; bundled documents are read from a fixed allowlist.
- Path containment checks must also refuse `isAbsolute(relative(...))` (Windows cross-drive).
- External links need their exact hostname in `externalHosts`.
- Auth is a browser session read from disk (`browser-cookies.ts`) or pushed by the Nixie Link extension over a paired, HMAC-proved native messaging channel. No embedded Google sign-in, no OAuth device flow, no manual cookie paste, no bypass of Windows app-bound encryption.
- Playback is refused only when the Premium probe answers `false`; `undefined` allows.
- No offline downloads, no ads, sponsorship or paid features in the app. The app states it is unofficial on the sign-in view and About tab; do not remove that or disparage YouTube or Google. Sign-in copy is a disclosure: keep `README.md`, `PRIVACY.md`, `SECURITY.md` and `CONTEXT.md` consistent with it. A new lyrics source must be named in `PRIVACY.md` and `THIRD_PARTY_NOTICES.md`.

## Load-bearing workarounds (look like dead code, are not)

- `YouTubeAdapter.resolve` walks `YTMUSIC`, `TV_SIMPLY`, `IOS`. Other clients return SABR-only or 403 streams.
- Decks set `crossOrigin = "anonymous"` and `handleMedia` echoes `access-control-allow-origin`; otherwise WebAudio outputs silence. `handleMedia` keeps upstream error statuses and refusals carry no body, or Chromium retries forever instead of firing `error`.
- Upstream data meant for `extractEntities` goes through raw `/browse` with `parse: true` and the unwrapped result, not `client.music.*` wrappers (they assert layouts and throw). Never use `music.getHomeFeed()`, `account.getSettings()`, `playlist.addVideos/removeVideos/moveVideo/setName/setDescription` or `music.getUpNext`; the raw equivalents already exist in the adapter.
- Playlist rows are addressed by set video id (`PlaylistItem.itemId`), read from the row menu. Never synthesise it from the video id.
- Radio queues drop `PlaylistPanelVideoWrapper` counterparts, or each song plays twice.
- Gapless: `preloadNext` and `move("next")` must agree on `nextQueueIndex`; the handoff is armed `SWITCH_LEAD_MS` before the end, never driven off `ended`. `backgroundThrottling: false` belongs to this.
- Account setting writes replay the upstream payload verbatim; never derive the body from state.
- Mix (`RD…`) pages are held once per session in `api.ts` because upstream draws a new mix per request.
- `electron-updater` is imported as a default export and destructured (CommonJS).
- `scripts/dev-app-name.mjs` renames and re-signs the dev Electron bundle; without the ad-hoc signature macOS refuses every notification.

## Architecture notes

- Platform differences are named in one place each. The window keeps its native frame (`hiddenInset` on macOS, `titleBarOverlay` elsewhere); `TITLE_BAR` in `main.ts` duplicates `--background`, `--foreground` and the header height, so change both sides together. The renderer reads its platform from `window.nixie.app.platform` and `data-platform` (`mac:` variant).
- One instance per data path (`requestSingleInstanceLock`). Development uses a separate `userData` ("Nixie (Dev)").
- Trackpad navigation on macOS reads AppKit contact phases through `electron/native/scroll-gesture.m`, built with Node-API by `scripts/build-native.mjs`. Never infer finger release from speed, idle timers or Chromium scroll end.
- Keep `id="main-scrollable-area"` on the scroll container (scroll restoration, feed paging, swipe navigation) and `class="drag-region"` on the top bar. Popups and overlays opt out of the drag region.
- Router: `defaultStaleTime` and `defaultPreloadStaleTime` are `Infinity`, `defaultRemountDeps` keys on params, no route below `__root` has an error boundary, so loaders must not throw. After a mutation invalidate only the affected pages (`invalidatePages`); `router.invalidate()` plus `dropHeldPages()` is for session, account, region, Restricted Mode or language changes.
- Home and Explore keep upstream shelf structure (`Page.sections`, `Page.explore`); do not flatten them.
- Library state (`library.ts`) and ratings (`rating.ts`) are shared stores with optimistic writes rolled back on refusal.
- `theme.ts` is the only writer of `data-theme`, and `i18n.ts` owns the language; both mirror to `localStorage` so the first frame is right. The state file stays the source of truth.
- Audio engine: stored volume is slider position, mapped through `volumeGain`. Normalization boost is capped at 6 dB; `assumedIntegratedLufs` stays -9. A deck `error` triggers one fresh resolve before failing.
- `__root.tsx` gates the app on `AuthState`: sign-in, `unentitled`, `data-refused` views or `AppShell`. There is no demo data.
- `THIRD_PARTY_LICENSES.txt` is generated by `scripts/licenses.mjs` and gitignored.
- Nixie Link in development registers the native host only with `NIXIE_LINK_DEV=1`, since both channels share the host name.

## Releasing

Releases are cut by the maintainer. "Release a new patch/minor/major version" means:

1. On `main`, in sync with `origin/main`, clean tree.
2. `pnpm release:patch|minor|major`: runs `pnpm check`, bumps, commits and signs the `chore(release): v<version>` tag, then stops.
3. `pnpm release:notes` and show the notes (generated by git-cliff from commit subjects; fix a bad line by amending, then `pnpm release:retag`).
4. `git diff v<version> HEAD --stat` must be empty; otherwise `pnpm release:retag`.
5. Report version, notes and diff result, then **stop and ask**.
6. Only on explicit go-ahead: `pnpm release:push`. The pushed tag runs `.github/workflows/release.yml` and the version is final from then on.

- Every build passes `--publish never`; only the workflow's `publish` job writes to GitHub Releases.
- Do not rename the macOS ZIPs: the updater picks the architecture by the `arm64` substring in the URL. `scripts/finish-dmgs.mjs` renames, notarizes and staples the DMGs.
- macOS signing and notarization: see `docs/signing.md`. Credentials live in the gitignored `electron-builder.env`. Windows builds are unsigned on purpose.
