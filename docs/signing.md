# Signing and notarizing Noctune for macOS

This is the macOS half of the release. Notarization, stapling, Gatekeeper and the Developer ID
certificate are Apple's alone, and every command here needs a Mac to run on. Windows and Linux
artifacts are signed their own way and are not covered by this document.

Everything below assumes the repository as it stands: there is no `mac.identity` in the build
config and no entitlements file, because electron-builder finds the certificate in your keychain by
itself and the default entitlements it writes under `hardenedRuntime` are the three Electron needs
(`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`). Nothing here asks
you to override any of that.

## 1. Create the certificate (once, on your Mac)

1. You need a paid Apple Developer Program membership, with your Apple ID holding the Account
   Holder or Admin role on the team. Notarization is not available without it, and neither is the
   certificate type below.
2. Xcode, Settings, Accounts, select your Apple ID, select the team, **Manage Certificates**,
   **+**, **Developer ID Application**. Xcode generates the key pair and installs the identity into
   your login keychain.
3. Check it landed:

   ```sh
   security find-identity -v -p codesigning
   ```

   You want a line reading `Developer ID Application: Your Name (TEAMID)`. An
   `Apple Development` identity is not a substitute: for a non-MAS distribution build
   electron-builder looks for `Developer ID Application` and nothing else, so a build with only the
   development certificate fails to sign. Keep exactly one `Developer ID Application` identity in
   the keychain, otherwise electron-builder cannot choose between them.
4. Mint an app-specific password for notarization at account.apple.com, under Sign-In and Security,
   App-Specific Passwords. Your normal Apple ID password does not work.

Nothing from this step is committed. No certificate, no key, no identity name in the config.

## 2. Point the build at your credentials

Copy the template and fill it in:

```sh
cp electron-builder.env.example electron-builder.env
```

```sh
APPLE_ID=you@example.com
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
NOCTUNE_RELEASE_GATES_ACCEPTED=auth,range,pcm,lyrics-rights
```

`electron-builder.env` is gitignored, is read by electron-builder's own CLI from the project root,
and is in electron-builder's default exclusion list, so it can never be packed into the app. A
variable already exported in your shell wins over the file. `pnpm release:gate` runs as a process of
its own and reads the same file through `--env-file-if-exists`.

The certificate is deliberately absent from that file. Locally the keychain identity from step 1 is
the signature. `CSC_LINK` and `CSC_KEY_PASSWORD` exist only for CI, where there is no keychain.

## 3. Build a signed and notarized release locally

```sh
pnpm dist
```

That runs the release gates, builds, signs with the keychain identity, notarizes, staples the
ticket to the app, and produces the DMG and ZIP for both architectures under `release/`.

Verify the result:

```sh
codesign -dv --verbose=4 release/mac-arm64/Noctune.app 2>&1 | grep -E "Authority|Runtime"
spctl -a -vvv -t install release/mac-arm64/Noctune.app
xcrun stapler validate release/mac-arm64/Noctune.app
```

`spctl` must report `source=Notarized Developer ID`. `stapler validate` must report that the ticket
is present, which is what lets a downloaded copy open on a Mac that is offline or behind a firewall.
`release/mac-arm64` is the arm64 slice and `release/mac` the x64 one, and both ship, so run those
three against each.

Notarization takes a few minutes per architecture and the build waits on Apple, so `pnpm dist` is
not the command for ordinary iteration. The first submission a team ever makes is the exception
worth knowing about before you sit through it: with no history behind the account Apple vets it
apart from the routine path, and hours rather than minutes is normal. Every submission after it
goes at the usual speed. Run a long one under `caffeinate -is pnpm dist`, since a Mac that sleeps
mid-wait drops the connection `notarytool` is holding open.

That dropped connection is a failure mode of its own, and it does not mean what it says:

```
⨯ Failed to notarize via notarytool.  Failed with unexpected result:
Error: HTTPError(statusCode: nil, error: ... Code=-1001 "The request timed out."
```

`-1001` is this Mac giving up on the HTTPS poll, not Apple rejecting the build. The submission
carries on server side, and its id is in the failing URL, so ask about it rather than assume the
worst:

