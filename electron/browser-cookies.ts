import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { access, copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { BrowserAccount } from "../src/shared/contracts";
import type { SessionCookie } from "../src/shared/youtube-cookies";

const execFileAsync = promisify(execFile);

/**
 * Google refuses to sign in from an embedded browser, so the account has to come from a real one.
 * Every Chromium fork keeps the same cookie store in the same shape, so a browser is a row of names:
 * where it puts its user data on each of the three platforms, and what it calls its own key in the
 * one secret store that platform has. None of the three can be derived from the others, and none of
 * them follows the browser's own name (Edge is "Microsoft Edge" on macOS and "Microsoft/Edge/User
 * Data" on Windows), so all five are stated.
 */
interface ChromiumBrowser {
	name: string;
	mac: string;
	win: string;
	linux: string;
	/** The Keychain service and account, both named after the browser rather than after its vendor. */
	keychain: string;
	/**
	 * The `application` attribute the fork stores its Secret Service item under. Edge and Chromium
	 * both ship upstream's own default, so two browsers share one id and neither is a typo.
	 */
	secret: string;
}

const CHROMIUM_BROWSERS: ChromiumBrowser[] = [
	{
		name: "Chrome",
		mac: "Google/Chrome",
		win: "Google/Chrome/User Data",
		linux: "google-chrome",
		keychain: "Chrome",
		secret: "chrome",
	},
	{
		name: "Brave",
		mac: "BraveSoftware/Brave-Browser",
		win: "BraveSoftware/Brave-Browser/User Data",
		linux: "BraveSoftware/Brave-Browser",
		keychain: "Brave",
		secret: "brave",
	},
	{
		name: "Edge",
		mac: "Microsoft Edge",
		win: "Microsoft/Edge/User Data",
		linux: "microsoft-edge",
		keychain: "Microsoft Edge",
		secret: "chromium",
	},
	{
		name: "Vivaldi",
		mac: "Vivaldi",
		win: "Vivaldi/User Data",
		linux: "vivaldi",
		keychain: "Vivaldi",
		secret: "vivaldi",
	},
	{
		name: "Chromium",
		mac: "Chromium",
		win: "Chromium/User Data",
		linux: "chromium",
		keychain: "Chromium",
		secret: "chromium",
	},
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
	chromium?: ChromiumBrowser;
}

// One cookie shape across the app. The disk read here and the extension pull both produce it, and
// `writeCookies` takes it, so it lives once in `src/shared` rather than being restated per producer.
export type ImportedCookie = SessionCookie;

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

/**
 * `Local State` and the profile directories sit directly under this on every platform, so the whole
 * platform difference is the path itself. Windows is the one that is not under the home directory:
 * a roaming profile would sync a cookie store keyed to a machine that cannot decrypt it elsewhere,
 * so every fork puts its user data in `LOCALAPPDATA`.
 */
function chromiumRoot(browser: ChromiumBrowser) {
	if (process.platform === "darwin")
		return join(homedir(), "Library", "Application Support", ...browser.mac.split("/"));
	if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? homedir(), ...browser.win.split("/"));
	// XDG_CONFIG_HOME rather than a hard-coded `.config`, to match native-host-register: a reader who
	// sets it would otherwise get a registered host and an empty profile list.
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), ...browser.linux.split("/"));
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

/**
 * Sandboxing the network service moved the cookie store down into a `Network` directory of its own,
 * and a profile that predates that move keeps it where it was, so one machine can hold both shapes.
 * Windows and Linux are already entirely on the moved one, which is why this cannot stay implicit.
 */
async function cookieStore(profileDirectory: string) {
	const moved = join(profileDirectory, "Network", "Cookies");
	const exists = await access(moved).then(
		() => true,
		() => false
	);
	return exists ? moved : join(profileDirectory, "Cookies");
}

