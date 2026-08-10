<p align="center">
  <img src="docs/banner.png" alt="Nixie: a desktop client for YouTube Music, with gapless playback, loudness normalization and synced lyrics." width="100%">
</p>

<p align="center">
  <a href="https://github.com/NixiePlayer/NixieDesktop/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/NixiePlayer/NixieDesktop?style=flat-square&color=ff0033&label=release"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue?style=flat-square"></a>
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-lightgrey?style=flat-square">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-lightgrey?style=flat-square">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-AppImage%20x64-lightgrey?style=flat-square">
  <a href="https://github.com/sponsors/TheEdoRan"><img alt="Sponsor" src="https://img.shields.io/badge/sponsor-%E2%9D%A4-ff69b4?style=flat-square"></a>
</p>

Nixie is a desktop client for YouTube Music. It plays your account's music through a
native app instead of a browser tab: gapless playback, loudness normalization you can
actually set, time-synced lyrics, and a session that comes back exactly where you left it.

It is an independent project. There is no Nixie account, no backend and no telemetry.
Everything it knows stays on your computer.

> [!IMPORTANT]
> **Nixie is an independent, unofficial client and is not affiliated with, endorsed by,
> or sponsored by Google or YouTube.** It is not a YouTube Music product, it does not copy
> or imitate one, and nothing here speaks for Google. YouTube and YouTube Music are
> trademarks of Google LLC. It was written because I wanted a desktop client I liked
> better for my own listening, and it is shared in case anyone else wants the same thing.

