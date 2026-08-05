# Privacy

Noctune is local-first. It has no Noctune account, backend, telemetry, analytics, crash uploader, advertising SDK, or media cache.

The app stores playback restoration, preferences, bounded loudness measurements, recent searches, window bounds, and the YouTube parser cache on this computer. Website cookies remain in a dedicated Electron session. Lyrics are fetched when requested and are not persisted.

A play is reported to YouTube Music's watch history over the same signed-in session, once when it starts and once with the position it reached, so what you listen to here shapes the recommendations the app then shows you. Nothing about the play is kept locally, and turning off watch history in Settings stops the report. It is the only thing Noctune sends anywhere that was not asked for by a page you opened.

Settings reads and writes a handful of settings that belong to the linked account rather than to this computer: whether liked music from YouTube appears in your playlists, whether queues and radios update dynamically, and whether watch and search history are paused. Those are the account's own settings, so a change made here applies to every app signed in to it, exactly as it would if it were made in YouTube Music. They are read on request and never stored locally. Every other setting on that page, including theme, audio quality, normalization, content region, and restricted mode, stays on this computer and is sent nowhere.

Diagnostics are exported only when requested. Logs redact cookies, authorization values, signed URLs, lyrics, and media data.

YouTube Music, LRCLIB, and NetEase Cloud Music receive the requests needed to provide their services and apply their own policies. A lyrics lookup asks them in order and stops as soon as one answers, so the later sources are reached only when the earlier ones came back empty. LRCLIB and NetEase are sent a title, an artist, and a length, with no cookie and nothing that identifies the account. YouTube Music is asked over the same signed-in session that streams the audio, so that request is tied to the linked account like every other request to it. Clearing all local data removes Noctune state, measurements, and the website session.

Noctune is an independent project. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, Spotify, LRCLIB, or NetEase Cloud Music.
