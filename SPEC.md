# Noctune product specification

## Purpose

Noctune is a private, local-first desktop music player for a user's YouTube Music account, for macOS, Windows, and Linux. It combines YouTube Music browsing and library access with a calm, familiar interface, synchronized lyrics, persistent playback, playlist management, and Spotify-like loudness normalization.

The app is an independent client. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, Spotify, or LRCLIB.

## Product goals

- Make a YouTube Music account feel like a polished native desktop music library.
- Keep account credentials, playback state, and analysis data on the user's own computer.
- Provide consistent perceived volume without clipping or changing gain during a track.
- Make search, browsing, queue control, and playlist editing fast from one persistent shell.
- Ship a signed desktop app for macOS, Windows, and Linux. macOS is the first target, notarized for Apple silicon and Intel.

## Experience and visual direction

- Read as a YouTube Music client rather than a separate product with its own identity. Noctune is the name, not a brand to dress the interface in.
- Keep the interface quiet and unornamented. Content is the artwork and the type; nothing decorative competes with it.
- Use a single red accent on neutral surfaces: `#ff0033` on `#0f0f0f` in dark, `#cc0000` on `#ffffff` in light. Reserve red for fills, the active state, and playback progress. Never use it for body text.
- Use Inter for every role. Set weight and size, not a second typeface.
- Present artwork as squares with an 8px radius. Circles are for artists only.
- Provide dark, light, and system themes. Resolve `system` to a concrete theme before the first paint and follow live system appearance changes.
- Keep a collapsible navigation rail, persistent top bar, main content area, and bottom player visible across routes. Open the lyrics and queue panel from the player bar rather than reserving space for it.
- Show playback progress as a full-width line along the top edge of the player bar, and mark the playing row with an animated level indicator rather than a text badge.
- Limit motion to state that is genuinely changing, and respect `prefers-reduced-motion`.
- Ship no control that does nothing. A control that is not implemented is not drawn.
- Enforce a practical desktop minimum window size instead of building for phone widths.
- Preserve keyboard usability, visible focus states, semantic labels, tooltips, loading skeletons, empty states, errors with retry actions, and accessible form controls.

## Account connection

- Connect to YouTube Music by adopting the session from a signed-in browser profile on this device. Google rejects sign-in from an embedded window and refuses OAuth device tokens on every InnerTube endpoint, so neither is offered.
- Store website cookies only in the dedicated `persist:noctune-auth` Electron partition.
- List browser profiles that hold a YouTube session and let the user pick which one to continue.
- Provide guided Cookie request-header import as a fallback for unsupported browsers.
- Validate imported Cookie headers, clear the input after import, and never log or expose cookie values.
- Show signed-in account state and support sign-out.
- On sign-out, clear the website session and YouTube parser cache.

## Home and navigation

- Provide Home, Search, Your Library, Settings, album, artist, and playlist views using TanStack Router with hash history.
- Support browser-style back and forward navigation.
- Provide a collapsible sidebar with collected playlists and a new-playlist entry point.
- Provide a global command palette opened by `Command-K` with search and quick navigation.
- Show a curated home hero and browsable media sections sourced from the YouTube Music home feed.
- Open albums, artists, and playlists in dedicated detail views.

## Search

- Search YouTube Music for tracks, albums, artists, playlists, and moods.
- Store the query and result filter in the route search parameters.
- Support All, Songs, Albums, Artists, and Playlists filters.
- Fetch suggestions after a short debounce and display them with the native suggestion UI.
- Keep a bounded, deduplicated list of recent searches locally.
- Provide clear empty states for an empty query and no results.
- Support opaque continuation values for paginated upstream results.

## Library and catalog

- Browse the connected user's complete YouTube Music library.
- Filter the library by playlists, albums, artists, and songs.
- Support grid and list presentation controls.
- Show artwork, title, artist, album, year, duration, explicit status, and item counts when available.
- Provide album pages with metadata, a full track table, and play-album action.
- Provide artist pages with popular tracks, discography, play, subscribe or unsubscribe, and start-radio actions.
- Provide playlist pages with metadata, tracks, and play-playlist action.

## Playlist and account mutations

- Create playlists with a title and optional description.
- Edit playlist title and description.
- Add tracks to playlists.
- Remove tracks from playlists.
- Reorder playlist items.
- Apply playlist changes optimistically, then roll them back with visible feedback if YouTube Music rejects the mutation.
- Like, dislike, or clear the rating of a track.
- Subscribe to or unsubscribe from an artist.
- Report playback history and watch position to YouTube Music.
- Validate every mutation payload before it crosses into privileged code.

## Playback

- Play the selected track in the context of an album, playlist, search result, library view, or radio queue.
- Provide play, pause, previous, next, seek, volume, shuffle, repeat-all, repeat-one, and repeat-off controls.
- Show current position and track duration.
- Preload the next track on a second audio element for faster transitions.
- Keep the current track, queue, queue index, position, volume, repeat mode, shuffle state, and normalization state locally.
- Restore the previous session in a paused state after restart.
- Support native application-menu playback commands and browser Media Session commands.
- Prefer Opus audio and fall back to AAC.
- Offer Data Saver, Balanced, and Highest Available quality choices.
- Show loading and playback error states without crashing the application.

## Queue and now-playing panel

- Show the current track, artwork, title, and artists in the persistent player.
- Show the active queue and mark the playing item.
- Provide a Lyrics and Queue tab switcher.
- Keep player controls available while browsing any route.

## Synchronized lyrics

