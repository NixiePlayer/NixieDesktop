import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	nativeTheme,
	net,
	Notification,
	protocol,
	session,
	shell,
	type IpcMainInvokeEvent,
} from "electron";
// Destructured from the default export rather than imported by name: electron-updater is CommonJS,
// and a named import of it from an ES module resolves to nothing at runtime.
import electronUpdater from "electron-updater";
import type { AudioQuality, AuthState, PersistedState, Track, UpdateState } from "../src/shared/contracts";
import type { LinkedAccount } from "../src/shared/contracts";
import { artistNames } from "../src/shared/entities";
import {
	validateBrowserAccount,
	validateDocumentName,
	validateInstallId,
	validateLinkedAccount,
	validateMusicCommand,
	validateMusicQuery,
	validateState,
	validateTrack,
} from "../src/shared/validation";
import { BROWSER_BUNDLE_IDS, type ImportedCookie, listBrowserAccounts, readYouTubeCookies } from "./browser-cookies";
import { configureRestrictedEvaluator, evaluateRestricted } from "./decipher";
import { LocalLogger } from "./logger";
import { LyricsClient } from "./lyrics";
import { SecureResourceRegistry } from "./media-protocol";
import { EXTENSION_ID, NATIVE_HOST_NAME, registerNativeHost } from "./native-host-register";
import { NativeHostServer } from "./native-host-server";
import { StateStore } from "./state-store";
import { YouTubeAdapter } from "./youtube-adapter";

const authPartition = "persist:nixie-auth";
// Exact hostnames, so `youtube.com` does not stand in for `www.youtube.com`. A link to a host that
// is not named here opens nothing at all, silently, which is the easy mistake when adding one.
const externalHosts = new Set([
	"github.com",
	"lrclib.net",
	"developers.google.com",
	"electronjs.org",
	"music.youtube.com",
	"www.youtube.com",
	"policies.google.com",
	"myactivity.google.com",
]);
const csp = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self'",
	"img-src 'self' data: nixie:",
	"media-src 'self' nixie:",
	// `nixie:` is here because the lyrics panel fetches nixie://app/lyrics from the renderer.
	"connect-src 'self' nixie: https://lrclib.net",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
	{
		scheme: "nixie",
		privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
	},
]);

// A development window sits beside an installed one, so it says so in the app menu and the About
// panel. The Dock label and the Cmd-Tab entry read the bundle instead, which is what
// `scripts/dev-app-name.mjs` writes. The released app is just "Nixie": its own prerelease state is
// on the icon, and nothing has to be renamed back at 1.0.
const APP_NAME = process.env.VITE_DEV_SERVER_URL ? "Nixie (Dev)" : "Nixie";

// macOS reads the name once, while the first menu is built, so setting this after `whenReady` was too
// late and the menu bar and About panel both still said "Electron".
app.setName(APP_NAME);
// The data path carries the channel, so a development run holds its own linked account, settings,
// playback state and cookies, and the two can be open at once: one profile directory shared between
// two Chromium processes is two writers on the same cookie and Local Storage databases. It is set
// rather than left to Electron so the packaged path stays `Nixie` whatever the bundle is called.
app.setPath("userData", join(app.getPath("appData"), APP_NAME));

// Windows attributes a toast, a taskbar group and the media transport controls to this id, and draws
// nothing at all when it does not match the Start Menu shortcut the installer writes, which carries the
// appId. It is a no-op on macOS and Linux, so it is set unconditionally rather than guarded.
app.setAppUserModelId("com.theedoran.nixiedesktop");

// One instance per data path. macOS keeps a second launch off the bundle through LaunchServices, but
// nothing does on Windows or Linux, where a second copy is a second writer on the state file, the log
// and the auth partition. `exit` rather than `quit`: quitting is asynchronous and the startup chain
// below would run in the process that is already leaving. This also fixes the one macOS path that was
// never protected, two `pnpm dev` runs sharing the dev channel's single userData.
if (!app.requestSingleInstanceLock()) app.exit(0);

// macOS draws overlay scrollbars: they float over the content, take no layout width and fade out when
// nothing is scrolling, which is what every page in this app is laid out against. Windows and Linux
// draw a classic gutter instead, always visible and eating width, which is a different app in the same
// window. Chromium has the macOS behaviour on those two behind a feature of its own, so it is asked for
// rather than approximated in CSS: a `::-webkit-scrollbar` rule can only restyle the gutter, never take
// its space back or make it fade. It must be set before the app is ready.
if (process.platform !== "darwin") app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");

// `release()` is a kernel version and says nothing about which system it came from, so the diagnostics
// line names the platform itself. An unrecognised one prints its own `process.platform`, which is the
// only honest thing left to say about it.
const OS_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

// Nothing upstream needs to know this is Electron, and YouTube serves cut-down responses to clients
// that say so, so every request goes out as the plain Chrome underneath.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:nixie|Electron)\/\S+/gi, "");

