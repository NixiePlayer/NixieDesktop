# Contributing to Nixie

Thanks for looking. Bug reports, fixes and features are all welcome.

## Before you write code

Open an issue first for anything beyond a small fix.

Nixie has opinions, and most of them are written down in [AGENTS.md](AGENTS.md) with the
reasoning attached. A fair number of the obvious approaches in this codebase were tried and
do not work: the YouTube client that returns streams with no URL, the wrapper that throws
on today's response, the handoff driven off the `ended` event that arrives too late. A pull
request that reverts one of those without knowing it costs you a weekend and me an awkward
review. Ten minutes in an issue is cheaper for both of us.

Small and obvious fixes need no ceremony. Send them.

## Setup

See [Development](README.md#development) in the README. Short version: Node 26, pnpm
11.16.0, then `pnpm install && pnpm dev`.

macOS, Windows and Linux all work for development. On macOS you also want the Xcode command
line tools, since `scripts/dev-app-name.mjs` uses `plutil`, `sips` and `codesign` to rename
and re-sign the development Electron bundle; off macOS that script is a no-op and there is
nothing extra to install. Line endings are LF everywhere, which `.gitattributes` enforces on
checkout: oxfmt is LF-only, so a CRLF working copy fails `pnpm fmt` on every file at once.

Building an installable app is one command per platform, and each has to run on the platform
it names:

```sh
pnpm package:mac    # app directory, ad-hoc signed
pnpm package:win    # NSIS installer, unsigned
pnpm package:linux  # AppImage
```

The Windows and Linux builds print a "skipping afterSign hook as no signing occurred"
warning. That is expected: the hooks are the macOS notarization steps.

## The rules

None of these are new. They are the rules the codebase already follows, collected here so
you do not find out about them in review.

**No em dashes.** Anywhere. Code, comments, documentation, tests, commit messages. Use
commas, colons, parentheses or ordinary hyphens.

**Conventional Commits.** `type(scope): subject`, with a scope when the change has an
obvious one (`player`, `electron`, `explore`, `settings`) and none when it spans the
repository. Add a body whenever the subject cannot carry the reasoning on its own: what was
wrong, why this change, what it costs. Release notes are generated from these commits, and
a commit that does not follow the format is dropped from them silently.

**Exact dependency versions.** `.npmrc` sets `save-exact=true`. Ranges are not allowed. And
before adding a dependency at all, check whether a few lines of code do the job. This
project has ten runtime dependencies and would like to keep it that way.

**Do not weaken the security model.** The sandbox, context isolation, the content security
policy, IPC sender validation and `webSecurity` stay on. If an upstream failure seems to
need one of them turned off, it does not, and the workaround belongs in an issue. Equally:
never log cookies, authorization values, signed URLs, filesystem paths or lyric text.

**`src/components/ui/` is generated.** It is shadcn and Base UI source. Change it through
the shadcn CLI, not by hand.

**Keep AGENTS.md current.** If you change the structure, the commands, a convention or a
workflow, update the section that describes it in the same commit.

## Verifying your work

```sh
pnpm check
```

This is the gate. It runs formatting, linting, type checking, unit tests, route generation
and a production build, in that order, and CI runs exactly the same command on every pull
request, on `ubuntu-latest` and on `windows-latest`. Run it before you push and there are no
surprises. If you work on one platform and the other leg fails, it is usually a path
assumption or a shelled-out command: pnpm is a `.cmd` on Windows, so `execFile` needs a shell
there, and `path.relative` does not contain a path across drive letters.

While you are working:

```sh
pnpm fmt:fix                                  # format
pnpm lint:fix                                 # lint with autofixes
pnpm typecheck                                # types only
pnpm vitest                                   # tests, watching
pnpm vitest run src/lib/audio-engine.test.ts  # one file
```

## Tests

Vitest, in a node environment. Test files sit next to what they test, as `*.test.ts`.

What is tested is the pure part: the audio engine, the queue, entity extraction, loudness,
LRC parsing, validation, the cookie reader, the media protocol. Components are not tested,
and adding a component testing setup is a decision worth an issue rather than a surprise in
a pull request.

If you fix a bug in that pure layer, a test that fails before your change and passes after
it is the best thing you can attach to it.

## Where things go

| Path | What lives there |
| --- | --- |
| `electron/` | Main process. Privileged: cookies, the YouTube adapter, secure protocols, disk, lyrics fetching |
| `src/routes/` | Pages, as TanStack Router file routes. Data loading is loaders only |
| `src/components/` | Shell, player bar, panels, dialogs. `ui/` is generated |
| `src/lib/` | Renderer logic, including the framework-free audio engine |
| `src/shared/` | Everything used on both sides of the process boundary |
| `scripts/` | Dev setup and release hooks |
| `build/` | Icons electron-builder packages, plus the NSIS installer script |

The browser extension that carries the Windows Chrome and Edge sign-in path is not in this
repository. It lives at
[NixiePlayer/nixie-link-extension](https://github.com/NixiePlayer/nixie-link-extension),
and what is here is the app's half: the native messaging host under `electron/native-host/`
and the registration and pipe server beside it. The two use a fixed extension id for routing
and a private pairing protocol for authentication, so a protocol change to one is usually a
change to both.

One rule about `src/shared/` worth stating on its own: anything in there crosses an IPC
boundary, so it has to be serializable and pure. No Electron imports, no DOM, no upstream
parser objects. Entity narrowing lives in `src/shared/entities.ts` rather than in the
components that render entities.

Before editing routes or the router, run the matching TanStack Intent command listed at the
top of [AGENTS.md](AGENTS.md).

## Pull requests

- One concern per pull request. A fix and a refactor in the same diff are two reviews
  wearing one hat.
- Describe what was wrong and what your change costs, not just what it does.
- Include a screenshot or a short clip for anything that changes the interface.
- Confirm `pnpm check` passes. CI will tell you either way, but knowing first is faster.

## Conduct

Be decent. Assume the person on the other end is trying to help and has less context than
you do. No harassment, no personal attacks, no bad faith. Anything that needs raising
privately goes to edoardo@ranghieri.com.

## Releases

Releases are cut by the maintainer. The version bump, the tag and the push are one
deliberate sequence documented in [AGENTS.md](AGENTS.md), and pushing the tag is what builds
macOS, Windows and Linux and publishes a release that installed copies on all three will
update themselves to. Please do not open a pull request that bumps the version.
