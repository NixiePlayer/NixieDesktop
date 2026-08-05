import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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
	net,
	Notification,
	protocol,
	session,
	shell,
	type IpcMainInvokeEvent,
} from "electron";
import type { AudioQuality, AuthState, OfflineTrack, PersistedState, Track } from "../src/shared/contracts";
import { artistNames } from "../src/shared/entities";
import {
	validateBrowserAccount,
	validateCookieHeader,
	validateDocumentName,
	validateDownloadRequest,
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

const authPartition = "persist:noctune-auth";
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
	"img-src 'self' data: noctune:",
	"media-src 'self' noctune:",
	// `noctune:` is here because the lyrics panel fetches noctune://app/lyrics from the renderer.
	"connect-src 'self' noctune: https://lrclib.net",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
	{
		scheme: "noctune",
		privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
	},
]);

// macOS reads the name once, while the first menu is built, so setting this after `whenReady` was too
// late and the menu bar and About panel both still said "Electron".
app.setName("Noctune");

// Nothing upstream needs to know this is Electron, and YouTube serves cut-down responses to clients
// that say so, so every request goes out as the plain Chrome underneath.
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:noctune|Electron)\/\S+/gi, "");

let mainWindow: BrowserWindow | undefined;
let stateStore: StateStore;
let logger: LocalLogger;
let youtube: YouTubeAdapter;
const resources = new SecureResourceRegistry({
	log: (message) => void logger.write("error", message),
	// In development the renderer is served by Vite, so the decks fetch the stream cross-origin.
	// An Origin header carries no path, so the dev URL is reduced to its origin before comparing.
	allowedOrigins: ["noctune://app", process.env.VITE_DEV_SERVER_URL]
		.filter((value) => value !== undefined)
		.map((value) => (value.startsWith("http") ? new URL(value).origin : value)),
});
// Deferred rather than passed by value: the adapter is built on `whenReady`, this runs before it.
const lyrics = new LyricsClient((videoId) => youtube.lyrics(videoId));

