# Signing in through the browser extension

Nixie signs in by adopting the YouTube session from a browser you are already signed in to on the
same machine. On macOS and Linux it reads that profile's cookie store off disk. On Windows it cannot,
for Chrome and usually for Edge, Brave, Vivaldi and Chromium too, and the extension is the way in
there instead.

This document is the reader-facing half of that path. `AGENTS.md` holds the design and the reasoning.

## Why it exists

Chrome 127 and later added app-bound encryption on Windows. The key that decrypts the cookie store is
wrapped a second time and handed back only to Chrome's own signed binary, through an elevation
service that checks the caller's signature. There is no permission to ask for and no prompt to
approve: getting at that key means pretending to be Chrome, which this project will not do. So a
profile written under app-bound encryption is not offered on the sign-in screen at all, rather than
offered and then failing with a message about an elevation service.

The extension answers the same question a different way. It reads its own cookies through
`chrome.cookies`, which is the browser handing an extension what you granted it when you installed
it, and passes them to Nixie over Chrome native messaging, a channel the browser itself brokers.
Nothing is decrypted, worked around or pasted by hand.

Everywhere the disk read already works, the extension is optional. It is offered below the browser
list on macOS and Linux, and above it on Windows, where the disk list reaches Firefox and nothing
else.

## Installing it

The extension lives in its own repository:
[NixiePlayer/nixie-connector-extension](https://github.com/NixiePlayer/nixie-connector-extension).

It is not in the Chrome Web Store or the Edge Add-ons store yet, so for now it is loaded unpacked:

1. Clone or download the extension repository.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`, and so on).
3. Turn on **Developer mode**.
4. **Load unpacked**, and pick the extension's directory.
5. Open the extension once from the toolbar.

The extension keeps a fixed id across installs, which is what Nixie pins it to, so loading it
unpacked does not change which extension the app will talk to.

Nothing has to be done on the Nixie side. The app registers the native messaging host itself the
first time it runs, on every platform, and the Windows installer writes the same registry keys so a
fresh install works even before Nixie has been opened. There is no manifest to copy and no path to
paste anywhere.

Then, with Nixie running: sign in at `music.youtube.com` in that browser if you have not, and the
profile appears on Nixie's sign-in screen on its own. Nothing needs a refresh. A connected profile
that holds no YouTube session is still listed, dimmed, saying so, rather than quietly not appearing.

## Keeping it working

Nixie must be running for the extension to hand anything over. The connection is made by the browser
launching the host, and the host leaves without a word if the app is not there; the extension retries
about once a minute, so starting Nixie after the browser is fine and needs no clicking.

Nothing is pushed and nothing is cached. Google expires the session every few minutes and only the
browser holds the current value, so Nixie asks for it when it needs it, at most once a minute, for as
long as the account stays linked. Signing out of Nixie ends that. Removing the extension, or signing
out of YouTube in the browser, ends it too.

The extension is only needed for the browser whose session you linked. It does not have to be
installed anywhere else, and it does nothing for a Firefox profile, which Nixie reads off disk on
every platform.

## When something goes wrong

Chrome's own native messaging errors are worth being able to read, since each one names a different
missing piece:

| Message | What it means |
| --- | --- |
| "Specified native messaging host not found" | The registry key (Windows) or the host manifest file (macOS, Linux) is missing. Start Nixie once, which writes both, then reload the extension. |
| "Access to the specified native messaging host is forbidden" | The extension's id is not the one the host manifest allows. It is an extension built or repacked with a different id than the app is pinned to. |
| "Native host has exited" | The host started and left. Either Nixie is not running, or the token check failed, which happens when a stale config is being read: quit Nixie, start it again, and reload the extension. |

Two more things that look like faults and are not:

- A profile missing from the **disk** list on Windows while that browser is open. A running Chromium
  holds its cookie file with an exclusive lock and nothing can be copied out from under it. Quit the
  browser and look again, or use the extension, which has no such problem.
- Nothing at all appearing after installing the extension. Open the extension once from the toolbar.
  Until it has run, it has not connected to anything.