let mainWindow: BrowserWindow | undefined;
// The window's close button hides it rather than destroying it, so this is what tells a real quit
// from a close: it is set by `before-quit`, which is the only path Cmd-Q and the Dock's Quit take.
let quitting = false;
let stateStore: StateStore;
let logger: LocalLogger;
let youtube: YouTubeAdapter;
let nativeHost: NativeHostServer;
const resources = new SecureResourceRegistry({
	log: (message) => void logger.write("error", message),
	// In development the renderer is served by Vite, so the decks fetch the stream cross-origin.
	// An Origin header carries no path, so the dev URL is reduced to its origin before comparing.
	allowedOrigins: ["nixie://app", process.env.VITE_DEV_SERVER_URL]
		.filter((value) => value !== undefined)
		.map((value) => (value.startsWith("http") ? new URL(value).origin : value)),
});
// Deferred rather than passed by value: the adapter is built on `whenReady`, this runs before it.
const lyrics = new LyricsClient((videoId) => youtube.lyrics(videoId));

function trusted(event: IpcMainInvokeEvent) {
	const url = event.senderFrame?.url ?? "";
	const devUrl = process.env.VITE_DEV_SERVER_URL;
	if (url.startsWith("nixie://app/")) return;
	if (devUrl && new URL(url).origin === new URL(devUrl).origin) return;
	throw new Error("Untrusted IPC sender");
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
	ipcMain.handle(channel, async (event, ...args) => {
		trusted(event);
		return listener(event, ...args);
	});
}

/** Which browser profile the session was adopted from, so the copy can follow that profile. */
function linkPath() {
	return join(app.getPath("userData"), "linked-account.json");
}

/**
 * The cover as a native image, fetched through the protocol's own host check rather than beside it.
 * macOS draws it as the notification's content image, which is the thumbnail on its trailing edge.
 */
async function artworkIcon(url: string | undefined) {
	const id = url?.startsWith("nixie://app/artwork/") ? url.split("/").at(-1) : undefined;
	if (!id || !url) return undefined;
	const response = await resources.handleArtwork(new Request(url), id).catch(() => undefined);
	if (!response?.ok) return undefined;
	const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
	return image.isEmpty() ? undefined : image;
}

/**
 * Whether the platform refused the last banner. Nothing here can ask it in advance: Electron exposes
 * no authorization status, macOS keeps its own behind a framework call, and a permission that is
 * merely unasked is granted by the first `show()` rather than refused by it. So the only honest
 * signal is a show that comes back failed, and the setting reads this so a switch that is on and
 * silent says why. A show that lands clears it, since permission is granted in System Settings while
 * the app is running and nothing tells us it changed.
 */
let notificationsRefused = false;

/**
 * The banner is worth seeing and the row it leaves behind in Notification Center is not: a track
 * change is over the moment the next one starts, and left alone an evening of listening piles up an
 * entry per song. Electron marks nothing transient on macOS, so the banner is dismissed instead,
 * which is what `close()` does there: it removes the delivered notification from the Center. The
 * delay is the banner's own dwell time, so it is read on screen and leaves nothing after it, and a
 * change arriving inside that window replaces the one before it rather than stacking on it.
 */
const NOTIFICATION_LINGER_MS = 6000;
let lastNotification: { notification: Notification; timer: ReturnType<typeof setTimeout> } | undefined;

function dismissNotification() {
	if (!lastNotification) return;
	clearTimeout(lastNotification.timer);
	lastNotification.notification.close();
	lastNotification = undefined;
}

/**
 * Names the track the queue moved to on its own, or the one a hardware key reached while the app was
 * not on screen. Nothing is drawn while the window has focus: the
 * player is on screen and already says so, and this exists for the times it is not. macOS suppresses
 * a banner from the frontmost app anyway, so this only makes that deliberate.
 *
 * ponytail: silent, and no actions on it. The one sound this app makes is the music.
 */
async function notifyTrackChange(track: Track) {
	const skipped = !Notification.isSupported()
		? "unsupported"
		: stateStore.snapshot.settings.notifyTrackChange === false
			? "setting off"
			: mainWindow?.isFocused()
				? "window focused"
				: undefined;
	// Every reason this draws nothing is silent by design, which leaves no way to tell a gate from a
	// queue move that never asked. Development says which, and names no track: a line reading nothing
	// at all is the answer that the renderer never called, and is worth as much as the others.
	if (!app.isPackaged) void logger.write("info", `notify: ${skipped ?? "showing"}`);
	if (skipped) return;
	const detail = [artistNames(track.artists), track.album?.title].filter(Boolean).join(" · ");
	const notification = new Notification({
		title: track.title,
		body: detail,
		icon: await artworkIcon(track.artworkUrl),
		silent: true,
	});
	notification.on("click", () => {
		mainWindow?.show();
		mainWindow?.focus();
	});
	notification.on("show", () => {
		notificationsRefused = false;
	});
	notification.on("failed", (_event, error) => {
		notificationsRefused = true;
		void logger.write("warn", `notification refused: ${error}`);
	});
	dismissNotification();
	notification.show();
	lastNotification = { notification, timer: setTimeout(dismissNotification, NOTIFICATION_LINGER_MS) };
}

