# Security

## Reporting

Do not open public issues containing cookies, signed media URLs, diagnostics, or account data. Send a minimal reproduction to the project maintainers through the repository's private security advisory feature.

## Local security model

- Renderer processes are sandboxed with context isolation, Node integration disabled, and `webSecurity` enabled.
- The preload exposes only the typed `window.nixie` bridge.
- Main validates IPC senders and every trust-boundary payload.
- Navigation is denied unless explicitly allowed. External links are HTTPS and host allowlisted.
- YouTube cookies stay in `persist:nixie-auth`.
- The browser extension path is the app's only inbound surface. A browser launches the native messaging host, which relays JSON between that browser and a per-user local socket or named pipe; it holds nothing and it re-checks the calling extension's origin itself rather than trusting the browser's own check. The first line of every connection has to carry a token generated for this install and readable only from the user's own profile directory, which is what stands in for the ACL a Windows named pipe cannot be given. Cookies travel browser to app only: the app sends pull requests and never a cookie value, so a local process that guessed both the pipe and the token could offer this app a session and could never take one from it.
- Files Nixie writes with `mode: 0o600` (the linked account record, the native host config and its manifest) are protected by that mode on macOS and Linux. Windows honours no POSIX mode, so there the protection is the ACL on the per-user application data directory holding them.
- No cookie store is decrypted by circumventing a browser's own protection. A Windows profile using app-bound encryption is not offered for sign-in at all, because reaching its key would mean impersonating the browser.
- Windows installers and Linux AppImages are unsigned today, so verify a download against the releases page. The updater is unaffected, and macOS builds are signed and notarized.
- Signed media URLs and remote parser objects never enter renderer state. Neither do the endpoints and feedback tokens behind the account settings: main holds them and replays them, and the renderer only ever names a setting and a boolean.
- Bundled documents are read by name from a fixed set, never from a path the renderer supplies.
- Restricted decipher evaluation runs in a short-lived utility process with a capability-free VM context and a hard timeout.

Cookies are credentials. Link only a browser profile you control, and never paste cookie values into issues, chat, or logs.

If media access or restricted evaluation fails, the release gate must remain closed. Do not disable sandboxing or Electron web security as a workaround.
