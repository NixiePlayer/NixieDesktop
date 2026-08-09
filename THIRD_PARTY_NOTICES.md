# Third-party notices

Nixie is an independent, unofficial client. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, Spotify, LRCLIB, or NetEase Cloud Music. Every product name and trademark mentioned below belongs to its owner and is used only to identify what Nixie connects to or depends on. YouTube and YouTube Music are trademarks of Google LLC.

## Open source packages

The application bundles the packages recorded in `pnpm-lock.yaml`. Their build inlines them and drops the license headers, so the full text of every one is collected instead into `THIRD_PARTY_LICENSES.txt`, which is generated from the dependency tree on every build, shipped inside the application, and readable in Settings under About. Electron and Chromium are not in that file: electron-builder packages their notices itself, as `LICENSE.electron.txt` and `LICENSES.chromium.html`.

Most of those packages are MIT. Four are worth naming here because their terms ask for more than a mention:

- **Inter**, through `@fontsource-variable/inter`, under the SIL Open Font License 1.1. The font binaries are redistributed inside the application, so the license travels with them.
- **class-variance-authority**, under Apache License 2.0.
- **lucide-react**, under the ISC license.
- **`@bufbuild/protobuf`**, under Apache License 2.0 and BSD-3-Clause together.

## YouTube.js

`youtubei.js` is an unofficial client for YouTube's private InnerTube API. Its inclusion does not grant rights to YouTube content or override YouTube terms.

## Lyrics sources

Lyrics are retrieved at playback time and are not persisted. Three sources are asked in order, and the lyric-rights review covers all of them:

- **LRCLIB**, a public community database of synchronized lyrics. It publishes no license for its database and no terms for its API, so nothing here is granted and nothing is claimed. Requests carry a user agent naming this application, and no more than one request is sent every 350 milliseconds.
- **NetEase Cloud Music**, through undocumented public endpoints that require no key and no account. There is no published licence covering this use, and no stability guarantee. The requests carry a `Referer` of `https://music.163.com`, because the endpoints answer an off-site referrer with an error body instead of results.
- **YouTube Music**, through the same signed-in InnerTube session that streams the audio. Its lyrics are licensed by a third party, which the response names, and the application shows that credit verbatim instead of its own.

Every result names its source under the text, or the licensor the source names.

None of these three holds the rights to the lyrics themselves. Those belong to the publishers, and a database that collects them cannot pass on what it was never granted. Public distribution therefore remains subject to a separate lyric-rights review, which the `lyrics-rights` release gate blocks on.