let refreshedAt = 0;

async function writeCookies(cookies: ImportedCookie[]) {
	const authSession = session.fromPartition(authPartition);
	for (const cookie of cookies) {
		await authSession.cookies
			.set({
				url: `https://${cookie.domain.replace(/^\./, "")}${cookie.path}`,
				name: cookie.name,
				value: cookie.value,
				// A __Host- cookie is rejected outright if it carries a domain.
				domain: cookie.name.startsWith("__Host-") ? undefined : cookie.domain,
				path: cookie.path,
				secure: cookie.secure,
				httpOnly: cookie.httpOnly,
				expirationDate: cookie.expirationDate,
			})
			// One cookie the store will not take is not worth failing the import: authState decides.
			.catch(() => undefined);
	}
	refreshedAt = Date.now();
}

/**
 * Google rotates `__Secure-1PSIDTS` every few minutes and retires the value that was copied, which
 * leaves the session recognised but downgraded: browsing still answers, and every stream URL it
 * then mints comes back 403. Only the browser profile holds the current value, so it is re-read
 * before a cookie header goes out, at most once a minute. Nothing here can renew the copy on its
 * own: InnerTube answers carry no refreshed cookie, and neither does replaying them through the
 * partition's own session.
 */
async function refreshLinkedCookies() {
	if (Date.now() - refreshedAt < 60_000) return;
	refreshedAt = Date.now();
	const link: unknown = JSON.parse(await readFile(linkPath(), "utf8"));
	validateLinkedAccount(link);
	// The disk read and the extension answer the same question with the same shape, which is why the
	// adapter and cookieHeader are untouched: only where the cookies come from changes. The pull is
	// bounded, since a browser that has closed must not hold the header open behind it.
	const cookies = link.source === "extension" ? await nativeHost.pull(link.installId) : await readYouTubeCookies(link);
	await writeCookies(cookies);
}