```sh
xcrun notarytool info <submission-id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

`Accepted` there means Apple did its part and only the packaging was lost. `xcrun stapler staple`
attaches the ticket to the app already sitting in `release/`, which is the one thing
`scripts/staple.mjs` never got to do, and re-running `pnpm dist` is safe: it submits afresh, which
by then is the fast path.

## 4. Local builds that skip all of it

```sh
pnpm package
```

builds an ad-hoc signed app directory and never contacts Apple, even with the credentials sitting in
`electron-builder.env`. `mac.notarize` is `false` in the config and only `pnpm dist` turns it on
with `-c.mac.notarize=true`. That direction is the one that works: electron-builder coerces only
`mac.identity` from a string to a boolean, so a `false` passed as a CLI flag would arrive as the
truthy string `"false"`, while the skip test is a strict `=== false`.

Ad-hoc rather than unsigned because macOS refuses notifications from a bundle whose signature does
not validate. `pnpm dev` is unaffected and needs nothing from this document: `scripts/dev-app-name.mjs`
re-signs the renamed development bundle ad-hoc for that same reason, and a trusted signature would
buy nothing there and be wiped by the next `pnpm install`.

## 5. GitHub Actions

The workflow at `.github/workflows/release.yml` already consumes everything below. There is no
keychain-creation step to write: electron-builder imports `CSC_LINK` into a temporary keychain of
its own.

1. Keychain Access, **My Certificates**, right-click `Developer ID Application: ...`, **Export**,
   save as `.p12`, set a password. Exporting from that tab is what includes the private key.
2. Encode it:

   ```sh
   base64 -i DeveloperID.p12 | pbcopy
   ```

3. Repository Settings, Secrets and variables, Actions, add:

   - `CSC_LINK`, the base64 blob
   - `CSC_KEY_PASSWORD`, the `.p12` password
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
   - `NOCTUNE_RELEASE_GATES_ACCEPTED`, `auth,range,pcm,lyrics-rights`

4. Delete the `.p12` from disk.
5. Cut a release with `pnpm release:patch` (or `:minor`, `:major`), read what it is about to publish
   with `pnpm release:notes`, then `pnpm release:push`. The tag arriving on the remote is what runs
   the workflow, there is nothing to start from the Actions tab. Everything before that push is
   local and free to redo: `pnpm release:retag` moves the tag onto a fix committed after the bump,
   and the version stays the one nobody has seen. After the push it is a fact, and the only way out
   of a bad release is the next one.

No token has to be created for the publish itself. `GH_TOKEN` in the build step is the
`secrets.GITHUB_TOKEN` Actions mints for the run, and `permissions: contents: write` on the job is
what lets it write a release. electron-builder infers the GitHub provider from the `repository`
field in `package.json`, uploads the DMGs, the ZIPs and the `latest-mac.yml` the installed app
reads for updates, and leaves the release a draft until the step after it attaches the generated
notes and publishes it.

## Certificate maintenance

Expiry costs nothing that is already shipped. The signature carries a secure timestamp, so
Gatekeeper judges whether the certificate was valid when the app was signed rather than whether it
is valid today, and the notarization ticket is Apple's own and outlives the certificate either way.
An installed copy keeps opening indefinitely. What expiry costs is the ability to sign something
new, which is to say the next release and nothing else.

A Developer ID Application certificate is issued for five years, but a leaf cannot outlive the
intermediate that signed it, and Apple's original `Developer ID Certification Authority` expires
`Feb 1 22:12:15 2027 GMT`. One issued under it is truncated to that same second rather than given
its term, which is why a certificate minted in August 2026 reads as under six months and looks like
a mistake. The successor, `Developer ID Certification Authority, OU=G2`, runs to `Sep 17 2031`, so
a certificate issued once Apple moves new issuance onto it gets the full term back. Read what you
were actually given rather than assume either one:

```sh
security find-certificate -c "Developer ID Application" -p | openssl x509 -noout -dates
```

Renewing is step 1 over again, with two things to get right.

The certificate must be issued under the **same team**. The designated requirement baked into every
signed copy pins `certificate leaf[subject.OU]` to the team id and tests the intermediate by marker
OID (`1.2.840.113635.100.6.2.6`), which both the original CA and G2 carry. So a same-team renewal
satisfies the identical requirement and the intermediate change is invisible, which is what keeps
`electron-updater` accepting the new build on every installed copy. A certificate from a different
team produces an app that Squirrel.Mac refuses as an update, stranding every install on its current
version with no remote way to fix it. Read the requirement off a build with `codesign -d -r-` if
there is ever any doubt.

Then **delete the expired identity from the keychain**. Renewal leaves two `Developer ID
Application` identities in it, and step 1 requires exactly one, since nothing here names the
certificate and electron-builder cannot choose between them. `security find-identity -v -p
codesigning` is the check, and the build failure when there are two reads nothing like a
certificate problem.

Nothing in `electron-builder.env` changes: `APPLE_ID`, `APPLE_TEAM_ID` and the app-specific
password all survive a renewal. Export the new certificate for CI as in step 5 and update
`CSC_LINK`, plus `CSC_KEY_PASSWORD` if the new `.p12` takes a different password. Renew a few weeks
early rather than on the day, since certificates overlap happily and the alternative is doing this
under pressure with a release waiting.