function trusted(event: IpcMainInvokeEvent) {
	const url = event.senderFrame?.url ?? "";
	const devUrl = process.env.VITE_DEV_SERVER_URL;
	if (url.startsWith("noctune://app/")) return;
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

function downloadsPath() {
	return join(app.getPath("userData"), "downloads");
}

/**
 * The cover as a native image, fetched through the protocol's own host check rather than beside it.
 * macOS draws it as the notification's content image, which is the thumbnail on its trailing edge.
 */
async function artworkIcon(url: string | undefined) {
	const id = url?.startsWith("noctune://app/artwork/") ? url.split("/").at(-1) : undefined;
	if (!id || !url) return undefined;
	const response = await resources.handleArtwork(new Request(url), id).catch(() => undefined);
	if (!response?.ok) return undefined;
	const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
	return image.isEmpty() ? undefined : image;
}

/**
 * Names the track the queue moved to on its own. Nothing is drawn while the window has focus: the
 * player is on screen and already says so, and this exists for the times it is not. macOS suppresses
 * a banner from the frontmost app anyway, so this only makes that deliberate.
 *
 * ponytail: silent, and no actions on it. The one sound this app makes is the music.
 */
async function notifyTrackChange(track: Track) {
	if (!Notification.isSupported() || stateStore.snapshot.settings.notifyTrackChange === false) return;
	if (mainWindow?.isFocused()) return;
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
	notification.show();
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

async function authState(): Promise<AuthState> {
	const header = await cookieHeader();
	if (!/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=/.test(header)) return { status: "signed-out" };
	// The name and the photo are worth one request, not the sign-in gate: an account YouTube will
	// not describe is still an account, and the menu falls back to naming the service.
	const account = await youtube.account().catch(async (error: unknown) => {
		await logger.write("error", `account lookup failed: ${error instanceof Error ? error.message : "unknown"}`);
	});
	return {
		status: "authenticated",
		accountName: account?.accountName ?? "YouTube Music",
		avatarUrl: account?.avatarUrl,
	};
}

/**
 * Google rejects sign-in from any embedded browser, whatever it claims to be, and its OAuth device
 * tokens are refused by every InnerTube endpoint. Adopting the session from a real browser on this
 * Mac is what is left, so the account arrives already signed in and nobody handles a cookie by hand.
 */
async function importFromBrowser(account: unknown) {
	validateBrowserAccount(account);
	const cookies = await readYouTubeCookies(account);
	await session.fromPartition(authPartition).clearStorageData();
	await rm(linkPath(), { force: true });
	await writeCookies(cookies);
	youtube = createAdapter();
	const state = await authState();
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

async function importCookies(raw: unknown) {
	validateCookieHeader(raw);
	const authSession = session.fromPartition(authPartition);
	await authSession.clearStorageData();
	// A pasted header owns the session from here, so no browser profile gets to overwrite it.
	await rm(linkPath(), { force: true });
	for (const part of raw.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0) continue;
		const name = part.slice(0, separator).trim();
		const value = part.slice(separator + 1).trim();
		if (!name || !value) continue;
		await authSession.cookies.set({
			url: "https://www.youtube.com",
			name,
			value,
			path: "/",
			secure: true,
			httpOnly: true,
		});
	}
	youtube = createAdapter();
	const state = await authState();
	if (state.status !== "authenticated") throw new Error("The Cookie header did not create an authenticated session");
	return state;
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

function registerIpc() {
	handle("auth:state", () => authState());
	handle("auth:browsers", async () => {
		const accounts = await listBrowserAccounts(app.getApplicationNameForProtocol("https://"));
		return Promise.all(accounts.map(async (account) => ({ ...account, icon: await browserIcon(account.browser) })));
	});
	handle("auth:import-browser", (_event, account) => importFromBrowser(account));
	handle("auth:import-cookies", (_event, raw) => importCookies(raw));
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
			const offline = stateStore.snapshot.downloads.find(({ track }) => track.id === trackId);
			if (offline) {
				const file = await stat(join(downloadsPath(), trackId)).catch(() => undefined);
				if (file?.isFile()) {
					return {
						url: resources.registerOffline(join(downloadsPath(), trackId), file.size, offline.fingerprint),
						fingerprint: offline.fingerprint,
						integratedLufs: offline.integratedLufs,
					};
				}
			}
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

	handle("local:load", () => stateStore.snapshot);
	handle("local:save", (_event, value) => {
		validateState(value);
		return stateStore.save(value);
	});
	handle("local:download", async (_event, request) => {
		validateDownloadRequest(request);
		const quality = stateStore.snapshot.settings.quality;
		const completed: OfflineTrack[] = [];
		await mkdir(downloadsPath(), { recursive: true });
		try {
			for (const track of new Map(request.tracks.map((item) => [item.id, item])).values()) {
				const existing = stateStore.snapshot.downloads.find((item) => item.track.id === track.id);
				if (existing && (await stat(join(downloadsPath(), track.id)).catch(() => undefined))?.isFile()) {
					completed.push(existing);
					continue;
				}
				const resolved = await youtube.resolve(track.id, quality);
				const filePath = join(downloadsPath(), track.id);
				const temporaryPath = `${filePath}.part`;
				await resources.saveMedia(resolved.url, temporaryPath);
				await rm(filePath, { force: true });
				await rename(temporaryPath, filePath);
				completed.push({
					track,
					fingerprint: resolved.fingerprint,
					integratedLufs: resolved.integratedLufs,
				});
			}
		} finally {
			if (completed.length) {
				const state = stateStore.snapshot;
				const downloads = new Map(state.downloads.map((item) => [item.track.id, item]));
				for (const item of completed) downloads.set(item.track.id, item);
				await stateStore.save({ ...state, downloads: [...downloads.values()] });
			}
		}
		return { saved: completed.length };
	});
	handle("local:remove-download", async (_event, trackId) => {
		if (typeof trackId !== "string" || !/^[\w-]{1,256}$/.test(trackId)) throw new TypeError("Invalid track ID");
		await rm(join(downloadsPath(), trackId), { force: true });
		await stateStore.removeDownload(trackId);
	});
	handle("local:clear", async (_event, selection) => {
		if (!["session", "downloads", "all"].includes(String(selection))) throw new TypeError("Invalid clear selection");
		if (selection === "all") {
			void session.fromPartition(authPartition).clearStorageData();
			void rm(linkPath(), { force: true });
			void youtube.reset();
		}
		// Awaited, unlike the sign-out work above it: clearing downloads is the whole of what was asked
		// here, and the renderer reads the size back as soon as this resolves.
		if (selection === "downloads" || selection === "all") {
			await rm(downloadsPath(), { recursive: true, force: true });
		}
		return stateStore.clear(selection as "session" | "downloads" | "all");
	});
	handle("local:downloads-size", async () => {
		// Measured rather than summed: `OfflineTrack` records no byte count, and a directory read is one
		// syscall per file against a list the library page already holds.
		const files: string[] = await readdir(downloadsPath()).catch(() => []);
		const sizes = await Promise.all(
			files.map(async (name: string) => (await stat(join(downloadsPath(), name)).catch(() => undefined))?.size ?? 0)
		);
		return sizes.reduce((total: number, size: number) => total + size, 0);
	});
	handle("local:document", async (_event, name) => {
		validateDocumentName(name);
		// Joined onto the app path, never onto anything the renderer sent: the name indexes a fixed set.
		return readFile(join(app.getAppPath(), name), "utf8");
	});
	handle("local:export-diagnostics", exportDiagnostics);

	handle("app:info", () => ({
		version: app.getVersion(),
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		os: `macOS ${release()}`,
		arch: process.arch,
	}));
}

async function exportDiagnostics() {
	const result = await dialog.showSaveDialog(mainWindow!, {
		defaultPath: `noctune-diagnostics-${new Date().toISOString().slice(0, 10)}.log`,
		filters: [{ name: "Log", extensions: ["log"] }],
	});
	if (result.canceled || !result.filePath) return;
	await logger.export(result.filePath);
	return result.filePath;
}

function registerAppProtocol() {
	protocol.handle("noctune", async (request) => {
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
				label: "Noctune",
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
	mainWindow = new BrowserWindow({
		width: saved?.width ?? 1440,
		height: saved?.height ?? 900,
		x: saved?.x,
		y: saved?.y,
		minWidth: 1040,
		minHeight: 680,
		show: false,
		titleBarStyle: "hiddenInset",
		backgroundColor: "#0A0C12",
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
	else await mainWindow.loadURL("noctune://app/");
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
		await logger.write("info", "Application started");
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) void createWindow();
		});
	})
	.catch((error: unknown) => {
		void logger?.write("error", error instanceof Error ? error.message : "Application startup failed");
		dialog.showErrorBox("Noctune could not start", error instanceof Error ? error.message : "Unknown startup error");
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
