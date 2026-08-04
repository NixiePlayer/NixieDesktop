import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { copyFile, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { BrowserAccount } from "../src/shared/contracts";

const execFileAsync = promisify(execFile);

/**
 * Google refuses to sign in from an embedded browser, so the account has to come from a real one.
 * Every Chromium fork keeps the same cookie store in the same shape, so a browser is three strings.
 */
const CHROMIUM_BROWSERS = [
	{ name: "Chrome", directory: "Google/Chrome", keychain: "Chrome" },
	{ name: "Brave", directory: "BraveSoftware/Brave-Browser", keychain: "Brave" },
	{ name: "Edge", directory: "Microsoft Edge", keychain: "Microsoft Edge" },
	{ name: "Vivaldi", directory: "Vivaldi", keychain: "Vivaldi" },
	{ name: "Chromium", directory: "Chromium", keychain: "Chromium" },
];

/**
 * Used for one thing: finding an installed browser so its own icon can be shown. It is a table of
 * its own rather than a field on `CHROMIUM_BROWSERS`, since Firefox is not in that table.
 */
export const BROWSER_BUNDLE_IDS: Record<string, string> = {
	Chrome: "com.google.Chrome",
	Brave: "com.brave.Browser",
	Edge: "com.microsoft.edgemac",
	Vivaldi: "com.vivaldi.Vivaldi",
	Chromium: "org.chromium.Chromium",
	Firefox: "org.mozilla.firefox",
};

const CHROMIUM_PROFILE = /^(?:Default|Profile \d{1,3})$/;
const FIREFOX_DEFAULT_PROFILE = /^default(?:-release)?$/;

interface ProfileLocation extends BrowserAccount {
	cookiePath: string;
	/** The browser's own root, which is where `Local State` and the profile directories live. */
	root: string;
	/** Set for Chromium stores, whose values are encrypted. Firefox stores its values in the clear. */
	keychain?: string;
}

export interface ImportedCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	expirationDate?: number;
}

interface ChromiumRow {
	host_key: string;
	name: string;
	value: string;
	encrypted_value: Uint8Array;
	path: string;
	is_secure: number;
	is_httponly: number;
	expires_seconds: number;
}

interface FirefoxRow {
	host: string;
	name: string;
	value: string;
	path: string;
	isSecure: number;
	isHttpOnly: number;
	expiry: number;
}

function chromiumRoot(directory: string) {
	// ponytail: the encrypted stores are readable on macOS only. Windows guards its key with DPAPI
	// behind Chrome's app-bound elevation service and Linux keeps it in the Secret Service, so give
	// each one its own key source when the app ships there. Firefox below already works everywhere.
	return process.platform === "darwin" ? join(homedir(), "Library", "Application Support", directory) : undefined;
}

function firefoxRoot() {
	if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Firefox");
	if (process.platform === "win32") return join(process.env.APPDATA ?? homedir(), "Mozilla", "Firefox");
	return join(homedir(), ".mozilla", "firefox");
}

interface ChromiumProfileInfo {
	name?: string;
	gaia_name?: string;
	is_using_default_name?: boolean;
	user_name?: string;
	gaia_picture_file_name?: string;
}

/**
 * A Chromium fork keeps `Local State` beside its profiles: plain JSON, one file for the whole
 * browser, and no Keychain access of any kind. It is the only place a profile's display name and
 * its signed-in account are stated without decrypting anything.
 */
// The file states its own shape, but nothing enforces it: a field can arrive as an object or a
// number, and that value is a React child once it reaches the sign-in screen, so only a real,
// non-empty string survives the read.
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export function profileIdentity(localState: unknown, profile: string) {
	const cache = (localState as { profile?: { info_cache?: Record<string, ChromiumProfileInfo> } })?.profile?.info_cache;
	const info = cache?.[profile];
	if (!info) return undefined;
	// A profile nobody renamed carries a name Chrome wrote itself, in Chrome's own UI language rather
	// than this reader's ("Il tuo Chrome", "Person 1"), which names no account at all. `gaia_name` is
	// the signed-in account's own name and is not localised, so it stands in wherever Chrome flags its
	// name as the default one. A name the reader chose is theirs and is kept as it is.
	return {
		accountName: (info.is_using_default_name ? text(info.gaia_name) : undefined) ?? text(info.name),
		accountEmail: text(info.user_name),
		picture: text(info.gaia_picture_file_name),
	};
}