async function cookieHeader() {
	await refreshLinkedCookies().catch(() => undefined);
	const cookies = await session.fromPartition(authPartition).cookies.get({ domain: ".youtube.com" });
	return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

/**
 * Nixie plays without advertisements, in the background, and out of its own audio engine, which are
 * three things YouTube sells as Music Premium. Asked of an account that pays for them, it hands back
 * what that account has already bought; asked of a free one, it hands over what YouTube charges for.
 * So a session that holds no subscription is refused here, at the one place every entry passes
 * through, rather than being checked wherever playback happens to start.
 *
 * The probe answers `undefined` when it could not tell, and that allows: a network that was down or a
 * response that arrived without formats is not evidence of anything, and locking a paying listener
 * out of their own music over it is the worse failure by a distance.
 */
async function authState(): Promise<AuthState> {
	const header = await cookieHeader();
	if (!/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=/.test(header)) return { status: "signed-out" };
	// The name and the photo are worth one request, not the sign-in gate: an account YouTube will
	// not describe is still an account, and the menu falls back to naming the service.
	const [account, entitled] = await Promise.all([
		youtube.account().catch(async (error: unknown) => {
			await logger.write("error", `account lookup failed: ${error instanceof Error ? error.message : "unknown"}`);
		}),
		youtube.entitled().catch(async (error: unknown) => {
			await logger.write("warn", `entitlement check failed: ${error instanceof Error ? error.message : "unknown"}`);
			return undefined;
		}),
	]);
	if (entitled === false) return { status: "unentitled" };
	return {
		status: "authenticated",
		accountName: account?.accountName ?? "YouTube Music",
		avatarUrl: account?.avatarUrl,
	};
}

/**
 * Google rejects sign-in from any embedded browser, whatever it claims to be, and its OAuth device
 * tokens are refused by every InnerTube endpoint. Adopting the session from a real browser already
 * on this computer is what is left, so the account arrives already signed in and nobody handles a
 * cookie by hand.
 */
/**
 * Everything a session needs once its cookies are in hand, whichever door they came through: the
 * partition is cleared, the adapter is rebuilt, the entitlement is checked, and the link is written
 * only for a session Nixie will actually play. A refused profile leaves no link behind, so the next
 * attempt starts from nothing. The two callers differ only in where the cookies came from and what
 * `source` the link records.
 */
async function linkSession(cookies: ImportedCookie[], link: LinkedAccount) {
	await session.fromPartition(authPartition).clearStorageData();
	await rm(linkPath(), { force: true });
	await writeCookies(cookies);
	youtube = createAdapter();
	const state = await authState();
	if (state.status === "unentitled") {
		throw new Error("That account has no YouTube Music Premium subscription, which Nixie requires");
	}
	if (state.status !== "authenticated") throw new Error("That profile is not signed in to YouTube");
	await writeFile(linkPath(), JSON.stringify(link), { mode: 0o600 });
	return state;
}

async function importFromBrowser(account: unknown) {
	validateBrowserAccount(account);
	const cookies = await readYouTubeCookies(account);
	return linkSession(cookies, { source: "browser", browser: account.browser, profile: account.profile });
}

/** The extension's counterpart of importFromBrowser: pull the profile's cookies through the host. */
async function importFromExtension(installId: unknown) {
	validateInstallId(installId);
	const source = nativeHost.connections().find((connection) => connection.installId === installId);
	if (!source) throw new Error("That browser is no longer connected");
	// The UI refuses a signed-out row, but the channel says so too rather than letting the pull run its
	// full timeout and report a timeout for a profile that simply holds no session.
	if (!source.signedIn) throw new Error("That browser is not signed in to YouTube");
	const cookies = await nativeHost.pull(installId);
	return linkSession(cookies, { source: "extension", installId, browser: source.browser });
}

function createAdapter() {
	const adapter = new YouTubeAdapter(
		resources,
		join(app.getPath("userData"), "youtube-cache"),
		cookieHeader,
		// Read per call rather than captured, so changing either in Settings reaches the next session
		// without rebuilding the adapter around it.
		async () => ({
			region: stateStore.snapshot.settings.region,
			restricted: stateStore.snapshot.settings.restricted,
		})
	);
	// Floating on purpose: whatever asked for a new adapter must not wait on YouTube.
	void adapter.warm().catch((error: unknown) => {
		void logger.write("error", `InnerTube warm-up failed: ${error instanceof Error ? error.message : "unknown"}`);
	});
	return adapter;
}

/**
 * The pipe server the browser extension reaches through the native host, and the per-browser
 * registration that points the host at it. Both are non-fatal: a session that came from a disk read
 * needs neither, and the extension path simply stays unavailable if either fails. The server is
 * assigned before the try so `connections()` and `pull()` answer even when the listen did not.
 */
async function setupNativeHost() {
	nativeHost = new NativeHostServer();
	try {
		await nativeHost.listen(app.getPath("userData"), [`chrome-extension://${EXTENSION_ID}/`]);
		await registerNativeHost({
			platform: process.platform,
			userDataPath: app.getPath("userData"),
			// Inside an AppImage `process.execPath` is a per-run mount path that dies with the process, so
			// the wrapper written from it would be stale by the next launch. APPIMAGE is the stable path to
			// the image itself, and is set only there.
			executable: process.env.APPIMAGE ?? process.execPath,
			// Shipped outside the asar through `build.extraResources`, so the path is a real file the
			// Electron binary can run as Node. In development it is the repository copy.
			hostScript: app.isPackaged
				? join(process.resourcesPath, "native-host", "host.cjs")
				: join(app.getAppPath(), "electron", "native-host", "host.cjs"),
			extensionId: EXTENSION_ID,
			hostName: NATIVE_HOST_NAME,
		});
	} catch (error: unknown) {
		// The reason, never the message: a node fs or net error carries the failing path, which the log
		// must not (AGENTS.md). `EADDRINUSE`, `EACCES` and the like are enough to say what went wrong.
		const reason = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
		void logger.write("error", `native host setup failed: ${reason}`);
	}
}

const execFileAsync = promisify(execFile);
const browserIcons = new Map<string, Promise<string | undefined>>();

/**
 * The icon the user already has in their Dock, rather than a trademarked mark checked into this
 * repository. A bundle id finds the application wherever it was installed, which a guessed
 * `/Applications/<name>.app` does not.
 *
 * The map is keyed by browser name, not by profile, since every profile of a browser shows the
 * same icon, and it caches the in-flight promise rather than its settled value: `auth:browsers`
 * resolves every account through `Promise.all`, so two profiles of the same browser call in on
 * the same tick, and caching only the settled result would still spawn `mdfind` for both.
 *
 * The image is read with `createThumbnailFromPath` and never `app.getFileIcon`, which answers
 * every path with the same grey placeholder grid on this macOS: it asks IconServices for an icon
 * that is still loading and returns the stand-in rather than waiting, and a second call a few
 * seconds later gets the same one. QuickLook renders the bundle's real icon, and 64px is twice
 * the 32px the row draws, for a retina window.
 *
 * ponytail: Spotlight is the ceiling. An unindexed volume yields no path, which yields no icon,
 * and a row without one still names its account and still links it. Read the icon out of the
 * bundle directly if that ever stops being good enough.
 */
function browserIcon(browser: string) {
	const cached = browserIcons.get(browser);
	if (cached) return cached;
	// Spotlight is the whole lookup, so this is macOS and nothing else. Windows would want the browser's
	// registered executable out of the registry and Linux its `.desktop` entry and icon theme, two more
	// lookups for one 32px image; a row with no icon still names its account and still links it. This also
	// stops spawning a missing `/usr/bin/mdfind` once per browser on every `auth:browsers` call.
	const bundleId = process.platform === "darwin" ? BROWSER_BUNDLE_IDS[browser] : undefined;
	const icon = bundleId
		? execFileAsync("/usr/bin/mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`])
				.then(({ stdout }) => stdout.split("\n")[0]?.trim())
				.then((path) => (path ? nativeImage.createThumbnailFromPath(path, { width: 64, height: 64 }) : undefined))
				.then((image) => image?.toDataURL())
				.catch(() => undefined)
		: Promise.resolve(undefined);
	browserIcons.set(browser, icon);
	return icon;
}

const { autoUpdater } = electronUpdater;

/**
 * The updater's whole state, held here rather than in the renderer: the check runs at startup and
 * the About tab is opened minutes later, so a page that only listened would show nothing at all
 * until something changed. It reads this once on mount and follows `update:state` after that.
 */
let updateState: UpdateState = { status: "unsupported" };

function setUpdateState(next: UpdateState) {
	updateState = next;
	mainWindow?.webContents.send("update:state", next);
}

/**
 * A music player is left running for days, so a check made only at startup is one most installs
 * never make twice. Six hours is slow enough to be free and fast enough that a release published
 * this morning is offered this afternoon.
 */
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * A development build has no feed and no signature, so it is told so once and never asks. Every
 * other state arrives from the events below, including the failures: `checkForUpdates` rejects and
 * emits `error` for the same failure, and the row reads the event.
 */
function configureUpdater() {
	if (!app.isPackaged) return;
	// On, so the only thing ever asked of the listener is the restart. It is also what makes "later"
	// free rather than a deferral: `autoInstallOnAppQuit` is electron-updater's default, so a build
	// downloaded and left alone installs itself the next time Nixie is quit, with no second prompt
	// and no second download.
	autoUpdater.autoDownload = true;
	// electron-updater's own logger writes the feed URL and the cache path it downloads into, which
	// is a filesystem path in a log this app promises not to write. Its failures go through
	// `LocalLogger` instead, one line naming the reason.
	autoUpdater.logger = null;
	autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking" }));
	autoUpdater.on("update-available", (info) => setUpdateState({ status: "available", version: info.version }));
	autoUpdater.on("update-not-available", () => setUpdateState({ status: "current" }));
	autoUpdater.on("download-progress", ({ percent }) =>
		// Spread, so the version the row is naming survives the progress ticks.
		setUpdateState({ ...updateState, status: "downloading", percent: Math.round(percent) })
	);
	autoUpdater.on("update-downloaded", (info) => setUpdateState({ status: "ready", version: info.version }));
	autoUpdater.on("error", (error: Error) => {
		void logger.write("error", `update check failed: ${error.message}`);
		setUpdateState({ status: "error" });
	});
	checkForUpdates();
	setInterval(checkForUpdates, UPDATE_INTERVAL_MS);
}

function checkForUpdates() {
	if (!app.isPackaged) {
		// Answered rather than ignored. The renderer puts the row in "checking" on the press rather than
		// on the answer, so a check that pushed nothing back would leave it there for good.
		setUpdateState({ status: "unsupported" });
		return;
	}
	setUpdateState({ status: "checking" });
	// Caught rather than surfaced: the `error` event has already put the reason on the row.
	void autoUpdater.checkForUpdates().catch(() => undefined);
}

function registerIpc() {
	handle("auth:state", () => authState());
	handle("auth:browsers", async () => {
		const accounts = await listBrowserAccounts(app.getApplicationNameForProtocol("https://"));
		return Promise.all(accounts.map(async (account) => ({ ...account, icon: await browserIcon(account.browser) })));
	});
	handle("auth:import-browser", (_event, account) => importFromBrowser(account));
	handle("auth:extension-sources", () => nativeHost.connections());
	handle("auth:link-extension", (_event, installId) => importFromExtension(installId));
	handle("auth:sign-out", async () => {
		await session.fromPartition(authPartition).clearStorageData();
		await rm(linkPath(), { force: true });
		await youtube.reset();
		youtube = createAdapter();
		return authState();
	});

	handle("music:query", (_event, request) => {
		validateMusicQuery(request);
		return youtube.query(request);
	});
	handle("music:command", (_event, request) => {
		validateMusicCommand(request);
		// Reporting a play is the one command the listener can switch off, and it is refused here rather
		// than merely left unsent: the setting is a promise about what leaves this machine, so it holds
		// wherever the call came from. An older state file states nothing, which reads as on.
		if (request.type === "history" && stateStore.snapshot.settings.reportHistory === false) {
			return Promise.resolve({ ok: true as const });
		}
		return youtube.command(request);
	});
	handle("music:rating", async (_event, trackId) => {
		if (typeof trackId !== "string" || !/^[\w-]{1,256}$/.test(trackId)) throw new TypeError("Invalid track ID");
		// The thumbs are worth less than the page they sit on, so an upstream re-layout stays quiet here
		// rather than rejecting into the renderer, where nothing could do anything about it either.
		try {
			return await youtube.rating(trackId);
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Unknown rating failure";
			await logger.write("warn", `music:rating failed: ${reason}`);
			return undefined;
		}
	});
	handle("music:account-settings", async () => {
		// One section of the settings page, so a failure costs that section and nothing else. The page
		// shows a link out to YouTube Music in its place.
		try {
			return await youtube.accountSettings();
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Unknown settings failure";
			await logger.write("warn", `music:account-settings failed: ${reason}`);
			return [];
		}
	});
	handle("player:resolve", async (_event, trackId, quality) => {
		if (typeof trackId !== "string" || !/^[\w-]{1,256}$/.test(trackId)) throw new TypeError("Invalid track ID");
		if (!["low", "normal", "high"].includes(String(quality))) throw new TypeError("Invalid audio quality");
		try {
			const result = await youtube.resolve(trackId, quality as AudioQuality);
			return { url: result.url, fingerprint: result.fingerprint, integratedLufs: result.integratedLufs };
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Unknown resolve failure";
			await logger.write("error", `player:resolve failed: ${reason}`);
			throw error;
		}
	});
	ipcMain.on("player:position", (_event, positionSeconds) => stateStore.setPlaybackPosition(positionSeconds));
	handle("player:notify", (_event, track) => {
		validateTrack(track);
		return notifyTrackChange(track);
	});
	handle("player:notify-refused", () => notificationsRefused);

	handle("local:load", () => stateStore.snapshot);
	handle("local:save", async (_event, value) => {
		validateState(value);
		await stateStore.save(value);
		// The stored theme decides the overlay's colours, and it is written through here, so this is where
		// the window controls follow a theme change. A no-op on macOS.
		syncTitleBarOverlay();
	});
	handle("local:clear", async (_event, selection) => {
		if (!["session", "all"].includes(String(selection))) throw new TypeError("Invalid clear selection");
		if (selection === "all") {
			void session.fromPartition(authPartition).clearStorageData();
			void rm(linkPath(), { force: true });
			void youtube.reset();
		}
		return stateStore.clear(selection as "session" | "all");
	});
	handle("local:document", async (_event, name) => {
		validateDocumentName(name);
		// Joined onto the app path, never onto anything the renderer sent: the name indexes a fixed set.
		return readFile(join(app.getAppPath(), name), "utf8");
	});
	handle("local:export-diagnostics", exportDiagnostics);

	handle("update:state", () => updateState);
	handle("update:check", () => checkForUpdates());
	// `quitAndInstall` closes every window first and only calls `app.quit()` once they are all gone,
	// which is the reverse of every other quit here: `before-quit` has not run, so `quitting` is still
	// false when the window's `close` handler sees it, and the window is hidden rather than destroyed.
	// The app then never quits and the installer never runs, which reads as the button doing nothing.
	// So the quit is declared here, and the session saved here too: `before-quit` refuses the first
	// quit to save, and the one Electron raises for the installer must not be refused.
	handle("update:install", async () => {
		quitting = true;
		// ponytail: a save that fails must not hold back an update that is already downloaded.
		await stateStore.save(stateStore.snapshot).catch(() => {});
		stateSavedBeforeQuit = true;
		autoUpdater.quitAndInstall();
	});

	handle("app:info", () => ({
		version: app.getVersion(),
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		os: `${OS_NAMES[process.platform] ?? process.platform} ${release()}`,
		arch: process.arch,
	}));
}

async function exportDiagnostics() {
	const result = await dialog.showSaveDialog(mainWindow!, {
		defaultPath: `nixie-diagnostics-${new Date().toISOString().slice(0, 10)}.log`,
		filters: [{ name: "Log", extensions: ["log"] }],
	});
	if (result.canceled || !result.filePath) return;
	await logger.export(result.filePath);
	return result.filePath;
}

function registerAppProtocol() {
	protocol.handle("nixie", async (request) => {
		const url = new URL(request.url);
		if (url.host !== "app") return new Response("Not found", { status: 404 });
		const segments = url.pathname.split("/").filter(Boolean);
		if (segments[0] === "media" && segments[1]) return resources.handleMedia(request, segments[1]);
		if (segments[0] === "artwork" && segments[1]) return resources.handleArtwork(request, segments[1]);
		if (segments[0] === "lyrics") return lyrics.query(url.searchParams);

		const root = resolve(app.getAppPath(), "dist");
		const pathname = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
		const filePath = resolve(root, pathname);
		const relativePath = relative(root, filePath);
		// `isAbsolute` is the Windows half of this test: `relative` returns the target itself when the two
		// paths sit on different drives, so `nixie://app/C:/Windows/win.ini` produced a relative path that
		// started with neither `..` nor the root and was served. Inert on macOS and Linux.
		if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
			return new Response("Bad request", { status: 400 });
		}
		const response = await net.fetch(pathToFileURL(filePath).toString());
		const headers = new Headers(response.headers);
		headers.set("content-security-policy", csp);
		return new Response(response.body, { status: response.status, headers });
	});
}

function installMenu() {
	const send = (type: "play" | "pause" | "next" | "previous") =>
		mainWindow?.webContents.send("player:media-command", { type });
	// Off macOS every role in this template is either inert (hide, unhide) or already delivered by
	// Chromium without a menu at all (copy, paste, select all), and what is left would be drawn as a
	// menu bar inside a window whose whole point is that it has no chrome. The two playback accelerators
	// move into the renderer (`app-shell.tsx`), which is also the only place that can tell a text field
	// from the transport.
	if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: APP_NAME,
				submenu: [
					{ role: "about" },
					{ type: "separator" },
					{ label: "Export diagnostics", click: () => void exportDiagnostics() },
					{ type: "separator" },
					// Cmd+H, Cmd+Alt+H: macOS only delivers them when the app menu carries these roles, so
					// without them the standard hide shortcuts silently do nothing.
					{ role: "hide" },
					{ role: "hideOthers" },
					{ role: "unhide" },
					{ type: "separator" },
					{ role: "quit" },
				],
			},
			// Without this menu macOS never delivers Cmd+A/C/V/X/Z to the renderer, so every text
			// field in the app loses select-all, copy, paste, and undo.
			{ role: "editMenu" },
			{
				label: "Playback",
				submenu: [
					// No Space accelerator: a menu accelerator swallows the key before the page sees it, so
					// the renderer owns Space and toggles with it instead of forcing a reload-and-play.
					{ label: "Play", click: () => send("play") },
					{ label: "Pause", click: () => send("pause") },
					{ label: "Next", accelerator: "CmdOrCtrl+Right", click: () => send("next") },
					{ label: "Previous", accelerator: "CmdOrCtrl+Left", click: () => send("previous") },
				],
			},
			{ role: "windowMenu" },
		])
	);
}