/** Every profile this platform can read, whether or not it holds a YouTube session. */
async function locateProfiles(): Promise<ProfileLocation[]> {
	const locations: ProfileLocation[] = [];
	for (const browser of CHROMIUM_BROWSERS) {
		const root = chromiumRoot(browser);
		const entries = await readdir(root).catch(() => []);
		for (const profile of entries
			.filter((entry) => CHROMIUM_PROFILE.test(entry))
			.sort((first, second) => first.localeCompare(second))) {
			locations.push({
				browser: browser.name,
				profile,
				label: profile === "Default" ? undefined : profile,
				cookiePath: await cookieStore(join(root, profile)),
				root,
				chromium: browser,
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
	// mkdtemp rather than a named file in the temp root: Firefox stores its cookie values in the clear,
	// and on Linux the temp root is `/tmp`, shared by every user. mkdtemp creates a 0700 directory, so
	// the copy inside it is unreadable to anyone else even though the temp root is listable. macOS and
	// Windows have a per-user temp directory, but the directory is the honest fix on all three.
	const dir = await mkdtemp(join(tmpdir(), "nixie-cookies-"));
	const copy = join(dir, "db");
	let database: DatabaseSync | undefined;
	try {
		await copyFile(path, copy);
		// Recent writes can still be sitting in the write-ahead log.
		await copyFile(`${path}-wal`, `${copy}-wal`).catch(() => undefined);
		database = new DatabaseSync(copy, { readOnly: true });
		return read(database);
	} finally {
		try {
			database?.close();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
}

/**
 * Chromium counts from 1601-01-01, cookies count from the epoch, and 0 means a session cookie.
 * The query divides the raw microseconds down first because they overflow a JavaScript number.
 */
export function cookieExpiry(expiresSeconds: number) {
	return expiresSeconds > 0 ? expiresSeconds - 11_644_473_600 : undefined;
}

/** Chromium 130 and later prefix the plaintext with a hash of the cookie's own domain. */
export function stripDomainHash(plain: Buffer, hostKey: string) {
	const domainHash = createHash("sha256").update(hostKey).digest();
	return (plain.subarray(0, 32).equals(domainHash) ? plain.subarray(32) : plain).toString("utf8");
}

/**
 * The three-byte prefix names where the key came from and not what the value was encrypted with, so
 * it cannot select the cipher on its own: macOS and Linux both write `v10` over AES-128-CBC, and
 * Windows writes the same `v10` over AES-256-GCM. `v11` is Linux's word for a key a real keyring
 * answered for, against the `v10` it writes when it fell back to the hard-coded password, and both
 * are the same cipher over a key derived the same way.
 */
const CBC_SCHEMES = new Set(["v10", "v11"]);

export function decryptCbc(encrypted: Uint8Array, key: Buffer, hostKey: string) {
	const buffer = Buffer.from(encrypted);
	if (!CBC_SCHEMES.has(buffer.subarray(0, 3).toString("utf8"))) throw new Error("Unsupported cookie encryption");
	const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
	const plain = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]);
	return stripDomainHash(plain, hostKey);
}

const GCM_NONCE_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

/** Chrome 127 and later wrap the key a second time and hand it back to their own signed binary only. */
export const APP_BOUND_SCHEME = "v20";

export function decryptGcm(encrypted: Uint8Array, key: Buffer, hostKey: string) {
	const buffer = Buffer.from(encrypted);
	const scheme = buffer.subarray(0, 3).toString("utf8");
	// App-bound is a refusal rather than a gap: the elevation service behind it validates the calling
	// executable's own signature, so nothing Nixie can do reaches that key, and a profile written under
	// it has to be listed as unreadable rather than attempted. The message is what says which it was.
	if (scheme === APP_BOUND_SCHEME) throw new Error("App-bound encryption is not supported");
	if (scheme !== "v10") throw new Error("Unsupported cookie encryption");
	// A buffer shorter than the prefix, nonce and tag has no ciphertext, and slicing it would hand an
	// empty body and a short tag to the cipher. The per-row caller already swallows a throw, but this is
	// exported and unit tested on its own.
	if (buffer.length < 3 + GCM_NONCE_LENGTH + GCM_TAG_LENGTH) throw new Error("Cookie value too short");
	const nonce = buffer.subarray(3, 3 + GCM_NONCE_LENGTH);
	const body = buffer.subarray(3 + GCM_NONCE_LENGTH, buffer.length - GCM_TAG_LENGTH);
	const decipher = createDecipheriv("aes-256-gcm", key, nonce);
	decipher.setAuthTag(buffer.subarray(buffer.length - GCM_TAG_LENGTH));
	return stripDomainHash(Buffer.concat([decipher.update(body), decipher.final()]), hostKey);
}

export function storageKeyFromPassword(password: string) {
	return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

/** Same salt and same length as macOS, one iteration rather than 1003. Upstream never unified them. */
export function linuxStorageKey(password: string) {
	return pbkdf2Sync(password, "saltysalt", 1, 16, "sha1");
}

/**
 * Windows keeps its key in `Local State` rather than in any secret store, wrapped with DPAPI under
 * the logged-in user and tagged with a five-byte marker upstream strips before unwrapping. Reading
 * it is pure, unwrapping it is not, so the two are separate.
 */
export function windowsWrappedKey(localState: unknown) {
	const encoded = (localState as { os_crypt?: { encrypted_key?: unknown } })?.os_crypt?.encrypted_key;
	if (typeof encoded !== "string" || !encoded) throw new Error("Browser states no cookie encryption key");
	const wrapped = Buffer.from(encoded, "base64");
	if (wrapped.subarray(0, 5).toString("utf8") !== "DPAPI") throw new Error("Unsupported cookie encryption key");
	return wrapped.subarray(5);
}

/** Reading this is what raises the one permission prompt the user has to approve. */
async function keychainPassword(keychain: string) {
	const { stdout } = await execFileAsync("/usr/bin/security", [
		"find-generic-password",
		"-w",
		"-s",
		`${keychain} Safe Storage`,
		"-a",
		keychain,
	]);
	return stdout.trim();
}

/**
 * `secret-tool` ships with libsecret and is the only way to the Secret Service that costs no
 * dependency, but it is not installed everywhere and no keyring may be running at all. Both are the
 * same answer as an empty lookup, since Chromium falls back to a hard-coded password in exactly
 * those cases and a store written under that fallback stays readable with it.
 */
async function secretToolPassword(secret: string) {
	const { stdout } = await execFileAsync("secret-tool", ["lookup", "application", secret]).catch(() => ({
		stdout: "",
	}));
	return stdout.trim() || undefined;
}

/**
 * DPAPI has no interface outside the Win32 API: no command of its own, and unwrapping in process
 * would need a native module. PowerShell is on every Windows install and reaches .NET, so it is
 * spawned for this and for nothing else. `-Command` concatenates its remaining arguments into one
 * command string and reparses it, so the wrapped key is safe not because it stays out of the parser
 * but because it is re-encoded base64 (`A-Za-z0-9+/=`), none of which is a metacharacter where it
 * lands after the script block. It is passed as a trailing argument rather than interpolated so a
 * future edit cannot turn it into code.
 */
const DPAPI_SCRIPT =
	"& { Add-Type -AssemblyName System.Security; [Convert]::ToBase64String(" +
	"[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($args[0]), $null, 'CurrentUser')) }";

// The absolute path, never the bare name: the app installs per user into a writable directory that is
// also the process working directory, and libuv searches the working directory before PATH on Windows,
// so a planted `powershell.exe` beside the app would otherwise run with the app's identity and be
// handed the wrapped key. macOS uses `/usr/bin/security` for the same reason.
function windowsSystem32(exe: string) {
	return join(process.env.SystemRoot ?? "C:\\Windows", "System32", exe);
}

async function dpapiUnprotect(wrapped: Buffer) {
	const { stdout } = await execFileAsync(windowsSystem32("WindowsPowerShell\\v1.0\\powershell.exe"), [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		DPAPI_SCRIPT,
		wrapped.toString("base64"),
	]);
	const key = Buffer.from(stdout.trim(), "base64");
	// A refusal comes back as an empty stdout rather than a non-zero exit, so the length is the check.
	// Constrained Language Mode (WDAC, AppLocker) blocks Add-Type, which is one way this arrives empty.
	if (key.length !== 32) throw new Error("Unusable cookie encryption key");
	return key;
}

interface StorageKey {
	key: Buffer;
	scheme: "cbc" | "gcm";
}

/**
 * One browser's key, held for as long as the app runs. `cookieHeader` re-reads the linked profile
 * every minute, and each read would otherwise be a Keychain dialog, a keyring lookup or a PowerShell
 * process. It is keyed by root rather than by profile, since a fork encrypts every profile it holds
 * with the same key. A rejection is dropped rather than held: a keyring that was locked when it was
 * asked answers once it is unlocked, and the next minute is the next chance.
 */
const storageKeys = new Map<string, Promise<StorageKey>>();

function storageKey(browser: ChromiumBrowser, root: string) {
	const held = storageKeys.get(root);
	if (held) return held;
	const pending = resolveStorageKey(browser, root);
	storageKeys.set(root, pending);
	void pending.catch(() => storageKeys.delete(root));
	return pending;
}

async function resolveStorageKey(browser: ChromiumBrowser, root: string): Promise<StorageKey> {
	if (process.platform === "darwin") {
		return { key: storageKeyFromPassword(await keychainPassword(browser.keychain)), scheme: "cbc" };
	}
	if (process.platform === "win32") {
		const localState: unknown = JSON.parse(await readFile(join(root, "Local State"), "utf8"));
		return { key: await dpapiUnprotect(windowsWrappedKey(localState)), scheme: "gcm" };
	}
	// "peanuts" is upstream's own literal, used whenever no Secret Service answered for this browser.
	return { key: linuxStorageKey((await secretToolPassword(browser.secret)) ?? "peanuts"), scheme: "cbc" };
}

const SIGNED_IN = {
	chromium: "SELECT 1 AS held FROM cookies WHERE host_key LIKE '%youtube.com' AND name = 'SAPISID' LIMIT 1",
	// Windows is the one platform that can hold a session it cannot read, so the row is asked what
	// scheme it was written under. `substr` over a BLOB is bytes rather than characters, and reading
	// three of them raises no prompt and touches no key: this runs for every profile on every listing.
	windows:
		"SELECT substr(encrypted_value, 1, 3) AS scheme FROM cookies WHERE host_key LIKE '%youtube.com' AND name = 'SAPISID' LIMIT 1",
	firefox: "SELECT 1 AS held FROM moz_cookies WHERE host LIKE '%youtube.com' AND name = 'SAPISID' LIMIT 1",
};

/**
 * A profile whose values are app-bound is offered to nobody: listing it would put a row on the
 * sign-in screen that can only fail once it is pressed, and the failure names an elevation service
 * rather than anything the reader can act on.
 */
export function isAppBound(scheme: unknown) {
	if (typeof scheme === "string") return scheme === APP_BOUND_SCHEME;
	if (!(scheme instanceof Uint8Array)) return false;
	return Buffer.from(scheme).toString("utf8") === APP_BOUND_SCHEME;
}

/** Browser profiles holding a YouTube session. Reading names needs no access to any stored secret. */
export async function listBrowserAccounts(defaultBrowser?: string): Promise<BrowserAccount[]> {
	const accounts: BrowserAccount[] = [];
	// One `Local State` covers a whole browser, so it is read once rather than once per profile.
	const localStates = new Map<string, unknown>();
	for (const location of await locateProfiles()) {
		const query = location.chromium
			? process.platform === "win32"
				? SIGNED_IN.windows
				: SIGNED_IN.chromium
			: SIGNED_IN.firefox;
		const signedIn = await withCookieDatabase(location.cookiePath, (database) => database.prepare(query).get()).catch(
			() => undefined
		);
		if (!signedIn) continue;
		// Only the Windows query states a scheme, so only Windows drops a profile here. The other two
		// are listed optimistically: what makes a profile unreadable there is a Keychain refusal or a
		// locked keyring, and asking either of them once per profile just to draw a list is the prompt
		// storm the import itself is allowed to raise once.
		if (isAppBound((signedIn as { scheme?: unknown }).scheme)) continue;

		// Firefox states none of this, so its rows carry the label they already had and nothing else.
		if (!location.chromium) {
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

	if (!location.chromium) {
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

	const { key, scheme } = await storageKey(location.chromium, location.root);
	const rows = await withCookieDatabase(location.cookiePath, (database) =>
		database
			.prepare(
				"SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly, expires_utc / 1000000 AS expires_seconds FROM cookies WHERE host_key LIKE '%youtube.com'"
			)
			.all()
	);

	const cookies: ImportedCookie[] = [];
	const decrypt = scheme === "gcm" ? decryptGcm : decryptCbc;
	for (const row of rows as unknown as ChromiumRow[]) {
		let value = row.value;
		if (!value) {
			try {
				// Older rows are stored in the clear, everything current is encrypted.
				value = decrypt(row.encrypted_value, key, row.host_key);
			} catch {
				// One cookie the store will not give up is not worth failing the import over. A profile
				// caught mid-migration to app-bound keys carries both schemes at once, and what the
				// session needs is SAPISID and its neighbours rather than every row in the store.
				continue;
			}
		}
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
