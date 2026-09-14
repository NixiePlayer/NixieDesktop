# Nixie context

## Glossary

- **Nixie**: the local Electron application.
- **InnerTube**: YouTube's private, undocumented application API.
- **Website session**: YouTube cookies stored only in Electron's `persist:nixie-auth` partition.
- **Native messaging host**: `electron/native-host/host.cjs`, the dependency-free relay a browser launches to reach the running app. It holds nothing and moves JSON in both directions, cookies in one.
- **Extension source**: a browser profile connected through the Nixie extension, identified to the app only by an opaque install id the extension generates.
- **App-bound encryption**: Chrome 127 and later on Windows wrapping the cookie key so only the browser's own signed binary can unwrap it. Such a profile is unreadable by design and is hidden from the sign-in list.
- **Media token**: a random, short-lived identifier resolved by `nixie://app/media/<token>`.
- **Variant fingerprint**: itag, MIME type, codec, bitrate, and duration.
- **Content loudness**: the integrated loudness YouTube measured for a variant, in LUFS. The same number YouTube's stats for nerds shows.

## ADR 001: Unofficial InnerTube access

**Status:** accepted for v1

Nixie uses pinned `youtubei.js` 17.2.0 in Electron's main process. The renderer receives plain DTOs, opaque continuation values, proxied artwork, and opaque media tokens. Parser objects, cookies, signed URLs, and arbitrary upstream URLs stay in main.

Authentication adopts the YouTube session from a browser profile on this device, through one of two doors, and main writes the cookies into the auth partition either way. `electron/browser-cookies.ts` reads a profile's cookie store off disk: Chromium forks on macOS (Keychain key, AES-128-CBC), on Linux (Secret Service key, same cipher) and on Windows (DPAPI-wrapped key, AES-256-GCM), plus Firefox on every platform, which encrypts nothing. `electron/native-host-server.ts` and `electron/native-host/host.cjs` are the other door: a browser extension in its own repository reads its own cookies through `chrome.cookies` and hands them over Chrome native messaging to a per-user pipe guarded by a per-install token. That door exists because Chrome 127 and later on Windows bind the cookie key to the browser's own signed binary, and reaching it would mean impersonating the browser, which this project refuses: such a profile is hidden from the sign-in list rather than attempted. Google rejects sign-in from an embedded window whatever user agent it presents, and OAuth device tokens are refused by every InnerTube endpoint, so neither path exists, and a browser session on this device is the only way in. Cookie values are never logged. Sign out clears the partition and YouTube parser cache.

This accepts private API breakage, account enforcement changes, and YouTube policy risk. A failed media or decipher gate blocks distribution. It does not justify disabling `webSecurity`, Node integration, sandboxing, or context isolation.

## ADR 002: Spotify-like loudness normalization

**Status:** accepted for v1

Playback targets -14 LUFS, the same target YouTube normalizes to:

```text
appliedGainDb = min(-14 - integratedLufs, 0)
```

YouTube already measures every variant it serves and publishes the result on the format itself, so Nixie reads that instead of measuring locally. This removed a bundled FFmpeg `loudnorm` pass, its LGPL redistribution duties, and the measurement cache that went with it: a second decode of every track to recover a number the response already carried.

Gain is attenuation only, because YouTube reports no true peak and YouTube itself never raises quiet content either. It is fixed before a track starts and never changes during that play. A variant without loudness metadata plays at unity.