async function verifyRestrictedEvaluator() {
	const result = await evaluateRestricted({ output: 'return { value: "gate" };' }, {});
	if (typeof result !== "object" || result === null || !("value" in result) || result.value !== "gate") {
		throw new Error("Restricted evaluator returned an invalid result");
	}
}

// Off macOS the window controls are drawn back into the page by the overlay, which Chromium paints
// rather than the renderer, so it cannot read a CSS variable. `height` is the header row (`3.5rem` in
// `app-shell.tsx`), and the two colour pairs are `--background`/`--foreground` from `src/styles.css`:
// change one and change the other.
const TITLE_BAR = {
	height: 56,
	dark: { color: "#0f0f0f", symbolColor: "#f1f1f1" },
	light: { color: "#ffffff", symbolColor: "#0f0f0f" },
};

function darkAppearance() {
	const theme = stateStore.snapshot.settings.theme;
	return theme === "system" ? nativeTheme.shouldUseDarkColors : theme === "dark";
}

// Windows and Linux only: macOS draws its own traffic lights and has no overlay to restyle.
function syncTitleBarOverlay() {
	if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed()) return;
	const palette = darkAppearance() ? TITLE_BAR.dark : TITLE_BAR.light;
	mainWindow.setTitleBarOverlay({ ...palette, height: TITLE_BAR.height });
}

