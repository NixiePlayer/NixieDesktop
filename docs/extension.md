# Signing in through Nixie Link

Nixie signs in by adopting the YouTube session from a browser on the same computer. Current Chromium
browsers on Windows use App-Bound Encryption, so Nixie cannot read those browser cookie databases
without impersonating the browser. Nixie refuses that workaround. The Nixie Link extension asks the
browser for the same cookies through its normal extension API instead.

## Install

Nixie Link is not published to a browser marketplace. Install it only from its GitHub repository:
[NixiePlayer/nixie-link-extension](https://github.com/NixiePlayer/nixie-link-extension).

1. Install and start Nixie.
2. Download and unzip the latest `nixie-link-<version>.zip` GitHub release.
3. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or the equivalent page.
4. Turn on **Developer mode**, select **Load unpacked**, and select the unzipped folder.
5. Confirm that the extension ID is `pgknibkmcmahfafgbkndpkkcpciigleb`.
6. Open Nixie Link from the toolbar and copy its pairing code.
7. Paste the code into the connected browser row on Nixie's sign-in screen, then select **Connect**.

The stable extension ID lets the browser find Nixie's native host. It does not authenticate unpacked
code. The private pairing code authenticates each cookie request. Download only from the named
repository and keep the pairing code private.

## Security and refresh

The extension sends no cookies in its connection hello. Nixie sends a fresh nonce and HMAC proof when
it needs current cookies, at most once a minute. The extension ignores a request without a valid proof
and encrypts each accepted payload with AES-256-GCM. The native relay cannot read that payload. Nixie
also binds each response to the socket that received its request and validates every cookie field.

Nixie protects its saved pairing value through Electron `safeStorage`. On Linux, pairing needs an
unlocked system keyring. Nixie refuses the insecure `basic_text` fallback.

Signing out of YouTube returns an authenticated empty set, which clears the copied Nixie session.
Resetting the pairing code or removing the extension makes refresh fail, which also clears the copied
extension session. Signing out inside Nixie clears its session and linked-account record immediately.

This protects against a simple replacement of the registered native host. It cannot protect against
malware that already runs as the same operating-system user and can read or alter the browser profile.
The extension is unpacked, and the Windows app is currently unsigned.

## Troubleshooting

| Message or state | Meaning and action |
| --- | --- |
| Specified native messaging host not found | Start Nixie once, then reload the extension. |
| Access to the specified native messaging host is forbidden | The extension ID is not the fixed ID that Nixie allows. Use the official repository copy. |
| Native host has exited | Nixie is not running, or its per-run local token is stale. Restart Nixie and reload the extension. |
| Extension pull timed out | The pairing code is wrong, was reset, or the browser closed. Copy the current code again. |
| Unlock a system keyring before pairing | Linux has no secure keyring backend available. Start or unlock the desktop keyring and retry. |

A running Chromium browser can lock its cookie database on Windows, which can hide it from Nixie's
disk list. Nixie Link reads through the browser API and does not have that file-lock problem.