> [!IMPORTANT]
> **Nixie is beta software.** Things move, and some of them break. It runs on macOS,
> Windows and Linux. The macOS builds are signed and notarized by Apple for Apple silicon
> and Intel; the Windows installer is not signed yet, so Windows warns about it the first
> time (see [Install](#install)); Linux ships as an x64 AppImage.

> [!IMPORTANT]
> **Nixie requires a YouTube Music Premium subscription.** It plays without
> advertisements, in the background, and through its own audio engine, and those are the
> things YouTube sells a subscription for. It checks when you link an account and refuses
> one that does not hold a subscription. Nixie is not a way to get Premium features
> without Premium, and it is not affiliated with or authorized by YouTube.

## Install

Grab the latest build from the [releases page](https://github.com/NixiePlayer/NixieDesktop/releases/latest):

| File | For |
| --- | --- |
| `Nixie-<version>-applesilicon.dmg` | Macs with Apple silicon, M1 and later |
| `Nixie-<version>-intel.dmg` | Intel Macs |
| `Nixie-<version>-setup.exe` | Windows 10 and 11, 64-bit |
| `Nixie-<version>-x64.AppImage` | Linux, 64-bit |

Whichever one you take, the app then checks for updates on its own, downloads them in the
background, and asks nothing of you beyond a restart. If you never restart, the update
installs the next time you quit.

**macOS.** Every release is signed and notarized by Apple, the disk image as well as the
app inside it, so it opens on a double click with no right-click trick and no Gatekeeper
warning at either step.

**Windows.** The installer is not signed, because a code signing certificate is an annual
bill this project does not have. Windows notices: SmartScreen shows a blue "Windows
protected your PC" box on the first download, and you get past it with **More info** and
then **Run anyway**. That warning is about the absence of a certificate and not about
anything found in the file, and it fades as more people install the same build. Read
[docs/signing.md](docs/signing.md) if you want the detail, and check the file against the
releases page if you did not download it from there. Installation is per-user and needs no
administrator, and updates install themselves the same way they do everywhere else.

**Linux.** An AppImage is a single file. Mark it executable with `chmod +x` and run it. It
carries a static runtime, so it needs no `libfuse2` on Ubuntu 24.04 and later. Updating
itself only works when it is run as the AppImage, which is the ordinary way to run it.

Windows Chrome and Edge need one extra step to sign in, because of how they encrypt their
cookies. [docs/extension.md](docs/extension.md) covers it, and
[How signing in works](#how-signing-in-works) below says why.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/home.png" alt="The home feed"></td>
    <td width="50%"><img src="docs/screenshots/explore.png" alt="The explore page"></td>
  </tr>
  <tr>
    <td>Your home feed, mood chips and all</td>
    <td>Explore, with charts, moods and new releases</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/lyrics.png" alt="Time-synced lyrics beside an album track table"></td>
    <td><img src="docs/screenshots/settings-playback.png" alt="Playback settings"></td>
  </tr>
  <tr>
    <td>Lyrics that follow the playhead, and seek when you click a line</td>
    <td>Loudness normalization, with a target you pick</td>
  </tr>
</table>

## Why I built it

I use YouTube Music every day and the official web app kept getting in the way. Three
things in particular, and each one is why a specific piece of this app exists.

**There is no loudness normalization you can set.** One track arrives mastered loud, the
next one quiet, and you spend the evening on the volume key. Nixie normalizes to a target
you choose: -19, -14 or -11 LUFS, the same three levels Spotify publishes, with -14 as the
default because that is what YouTube itself aims for. It reads the integrated loudness
YouTube already measured for each stream, so there is no analysis pass and no delay before
a track starts. Loud tracks are pulled all the way down; quiet ones are lifted, but never
by more than 6 dB, because YouTube publishes a loudness and not a true peak, and a quiet
master that is already peaking near full scale would clip if you lifted it blind.

**Nothing is where you left it.** Close the tab, come back, start over. Nixie saves the
queue, the current track, the exact position in it, the volume, and whether repeat and
shuffle were on. Reopen it and everything is there, paused, with the stream already
resolved so the first press of Space starts instantly. It comes back paused on purpose:
an app that starts making noise before you have asked it to is not a feature.

**Lyrics are plain text, when they are there at all.** Nixie asks three sources in
order, LRCLIB, then NetEase, then YouTube Music itself, and prefers a time-synced result
over a plain one regardless of which source it came from. Synced lyrics highlight the line
you are on, scroll to keep it in view, and seek when you click one. It stops at the first
source good enough, so most tracks never get past the first request.

Beyond those three, it is simply nicer to use: a real track table with sortable columns of
information, a persistent player, a queue you can see, keyboard shortcuts, media keys, and
Now Playing in Control Center. It is a desktop app, not a web page in a frame.

## Features

**Playback**

- Gapless playback with two audio decks. The handoff is armed before the boundary rather
  than triggered when a track ends, so joins are seamless even on a minimized window.
- Loudness normalization at -19, -14 or -11 LUFS, or off.
- A volume slider that behaves like your ears do, not like a gain multiplier.
- Queue with play next, add to queue, reorder and remove. Repeat off, all or one. Shuffle.
- Radio from any track, album, artist or playlist.
- Autoplay that extends an exhausted queue a full track before the end, so the music never
  stops to wait for a network request.
- Three audio quality levels: data saver, balanced, or highest available.

**Lyrics**

- Time-synced when a source has them, plain text when it does not, and an explicit
  "instrumental" when the track has none to find.
- Click any line to seek to it.
- Lyric requests carry no cookie and identify neither you nor the account, except to
  YouTube Music, which is asked over the session already streaming the audio.

**Library and browsing**

- The home feed with its mood chips and infinite scrolling.
- Explore, including charts per country.
- Search with live suggestions, and filters for songs, albums, artists and playlists.
- Album, artist and playlist pages.
- Create, rename, describe, reorder, edit privacy on and delete playlists. Add and remove
  tracks. Like, dislike, save to library, subscribe to artists.

**Desktop integration**

- Now Playing in Control Center on macOS, the media transport controls on Windows, with
  artwork, and hardware media keys everywhere they exist.
- A quiet notification naming the next track when the queue moves on by itself. Never
  while the window is focused, and never with a sound, because the only sound this app
  makes is the music.
- One window per install: launching Nixie again brings back the one you have rather than
  opening a second copy over the same saved session.
- Automatic updates on all three platforms.
- Keyboard shortcuts follow the platform: Cmd+K to search and the app menu's playback
  items on macOS, Ctrl+K and Ctrl+Left / Ctrl+Right on Windows and Linux.

**Privacy and security**

- No account, no backend, no telemetry, no analytics, no crash uploader.
- Sandboxed renderer, context isolation, a strict content security policy, and validated
  IPC. Media and artwork are served through a restricted custom protocol, so the renderer
  never holds a signed URL or a filesystem path.
- See [PRIVACY.md](PRIVACY.md) for exactly what is stored and what leaves the machine,
  and [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## How signing in works

Google refuses sign-in from an embedded browser window, and refuses OAuth tokens on the
endpoints this app talks to. So Nixie does not ask for your password at all. Instead it
adopts the session from a browser you are already signed in to on the same machine.

Pick a browser profile on the sign-in screen and Nixie reads that profile's YouTube
cookies. They go into a dedicated Electron session partition and nowhere else. They are
never logged, never sent anywhere except YouTube, and never exposed to the app's
interface. Google expires the session every few minutes and only the browser holds the
current value, so Nixie reads that profile again while it runs, at most once a minute, for
as long as the account stays linked. There is no password field, and no way to paste a
session by hand.

Which browsers it can read from depends on how each one stores its cookies:

| Browser | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Firefox | Yes | Yes | Yes |
| Chrome | Yes | Yes | Extension |
| Edge, Brave, Vivaldi, Chromium | Yes | Yes | Usually the extension |

Chrome 127 and later on Windows wrap the cookie key so that only the browser's own signed
binary can unwrap it. Getting at it means pretending to be Chrome, which this project will
not do, so those profiles are not offered at all rather than offered and then failing. The
[Nixie browser extension](https://github.com/NixiePlayer/nixie-connector-extension) is the
way in there: it reads its own cookies through the API the browser gives every extension,
and hands them to Nixie over the messaging channel the browser itself brokers. Nothing is
worked around, and nothing is pasted.
[docs/extension.md](docs/extension.md) is the walkthrough. The extension is optional
everywhere else, where reading the profile from disk already works.

Two smaller things worth knowing. On Windows, a browser that is running holds its cookie
file locked, so a profile can be missing from the list until you quit that browser (the
extension has no such problem). And on macOS the first read asks for your Keychain
password, which is macOS asking whether Nixie may read that browser's key.

Nixie reaches YouTube through the private interface the YouTube Music apps use, which
Google does not publish or support. Nothing about you leaves this device to anyone else,
but the account you link is talking to YouTube through an unofficial client, and it
carries whatever risk that brings.

Once the session is adopted, Nixie checks that the account holds a Music Premium
subscription, by asking YouTube what audio tiers it is willing to offer: the 256 kbps
tiers are offered to a subscriber and to nobody else. An account without one is refused
and nothing is stored for it. If that check cannot reach YouTube at all it lets you
through, because a network failure is not evidence about anybody's subscription.

Signing out clears the session and the parser cache.

## Donations

Nixie is free, MIT licensed, and has no paid tier or premium build. Nothing in the app
asks for money, and nothing is ever kept behind a donation.

What it costs is time: reading upstream responses that changed overnight, chasing a race
in the audio engine, keeping three lyric providers working, and keeping all three
platforms building from one tag.

If Nixie is what you listen to and you want to give something back,
[a donation](https://github.com/sponsors/TheEdoRan) is welcome and entirely optional. Any
amount helps, and it is the difference between this being a project I maintain and a
project I get to work on. A donation supports the person writing Nixie. It buys no
feature, no priority and no entitlement to anything on YouTube.

<p>
  <a href="https://github.com/sponsors/TheEdoRan"><img alt="Sponsor Nixie on GitHub" src="https://img.shields.io/badge/Sponsor%20on%20GitHub-%E2%9D%A4-ff0033?style=for-the-badge&logo=githubsponsors&logoColor=white"></a>
</p>

## Development

### What you need

- **Node 26** and **pnpm 11.16.0**, both exactly. `engines` is strict and `.node-version`
  is there for anyone using a version manager.
- **macOS, Windows or Linux.** All three work, and `pnpm check` runs on Ubuntu and Windows
  in CI. On macOS you also want the Xcode command line tools (`xcode-select --install`),
  since the dev setup script uses `plutil`, `sips` and `codesign` there; off macOS that
  script does nothing and there is no setup step of its own.

You do not need an Apple Developer account to build and run the app. That is only for
producing signed, notarized macOS releases, and [docs/signing.md](docs/signing.md) covers
it. Windows and Linux releases are unsigned, so they need nothing at all.

### Getting it running

```sh
git clone https://github.com/NixiePlayer/NixieDesktop.git
cd NixieDesktop
pnpm install
pnpm dev
```

On macOS the app opens with a blue icon and calls itself Nixie (Dev). Elsewhere it is the
stock Electron window with its own icon, since there is no bundle to rename. Sign in by
picking a browser profile, the same as the released app.

A few things happen on the way there that are worth knowing about, because they look
strange if you meet them by surprise:

- On macOS, `pnpm install` runs `scripts/dev-app-name.mjs`. It renames the bundled Electron app to
  `Nixie.app`, sets its display name to "Nixie (Dev)", paints its icon blue, and then
  re-signs it ad hoc. That last step matters: editing an Electron bundle's `Info.plist`
  breaks the signature it ships with, and macOS silently refuses notifications from an app
  whose signature does not validate. The same script runs again on every `pnpm dev`, since
  anything that re-extracts `node_modules/electron` puts the stock bundle back.
- `pnpm dev` starts Vite on port 3000 for the renderer and compiles the main process and
  preload into `dist-electron/`, then launches Electron against them. All three reload on
  save.
- The dev build stores its data under `Nixie (Dev)`, separate from the released app. Its
  linked account, settings and playback state are its own, and you can run both
  at once.

### Before you push

```sh
pnpm check
```

That is the whole gate, and it is what CI runs on every pull request, on Ubuntu and on
Windows. In order it does formatting (`oxfmt`), linting (`oxlint`), type checking
(`tsc --noEmit`), unit tests (`vitest`), route generation (`tsr generate`), and a
production build. Run one test file on its own with
`pnpm vitest run src/lib/audio-engine.test.ts`, or `pnpm vitest` to watch.

To build an installable app for the platform you are on:

```sh
pnpm package:mac    # an app directory, ad-hoc signed
pnpm package:win    # the NSIS installer, unsigned
pnpm package:linux  # the AppImage
```

Each one has to run on the platform it names. The Windows and Linux builds print a
"skipping afterSign hook as no signing occurred" warning from electron-builder, which is
expected: those hooks are the macOS notarization steps, and there is nothing for them to
do.

### Where things are

| Path | What lives there |
| --- | --- |
| `electron/` | Main process: the YouTube adapter, the secure protocols, cookie import, lyrics, state, logging |
| `electron/native-host/` | The relay the browser launches for the extension sign-in path |
| `src/routes/` | Pages, as TanStack Router file routes with hash history. Data loading is loaders, there is no query client |
| `src/components/` | The shell, player bar, panels and dialogs. `ui/` is generated shadcn source |
| `src/lib/` | Renderer logic. `audio-engine.ts` owns playback and is framework-free and unit tested |
| `src/shared/` | Contracts and pure logic used on both sides of the process boundary |
| `scripts/` | Dev setup and release hooks |
| `build/` | Icons that electron-builder packages |

[AGENTS.md](AGENTS.md) is the architecture document. It is long, but it records why things
are the way they are, including several places where the obvious approach is the broken
one. Read the section covering whatever you are about to touch.

## Contributing

Bug reports, fixes and features are all welcome. Open an issue before starting anything
large, so nobody spends a weekend on a direction that was never going to land.

[CONTRIBUTING.md](CONTRIBUTING.md) has the conventions, the verification loop, and the
short list of things that will get a pull request turned down.

## Licence and legal

Nixie is [MIT licensed](LICENSE). See also [PRIVACY.md](PRIVACY.md),
[SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Every build
also ships the full licence text of every open source package inside it, generated from the
dependency tree and readable in Settings, under About.

Nixie is an independent, unofficial client. It is not affiliated with, endorsed by, or
sponsored by YouTube, Google, Spotify, LRCLIB, or NetEase Cloud Music. YouTube and YouTube
Music are trademarks of Google LLC, used here only to say what Nixie connects to, and
no name, logo or interface of theirs is copied or imitated. You need your own YouTube
Music account to use it, and your use of that account remains subject to YouTube's terms.
Nothing in this project is meant to disparage YouTube Music, YouTube or Google: it exists
because I wanted a different desktop client for my own listening, not as a replacement for
or a criticism of theirs. If Google or YouTube would like anything here changed, please
[open an issue](https://github.com/NixiePlayer/NixieDesktop/issues) and it will be
dealt with.
