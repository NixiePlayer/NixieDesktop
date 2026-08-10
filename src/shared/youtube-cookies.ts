/**
 * The cookies a YouTube InnerTube session is built from, and the trust boundary the browser extension
 * feeds. The extension reads these in the browser's own context and hands them over the native host,
 * so what arrives is data from another process and is validated here before it reaches the auth
 * partition. The disk-read path in `electron/browser-cookies.ts` needs none of this: it reads the
 * store itself and shapes its own rows.
 */

/** The one shape a cookie takes across the app, identical to `ImportedCookie` in browser-cookies.ts. */
export interface SessionCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	expirationDate?: number;
}

/**
 * The names a linked session actually needs. A payload naming anything else is dropped rather than
 * carried, since the header is built from `.youtube.com` cookies alone and a name outside this set is
 * either noise or something an extension had no business sending.
 */
export const YOUTUBE_COOKIE_NAMES = new Set([
	"SID",
	"HSID",
	"SSID",
	"APISID",
	"SAPISID",
	"__Secure-1PSID",
	"__Secure-3PSID",
	"__Secure-1PSIDTS",
	"__Secure-3PSIDTS",
	"__Secure-1PAPISID",
	"__Secure-3PAPISID",
	"__Secure-1PSIDCC",
	"__Secure-3PSIDCC",
	"SIDCC",
	"LOGIN_INFO",
	"PREF",
	"VISITOR_INFO1_LIVE",
	"VISITOR_PRIVACY_METADATA",
	"YSC",
	"SOCS",
	"CONSENT",
	"__Secure-ROLLOUT_TOKEN",
]);

const MAX_COOKIES = 32;
const MAX_VALUE_LENGTH = 4096;
// RFC 6265 cookie-octet: printable ASCII without space, and without the four characters that would let
// a value carry structure into the store (`"`, `,`, `;`, `\`). The value goes into Chromium's own
// cookie store through `cookies.set`, which reparses it, so this refuses ahead of that what a `;` in a
// value could otherwise smuggle: a second name the allowlist would have rejected.
const VALUE = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;

function valid(cookie: unknown): cookie is SessionCookie {
	if (typeof cookie !== "object" || cookie === null) return false;
	const record = cookie as Record<string, unknown>;
	if (typeof record.name !== "string" || !YOUTUBE_COOKIE_NAMES.has(record.name)) return false;
	if (typeof record.value !== "string" || record.value.length > MAX_VALUE_LENGTH || !VALUE.test(record.value)) {
		return false;
	}
	if (
		typeof record.domain !== "string" ||
		!(record.domain === "youtube.com" || record.domain.endsWith(".youtube.com"))
	) {
		return false;
	}
	if (typeof record.path !== "string" || !record.path.startsWith("/")) return false;
	if (typeof record.secure !== "boolean" || typeof record.httpOnly !== "boolean") return false;
	if (record.expirationDate !== undefined && !Number.isFinite(record.expirationDate)) return false;
	return true;
}

/**
 * The whole payload passes or the whole payload is dropped. Half a session is worse than none: it
 * browses and does not play, which reads as the app failing rather than as a bad handoff, so a single
 * malformed cookie refuses the lot rather than being quietly skipped.
 */
export function sanitizeCookies(input: unknown): SessionCookie[] | undefined {
	if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COOKIES) return undefined;
	const cookies: SessionCookie[] = [];
	for (const entry of input) {
		if (!valid(entry)) return undefined;
		cookies.push({
			name: entry.name,
			value: entry.value,
			domain: entry.domain,
			path: entry.path,
			secure: entry.secure,
			httpOnly: entry.httpOnly,
			expirationDate: entry.expirationDate,
		});
	}
	return cookies;
}
