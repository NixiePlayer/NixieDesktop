# Third-party notices

Noctune is an independent, unofficial client. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, Spotify, LRCLIB, or NetEase Cloud Music. Every product name and trademark mentioned below belongs to its owner and is used only to identify what Noctune connects to or depends on. YouTube and YouTube Music are trademarks of Google LLC.

The application includes open source packages recorded in `pnpm-lock.yaml`. Their copyright and license metadata is distributed with the packaged application where required.

## YouTube.js

`youtubei.js` is an unofficial client for YouTube's private InnerTube API. Its inclusion does not grant rights to YouTube content or override YouTube terms.

## Lyrics sources

Lyrics are retrieved at playback time and are not persisted. Three sources are asked in order, and the lyric-rights review covers all of them:

- **LRCLIB**, a public community database of synchronized lyrics.
- **NetEase Cloud Music**, through undocumented public endpoints that require no key and no account. There is no published licence covering this use, and no stability guarantee.
- **YouTube Music**, through the same signed-in InnerTube session that streams the audio. Its lyrics are licensed by a third party, which the response names, and the application shows that credit verbatim instead of its own.

Public distribution remains subject to a separate lyric-rights review.
