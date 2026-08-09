import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join, relative, resolve, sep } from "node:path";
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
import { artistNames } from "../src/shared/entities";
import {
	validateBrowserAccount,
	validateDocumentName,
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

// `release()` is a kernel version and says nothing about which system it came from, so the diagnostics
// line names the platform itself. An unrecognised one prints its own `process.platform`, which is the
// only honest thing left to say about it.
const OS_NAMES: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux" };

// Nothing upstream needs to know this is Electron, and YouTube serves cut-down responses to clients
// that say so, so every request goes out as the plain Chrome underneath.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:nixie|Electron)\/\S+/gi, "");

let mainWindow: BrowserWindow | undefined;
let stateStore: StateStore;
let logger: LocalLogger;
let youtube: YouTubeAdapter;
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
	const account: unknown = JSON.parse(await readFile(linkPath(), "utf8"));
	validateBrowserAccount(account);
	await writeCookies(await readYouTubeCookies(account));
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
async function importFromBrowser(account: unknown) {
	validateBrowserAccount(account);
	const cookies = await readYouTubeCookies(account);
	await session.fromPartition(authPartition).clearStorageData();
	await rm(linkPath(), { force: true });
	await writeCookies(cookies);
	youtube = createAdapter();
	const state = await authState();
	// Nothing is written for an account Nixie will not play, so a refused profile leaves no link
	// behind and the next attempt starts from nothing.
	if (state.status === "unentitled") {
		throw new Error("That account has no YouTube Music Premium subscription, which Nixie requires");
	}
	if (state.status !== "authenticated") throw new Error("That browser profile is not signed in to YouTube");
	await writeFile(linkPath(), JSON.stringify({ browser: account.browser, profile: account.profile }), {
		mode: 0o600,
	});
	return state;
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
	const bundleId = BROWSER_BUNDLE_IDS[browser];
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
	handle("local:save", (_event, value) => {
		validateState(value);
		return stateStore.save(value);
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
	// Quitting runs the `before-quit` handler below, which saves the session before the installer
	// takes over and relaunches the app.
	handle("update:install", () => autoUpdater.quitAndInstall());

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
		if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
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

async function createWindow() {
	const saved = stateStore.snapshot.windowBounds;
	// What the window is painted with until the renderer's first frame lands. It is the stored theme's
	// own `--background` from `src/styles.css`, so a light window never opens on a dark rectangle: a
	// colour fixed at one appearance is the flash the renderer's synchronous paint cannot reach.
	const theme = stateStore.snapshot.settings.theme;
	const dark = theme === "system" ? nativeTheme.shouldUseDarkColors : theme === "dark";
	mainWindow = new BrowserWindow({
		width: saved?.width ?? 1440,
		height: saved?.height ?? 900,
		x: saved?.x,
		y: saved?.y,
		minWidth: 1040,
		minHeight: 680,
		show: false,
		titleBarStyle: "hiddenInset",
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
	mainWindow.on("close", () => {
		const bounds = mainWindow?.getBounds();
		if (!bounds) return;
		const state: PersistedState = stateStore.snapshot;
		state.windowBounds = bounds;
		void stateStore.save(state);
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
		registerIpc();
		installMenu();
		await createWindow();
		// After the window, so the first state reaches a renderer that exists, and not awaited: a
		// GitHub that cannot be reached must not hold up the app it is checking.
		configureUpdater();
		await logger.write("info", "Application started");
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) void createWindow();
		});
	})
	.catch((error: unknown) => {
		void logger?.write("error", error instanceof Error ? error.message : "Application startup failed");
		dialog.showErrorBox("Nixie could not start", error instanceof Error ? error.message : "Unknown startup error");
		app.quit();
	});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

let stateSavedBeforeQuit = false;
app.on("before-quit", (event) => {
	if (stateSavedBeforeQuit || !stateStore) return;
	event.preventDefault();
	void stateStore.save(stateStore.snapshot).finally(() => {
		stateSavedBeforeQuit = true;
		app.quit();
	});
});