/** Every profile this platform can read, whether or not it holds a YouTube session. */
async function locateProfiles(): Promise<ProfileLocation[]> {
	const locations: ProfileLocation[] = [];
	for (const browser of CHROMIUM_BROWSERS) {
		const root = chromiumRoot(browser.directory);
		if (!root) continue;
		const entries = await readdir(root).catch(() => []);
		for (const profile of entries
			.filter((entry) => CHROMIUM_PROFILE.test(entry))
			.sort((first, second) => first.localeCompare(second))) {
			locations.push({
				browser: browser.name,
				profile,
				label: profile === "Default" ? undefined : profile,
				cookiePath: join(root, profile, "Cookies"),
				root,
				keychain: browser.keychain,
			});
		}
	}

	const profiles = join(firefoxRoot(), "Profiles");
	for (const profile of (await readdir(profiles).catch(() => [])).sort((first, second) =>
		first.localeCompare(second)
	)) {
		// Firefox names a profile directory `<random>.<name>`, and only the name is worth showing.
		const name = profile.slice(profile.indexOf(".") + 1);
		locations.push({
			browser: "Firefox",
			profile,
			label: FIREFOX_DEFAULT_PROFILE.test(name) ? undefined : name,
			cookiePath: join(profiles, profile, "cookies.sqlite"),
			root: profiles,
		});
	}
	return locations;
}

/** The browser keeps its store locked while running, so every read happens against a throwaway copy. */
async function withCookieDatabase<T>(path: string, read: (database: DatabaseSync) => T) {
	const copy = join(tmpdir(), `noctune-cookies-${randomBytes(8).toString("hex")}`);
	await copyFile(path, copy);
	// Recent writes can still be sitting in the write-ahead log.
	await copyFile(`${path}-wal`, `${copy}-wal`).catch(() => undefined);
	const database = new DatabaseSync(copy, { readOnly: true });
	try {
		return read(database);
	} finally {
		database.close();
		await rm(copy, { force: true });
		await rm(`${copy}-wal`, { force: true });
	}
}

/**
 * Chromium counts from 1601-01-01, cookies count from the epoch, and 0 means a session cookie.
 * The query divides the raw microseconds down first because they overflow a JavaScript number.
 */
export function cookieExpiry(expiresSeconds: number) {
	return expiresSeconds > 0 ? expiresSeconds - 11_644_473_600 : undefined;
}

export function decryptCookieValue(encrypted: Uint8Array, key: Buffer, hostKey: string) {
	const buffer = Buffer.from(encrypted);
	if (buffer.subarray(0, 3).toString("utf8") !== "v10") throw new Error("Unsupported cookie encryption");
	const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
	const plain = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]);
	// Chromium 130 and later prefix the plaintext with a hash of the cookie's own domain.
	const domainHash = createHash("sha256").update(hostKey).digest();
	return (plain.subarray(0, 32).equals(domainHash) ? plain.subarray(32) : plain).toString("utf8");
}

