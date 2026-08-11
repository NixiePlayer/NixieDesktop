# Security

## Reporting

Do not open public issues containing cookies, signed media URLs, diagnostics, or account data. Send a minimal reproduction to the project maintainers through the repository's private security advisory feature.

## Local security model

- Renderer processes are sandboxed with context isolation, Node integration disabled, and `webSecurity` enabled.
- The preload exposes only the typed `window.nixie` bridge.
- Main validates IPC senders and every trust-boundary payload.
- Navigation is denied unless explicitly allowed. External links are HTTPS and host allowlisted.
- YouTube cookies stay in `persist:nixie-auth`.
- The browser extension path is the app's only inbound surface. The native relay checks the browser origin and a per-run pipe token. Nixie also authenticates each cookie pull with a private pairing value and fresh nonce. The extension ignores unauthenticated pulls and encrypts accepted payloads with AES-256-GCM. Nixie accepts a response only from the socket that received the request, verifies its authentication tag, and validates the complete cookie array. The extension ID is only a stable routing value for an unpacked install, not a code signature.
- Files Nixie writes with `mode: 0o600` are protected by that mode on macOS and Linux. Windows uses the ACL on the per-user application data directory. The extension pairing value is encrypted with Electron `safeStorage`; Linux refuses pairing when only the `basic_text` backend is available.
- No cookie store is decrypted by circumventing a browser's own protection. A Windows profile using app-bound encryption is not offered for sign-in at all, because reaching its key would mean impersonating the browser.
- Windows installers and Linux AppImages are unsigned today, so verify a download against the releases page. macOS builds are signed and notarized. An unpacked extension and an unsigned application do not claim to resist malware already running as the same operating-system user.
- Signed media URLs and remote parser objects never enter renderer state. Neither do the endpoints and feedback tokens behind the account settings: main holds them and replays them, and the renderer only ever names a setting and a boolean.
- Bundled documents are read by name from a fixed set, never from a path the renderer supplies.
- Restricted decipher evaluation runs in a short-lived utility process with a capability-free VM context and a hard timeout.

Cookies are credentials. Link only a browser profile you control, and never paste cookie values into issues, chat, or logs.

If media access or restricted evaluation fails, the release gate must remain closed. Do not disable sandboxing or Electron web security as a workaround.