async function createWindow() {
	const saved = stateStore.snapshot.windowBounds;
	// What the window is painted with until the renderer's first frame lands. It is the stored theme's
	// own `--background` from `src/styles.css`, so a light window never opens on a dark rectangle: a
	// colour fixed at one appearance is the flash the renderer's synchronous paint cannot reach.
	const dark = darkAppearance();
	mainWindow = new BrowserWindow({
		width: saved?.width ?? 1440,
		height: saved?.height ?? 900,
		x: saved?.x,
		y: saved?.y,
		minWidth: 1040,
		minHeight: 680,
		show: false,
		// "hiddenInset" insets the traffic lights that the top bar's leading padding clears. Off macOS the
		// title bar is hidden and the controls are drawn back into the page by the overlay, which keeps the
		// native frame: `frame: false` would lose the resize borders, the maximize geometry and the snap
		// layouts, and have to reimplement all three.
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
		...(process.platform === "darwin"
			? {}
			: { titleBarOverlay: { ...(dark ? TITLE_BAR.dark : TITLE_BAR.light), height: TITLE_BAR.height } }),
		// The window and taskbar icon. A packaged build carries it in the executable itself, and macOS
		// draws its dock icon through `app.dock.setIcon`, so this is the development window on Windows and
		// Linux, which would otherwise wear the stock Electron mark. `scripts/dev-app-name.mjs` is the
		// macOS counterpart and is a no-op off it.
		...(process.env.VITE_DEV_SERVER_URL && process.platform !== "darwin"
			? { icon: join(app.getAppPath(), "build", "icon-dev.png") }
			: {}),
		backgroundColor: dark ? "#0f0f0f" : "#ffffff",
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/preload.mjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
			// Chromium throttles a hidden page's timers to one a second, and the gapless handoff in
			// `audio-engine.ts` is a timer armed against the end of the current track. A minimised
			// window is the normal state for a music player, so throttled it would gap every join.
			backgroundThrottling: false,
		},
	});
	// Everything is refused but putting a share link on the clipboard, which is the one thing the
	// renderer asks the platform for and only ever after the click that asked for it. Reading the
	// clipboard is a separate permission and stays refused.
	mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) =>
		callback(permission === "clipboard-sanitized-write")
	);
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		const target = new URL(url);
		if (target.protocol === "https:" && externalHosts.has(target.hostname)) void shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event, url) => {
		const current = mainWindow?.webContents.getURL();
		if (!current || new URL(url).origin !== new URL(current).origin) event.preventDefault();
	});
	mainWindow.once("ready-to-show", () => mainWindow?.show());
	mainWindow.on("close", (event) => {
		const bounds = mainWindow?.getBounds();
		if (bounds) {
			const state: PersistedState = stateStore.snapshot;
			state.windowBounds = bounds;
			void stateStore.save(state);
		}
		// The audio engine, the queue and the whole session live in the renderer, so destroying the
		// window on macOS stops the music and the next Dock click loads the app from nothing. The
		// close button hides it instead, which is what every macOS music player does, and `quitting`
		// is what still lets Cmd-Q and the Dock's Quit through.
		if (process.platform === "darwin" && !quitting) {
			event.preventDefault();
			mainWindow?.hide();
		}
	});
	if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else await mainWindow.loadURL("nixie://app/");
}