export function storageKeyFromPassword(password: string) {
	return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

/** Reading this is what raises the one permission prompt the user has to approve. */
async function storageKey(keychain: string) {
	const { stdout } = await execFileAsync("/usr/bin/security", [
		"find-generic-password",
		"-w",
		"-s",
		`${keychain} Safe Storage`,
		"-a",
		keychain,
	]);
	return storageKeyFromPassword(stdout.trim());
}

const SIGNED_IN = {
	chromium: "SELECT 1 FROM cookies WHERE host_key LIKE '%youtube.com' AND name = 'SAPISID' LIMIT 1",
	firefox: "SELECT 1 FROM moz_cookies WHERE host LIKE '%youtube.com' AND name = 'SAPISID' LIMIT 1",
};

/** Browser profiles holding a YouTube session. Reading names needs no access to any stored secret. */
export async function listBrowserAccounts(defaultBrowser?: string): Promise<BrowserAccount[]> {
	const accounts: BrowserAccount[] = [];
	// One `Local State` covers a whole browser, so it is read once rather than once per profile.
	const localStates = new Map<string, unknown>();
	for (const location of await locateProfiles()) {
		const signedIn = await withCookieDatabase(location.cookiePath, (database) =>
			database.prepare(location.keychain ? SIGNED_IN.chromium : SIGNED_IN.firefox).get()
		).catch(() => undefined);
		if (!signedIn) continue;

		// Firefox states none of this, so its rows carry the label they already had and nothing else.
		if (!location.keychain) {
			accounts.push({ browser: location.browser, profile: location.profile, label: location.label });
			continue;
		}
		if (!localStates.has(location.root)) {
			localStates.set(
				location.root,
				await readFile(join(location.root, "Local State"), "utf8")
					.then((raw) => JSON.parse(raw) as unknown)
					.catch(() => undefined)
			);
		}
		const identity = profileIdentity(localStates.get(location.root), location.profile);
		// The picture crosses the bridge as a data URL, so the renderer holds no filesystem path.
		// The name comes out of another application's file, so it is not trusted to stay inside
		// the profile directory: basename strips any path it tries to walk out on.
		const avatar = identity?.picture
			? await readFile(join(location.root, location.profile, basename(identity.picture)))
					.then((file) => `data:image/png;base64,${file.toString("base64")}`)
					.catch(() => undefined)
			: undefined;
		accounts.push({
			browser: location.browser,
			profile: location.profile,
			label: location.label,
			accountName: identity?.accountName,
			accountEmail: identity?.accountEmail,
			avatar,
		});
	}
	// Whatever opens links is the browser the user is most likely signed in to, so offer it first.
	const preferred = ({ browser }: BrowserAccount) =>
		Number(Boolean(defaultBrowser?.toLowerCase().includes(browser.toLowerCase())));
	return accounts.sort((first, second) => preferred(second) - preferred(first));
}

export async function readYouTubeCookies(account: BrowserAccount): Promise<ImportedCookie[]> {
	// Matching against what was found is what keeps a renderer value out of the path it reads.
	const location = (await locateProfiles()).find(
		(candidate) => candidate.browser === account.browser && candidate.profile === account.profile
	);
	if (!location) throw new Error("Unsupported browser profile");

	if (!location.keychain) {
		const rows = await withCookieDatabase(location.cookiePath, (database) =>
			database
				.prepare(
					"SELECT host, name, value, path, isSecure, isHttpOnly, expiry FROM moz_cookies WHERE host LIKE '%youtube.com'"
				)
				.all()
		);
		return (rows as unknown as FirefoxRow[])
			.filter((row) => row.value)
			.map((row) => ({
				name: row.name,
				value: row.value,
				domain: row.host,
				path: row.path,
				secure: Boolean(row.isSecure),
				httpOnly: Boolean(row.isHttpOnly),
				// Firefox already stores seconds from the epoch, and 0 means a session cookie.
				expirationDate: row.expiry > 0 ? row.expiry : undefined,
			}));
	}

	const key = await storageKey(location.keychain);
	const rows = await withCookieDatabase(location.cookiePath, (database) =>
		database
			.prepare(
				"SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly, expires_utc / 1000000 AS expires_seconds FROM cookies WHERE host_key LIKE '%youtube.com'"
			)
			.all()
	);

	const cookies: ImportedCookie[] = [];
	for (const row of rows as unknown as ChromiumRow[]) {
		// Older rows are stored in the clear, everything current is encrypted.
		const value = row.value || decryptCookieValue(row.encrypted_value, key, row.host_key);
		if (!value) continue;
		cookies.push({
			name: row.name,
			value,
			domain: row.host_key,
			path: row.path,
			secure: Boolean(row.is_secure),
			httpOnly: Boolean(row.is_httponly),
			expirationDate: cookieExpiry(row.expires_seconds),
		});
	}
	return cookies;
}
