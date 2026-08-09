# Security

## Reporting

Do not open public issues containing cookies, signed media URLs, diagnostics, or account data. Send a minimal reproduction to the project maintainers through the repository's private security advisory feature.

## Local security model

- Renderer processes are sandboxed with context isolation, Node integration disabled, and `webSecurity` enabled.
- The preload exposes only the typed `window.neotune` bridge.
- Main validates IPC senders and every trust-boundary payload.
- Navigation is denied unless explicitly allowed. External links are HTTPS and host allowlisted.
- YouTube cookies stay in `persist:neotune-auth`.
- Signed media URLs and remote parser objects never enter renderer state. Neither do the endpoints and feedback tokens behind the account settings: main holds them and replays them, and the renderer only ever names a setting and a boolean.
- Bundled documents are read by name from a fixed set, never from a path the renderer supplies.
- Restricted decipher evaluation runs in a short-lived utility process with a capability-free VM context and a hard timeout.

Cookies are credentials. Link only a browser profile you control, and never paste cookie values into issues, chat, or logs.

If media access or restricted evaluation fails, the release gate must remain closed. Do not disable sandboxing or Electron web security as a workaround.