void app
	.whenReady()
	.then(async () => {
		// Packaged builds get `build/icon.icns` from electron-builder, but development runs the stock
		// Electron binary, which brings its own dock icon along. It gets the blue mark rather than the
		// red one, so a development window is never mistaken for the installed app beside it.
		// ponytail: a missing dev mark is cosmetic, it must not take the startup chain down with it.
		if (process.env.VITE_DEV_SERVER_URL)
			try {
				app.dock?.setIcon(join(app.getAppPath(), "build/icon-dev.png"));
			} catch {}
		await mkdir(app.getPath("userData"), { recursive: true });
		// An install that predates the removal of offline downloads still holds the audio files it
		// saved, and nothing left in the app can play them or list them. Removing them here is the
		// whole of the migration: `StateStore.load` drops the records that named them.
		// ponytail: unconditional, since a directory that is not there costs one failed unlink.
		void rm(join(app.getPath("userData"), "downloads"), { recursive: true, force: true });
		stateStore = new StateStore(app.getPath("userData"));
		logger = new LocalLogger(app.getPath("userData"));
		await stateStore.load();
		configureRestrictedEvaluator();
		youtube = createAdapter();
		registerAppProtocol();
		await verifyRestrictedEvaluator();
		await setupNativeHost();
		registerIpc();
		installMenu();
		await createWindow();
		nativeHost.onChange((sources) => {
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("auth:extension-sources", sources);
		});
		// After the window, so the first state reaches a renderer that exists, and not awaited: a
		// GitHub that cannot be reached must not hold up the app it is checking.
		configureUpdater();
		await logger.write("info", "Application started");
		app.on("activate", () => {
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
			else void createWindow();
		});
		// Only while the stored theme is `system`: the OS appearance changing then flips the overlay's
		// colours, which nothing else in the app is listening for. A no-op on macOS.
		nativeTheme.on("updated", syncTitleBarOverlay);
	})
	.catch((error: unknown) => {
		void logger?.write("error", error instanceof Error ? error.message : "Application startup failed");
		dialog.showErrorBox("Nixie could not start", error instanceof Error ? error.message : "Unknown startup error");
		app.quit();
	});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

// A second launch on Windows or Linux hands its lock to the instance that holds it rather than opening
// a second window on the same data path. macOS never reaches here, since LaunchServices refuses the
// second copy before it starts.
app.on("second-instance", () => {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
});

let stateSavedBeforeQuit = false;
app.on("before-quit", (event) => {
	// Set before the early return, since the second pass through here is the one that reaches the
	// window's `close` handler, which refuses to be destroyed until this says a quit is under way.
	quitting = true;
	// Removes the unix socket file so the next launch does not have to reclaim a stale one. Idempotent,
	// so the second pass through here is harmless.
	if (nativeHost) void nativeHost.close().catch(() => undefined);
	if (stateSavedBeforeQuit || !stateStore) return;
	event.preventDefault();
	void stateStore.save(stateStore.snapshot).finally(() => {
		stateSavedBeforeQuit = true;
		app.quit();
	});
});