- Fetch lyrics only when a track is requested, from LRCLIB, then NetEase Cloud Music, then YouTube Music.
- Ask those sources in order and stop at the first result nothing later could improve on.
- Rank every answer by quality before source: synchronized, then an instrumental marking, then plain text.
- Try LRCLIB's exact track, artist, album, and duration match first, then fall back to its search.
- Choose a NetEase song by length before spending a second request on its lyrics.
- Parse synchronized LRC timestamps, including multiple timestamps on one line.
- Discard the writing and production credits NetEase stamps as lyric lines at the head of a file.
- Reject fallback matches whose durations differ by more than the allowed tolerance, and keep matches where either side states no duration.
- Highlight and smoothly center the active lyric line during playback.
- Seek when the user selects a synchronized lyric line.
- Render an untimed source as a static block, without a highlight or seeking.
- Credit the source, or the licensor it names, under the lyrics.
- Handle instrumental tracks and missing synchronized lyrics.
- Rate-limit LRCLIB requests and perform one bounded retry after a `429` response.
- Send no cookies to any lyrics source.
- Do not persist or log lyric text.

## Loudness normalization

- Provide optional Spotify-like loudness normalization targeting `-14 LUFS`.
- Take the integrated loudness YouTube already measured for the selected variant, which InnerTube reports as `trackAbsoluteLoudnessLkfs`, or as an offset from the same target in `loudnessDb`.
- Compute gain as:

  ```text
  appliedGainDb = min(-14 - integratedLufs, 0)
  ```

- Attenuate only. Never apply positive gain, because no true peak is available.
- Fall back to no gain when a variant carries no loudness metadata.
- Fix gain before playback starts and never change it during that play.
- Show the applied normalization gain in the player.

## Local data and privacy

- Operate without a Noctune account, backend, telemetry, analytics, crash uploader, advertising SDK, or media cache.
- Persist only playback restoration, settings, recent searches, window bounds, account display metadata, logs, and the bounded YouTube parser cache.
- Write local state atomically with user-only file permissions.
- Recover safely from corrupt state by preserving the corrupt file and loading defaults.
- Allow the user to clear playback session data or all local data.
- Allow explicit export of redacted diagnostics.
- Never log cookies, authorization values, signed URLs, arbitrary URLs, upstream parser objects, filesystem paths, lyric text, or media data.
- State clearly that YouTube Music and LRCLIB receive the requests required to provide their services.

## Security

- Keep Electron renderer sandboxing, context isolation, Content Security Policy, sender validation, and `webSecurity` enabled.
- Disable Node integration in renderers.
- Expose only a small, typed preload bridge for authentication, music queries and mutations, media resolution, media commands, and local state.
- Validate and bound all IPC payloads at the main-process trust boundary.
- Keep `youtubei.js`, cookies, signed media URLs, deciphering, network adapters, and filesystem access in the privileged process.
- Convert upstream parser objects into serializable application DTOs before returning data to the renderer.
- Proxy artwork and audio through the secure `noctune://app` protocol using random, short-lived opaque tokens.
- Support valid bounded, open-ended, and suffix byte ranges without exposing upstream media URLs.
- Deny unexpected navigation, popups, permissions, protocols, and external hosts.
- Open only allowlisted HTTPS links in the system browser.
- Run restricted decipher evaluation in a short-lived, capability-free utility process with a hard timeout.
- Never weaken security controls to work around an upstream failure.

## Reliability and upstream behavior

- Pin all dependency versions and account for breakage from YouTube's private InnerTube API.
- Keep continuations opaque and expiring rather than exposing upstream pagination objects.
- Bound parser cache size and prune the oldest files first.
- Bound queues, recent searches, query lengths, identifier lengths, and batch mutation sizes.
- Fail safely when authentication expires, media cannot be resolved, loudness metadata is absent, lyrics are missing, local state is corrupt, or an upstream mutation fails.

## Technical constraints

- Use Node 24.15.0 and pnpm 11.16.0 with exact dependency versions.
- Build the desktop application with Electron, React, TypeScript, Vite, TanStack Router, Tailwind CSS, and shadcn/Base UI.
- Keep privileged integrations in `electron/`, serializable cross-process contracts and pure logic in `src/shared/`, and file routes in `src/routes/`.
- Use `youtubei.js` 17.2.0 for private InnerTube access.
- Use the custom secure protocol for packaged assets, artwork, lyrics access, and media streaming.
- Package the app with an ASAR archive and an application icon, plus the macOS hardened runtime and music-app category.
- Produce unsigned local app directories for development and signed release artifacts for each platform, DMG and ZIP on macOS.
- Target both `arm64` and `x64` on every platform.

## Verification and release requirements

- Formatting, linting, TypeScript checking, unit tests, route generation, and a production build must pass through `pnpm check`.
- Tests must cover queue boundaries, repeat and shuffle behavior, normalization attenuation, LRC parsing, duration matching, byte-range parsing, IPC validation, state recovery, atomic persistence behavior, and parser-cache pruning.
- Distribution must remain blocked unless:
  - Authentication has been tested.
  - Media byte-range behavior has been tested.
  - PCM playback has been tested.
  - Lyrics rights have been reviewed.
  - Media resolution and restricted decipher evaluation gates pass.
- macOS release artifacts must be notarized when Apple credentials are configured.

## Explicit non-goals

- No Noctune cloud service or cross-device synchronization.
- No storage of raw audio or offline media downloads.
- No exposure of cookies or direct signed media URLs to renderer code.
- No affiliation claim or pixel-for-pixel clone of another music product.
- No bypass of YouTube account enforcement, DRM, Electron security, or platform policy.
