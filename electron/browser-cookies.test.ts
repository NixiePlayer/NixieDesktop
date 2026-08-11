import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	cookieExpiry,
	decryptCbc,
	decryptGcm,
	isAppBound,
	linuxStorageKey,
	profileIdentity,
	storageKeyFromPassword,
	stripDomainHash,
	windowsWrappedKey,
} from "./browser-cookies";

const key = storageKeyFromPassword("test-safe-storage");

/** The domain hash is what Chromium 130 and later prepend to the plaintext before encrypting it. */
function body(value: string, hostKey?: string) {
	const prefix = hostKey ? createHash("sha256").update(hostKey).digest() : Buffer.alloc(0);
	return Buffer.concat([prefix, Buffer.from(value, "utf8")]);
}

function encrypt(value: string, hostKey?: string, scheme = "v10", cbcKey = key) {
	const cipher = createCipheriv("aes-128-cbc", cbcKey, Buffer.alloc(16, " "));
	const plain = body(value, hostKey);
	return Buffer.concat([Buffer.from(scheme), cipher.update(plain), cipher.final()]);
}

/** Windows writes [3-byte scheme][12-byte nonce][ciphertext][16-byte tag]. */
function encryptGcm(value: string, gcmKey: Buffer, hostKey?: string, scheme = "v10") {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", gcmKey, nonce);
	const ciphertext = Buffer.concat([cipher.update(body(value, hostKey)), cipher.final()]);
	return Buffer.concat([Buffer.from(scheme), nonce, ciphertext, cipher.getAuthTag()]);
}

describe("decryptCbc", () => {
	it("reads a value written by Chromium 130 and later, which prefixes the domain hash", () => {
		expect(decryptCbc(encrypt("secret-value", ".youtube.com"), key, ".youtube.com")).toBe("secret-value");
	});

	it("reads a value written by older Chromium, which has no prefix", () => {
		expect(decryptCbc(encrypt("secret-value"), key, ".youtube.com")).toBe("secret-value");
	});

	it("keeps a value that happens to start with 32 bytes of its own text", () => {
		const value = "x".repeat(48);
		expect(decryptCbc(encrypt(value, ".youtube.com"), key, ".youtube.com")).toBe(value);
	});

	it("reads a Linux store written under a key a keyring answered for", () => {
		const linuxKey = linuxStorageKey("peanuts");
		expect(decryptCbc(encrypt("secret-value", ".youtube.com", "v11", linuxKey), linuxKey, ".youtube.com")).toBe(
			"secret-value"
		);
	});

	it("reads a Linux store written under the fallback password, which is v10", () => {
		const linuxKey = linuxStorageKey("peanuts");
		expect(decryptCbc(encrypt("secret-value", undefined, "v10", linuxKey), linuxKey, ".youtube.com")).toBe(
			"secret-value"
		);
	});

	it("refuses a scheme it does not know", () => {
		expect(() => decryptCbc(Buffer.from("v20abc"), key, ".youtube.com")).toThrow(/Unsupported/);
	});
});

describe("decryptGcm", () => {
	const gcmKey = randomBytes(32);

	it("reads a value written by Chromium 130 and later, which prefixes the domain hash", () => {
		expect(decryptGcm(encryptGcm("secret-value", gcmKey, ".youtube.com"), gcmKey, ".youtube.com")).toBe("secret-value");
	});

	it("reads a value written by older Chromium, which has no prefix", () => {
		expect(decryptGcm(encryptGcm("secret-value", gcmKey), gcmKey, ".youtube.com")).toBe("secret-value");
	});

	it("refuses an app-bound value by name, since nothing local can reach that key", () => {
		expect(() => decryptGcm(encryptGcm("secret-value", gcmKey, undefined, "v20"), gcmKey, ".youtube.com")).toThrow(
			/app-bound/i
		);
	});

	it("refuses a scheme it does not know", () => {
		expect(() => decryptGcm(encryptGcm("secret-value", gcmKey, undefined, "v99"), gcmKey, ".youtube.com")).toThrow(
			/Unsupported/
		);
	});

	it("refuses a value whose tag does not match the key", () => {
		expect(() => decryptGcm(encryptGcm("secret-value", gcmKey), randomBytes(32), ".youtube.com")).toThrow();
	});

	it("refuses a value too short to hold a nonce and a tag", () => {
		expect(() => decryptGcm(Buffer.concat([Buffer.from("v10"), randomBytes(8)]), gcmKey, ".youtube.com")).toThrow(
			/too short/
		);
	});
});

describe("stripDomainHash", () => {
	it("drops a prefix that is the hash of the cookie's own domain", () => {
		expect(stripDomainHash(body("secret-value", ".youtube.com"), ".youtube.com")).toBe("secret-value");
	});

	it("keeps a plaintext that was never prefixed", () => {
		expect(stripDomainHash(body("secret-value"), ".youtube.com")).toBe("secret-value");
	});

	it("keeps a prefix belonging to another domain", () => {
		const plain = body("secret-value", ".google.com");
		expect(stripDomainHash(plain, ".youtube.com")).toBe(plain.toString("utf8"));
	});
});

describe("linuxStorageKey", () => {
	it("derives a different key from the same password, since Linux iterates once and macOS 1003", () => {
		expect(linuxStorageKey("peanuts").equals(storageKeyFromPassword("peanuts"))).toBe(false);
	});

	it("derives the 16 bytes AES-128 takes", () => {
		expect(linuxStorageKey("peanuts")).toHaveLength(16);
	});
});

describe("windowsWrappedKey", () => {
	const wrapped = randomBytes(32);
	const localState = (encrypted_key: unknown) => ({ os_crypt: { encrypted_key } });
	const encoded = Buffer.concat([Buffer.from("DPAPI"), wrapped]).toString("base64");

	it("strips the marker upstream writes ahead of the wrapped bytes", () => {
		expect(windowsWrappedKey(localState(encoded)).equals(wrapped)).toBe(true);
	});

	it("refuses a key stored under a marker it does not know", () => {
		const other = Buffer.concat([Buffer.from("OTHER"), wrapped]).toString("base64");
		expect(() => windowsWrappedKey(localState(other))).toThrow(/Unsupported/);
	});

	it("refuses a file that states no key at all", () => {
		expect(() => windowsWrappedKey(localState(undefined))).toThrow(/no cookie encryption key/);
		expect(() => windowsWrappedKey({})).toThrow(/no cookie encryption key/);
		expect(() => windowsWrappedKey(undefined)).toThrow(/no cookie encryption key/);
	});

	it("refuses a key that does not hold a string", () => {
		expect(() => windowsWrappedKey(localState(5))).toThrow(/no cookie encryption key/);
	});
});

describe("isAppBound", () => {
	it("reads the three bytes SQLite hands back for a blob", () => {
		expect(isAppBound(new TextEncoder().encode("v20"))).toBe(true);
		expect(isAppBound(new TextEncoder().encode("v10"))).toBe(false);
	});

	it("reads a prefix that arrived as text", () => {
		expect(isAppBound("v20")).toBe(true);
		expect(isAppBound("v10")).toBe(false);
	});

	it("states nothing for the platforms whose query asks no such thing", () => {
		expect(isAppBound(undefined)).toBe(false);
		expect(isAppBound(1)).toBe(false);
	});
});

describe("cookieExpiry", () => {
	it("converts the Chromium epoch to seconds from 1970", () => {
		// 13460848531 seconds from 1601-01-01 is 2027-08-17.
		expect(new Date(cookieExpiry(13_460_848_531)! * 1000).toISOString().slice(0, 4)).toBe("2027");
	});

	it("treats zero as a session cookie", () => {
		expect(cookieExpiry(0)).toBeUndefined();
	});
});

describe("profileIdentity", () => {
	const localState = {
		profile: {
			info_cache: {
				"Default": {
					name: "Ada's profile",
					gaia_name: "Ada Lovelace",
					user_name: "someone@gmail.com",
					gaia_picture_file_name: "Google Profile Picture.png",
				},
				"Profile 1": { name: "Person 1" },
				"Profile 2": {
					name: "Il tuo Chrome",
					gaia_name: "Ada Lovelace",
					is_using_default_name: true,
				},
				"Profile 3": { name: "Person 3", is_using_default_name: true },
			},
		},
	};

	it("reads the name, account and picture a profile states", () => {
		expect(profileIdentity(localState, "Default")).toEqual({
			accountName: "Ada's profile",
			accountEmail: "someone@gmail.com",
			picture: "Google Profile Picture.png",
		});
	});

	it("names the account rather than the name Chrome wrote itself, in Chrome's own language", () => {
		expect(profileIdentity(localState, "Profile 2")?.accountName).toBe("Ada Lovelace");
	});

	it("keeps Chrome's default name when no account is signed in to state one", () => {
		expect(profileIdentity(localState, "Profile 3")?.accountName).toBe("Person 3");
	});

	it("leaves out what a signed-out profile does not state", () => {
		expect(profileIdentity(localState, "Profile 1")).toEqual({
			accountName: "Person 1",
			accountEmail: undefined,
			picture: undefined,
		});
	});

	it("states nothing for a profile the file does not list", () => {
		expect(profileIdentity(localState, "Profile 9")).toBeUndefined();
	});

	it("states nothing for a file it cannot read", () => {
		expect(profileIdentity(undefined, "Default")).toBeUndefined();
		expect(profileIdentity({ profile: {} }, "Default")).toBeUndefined();
	});

	it("states nothing for a field that does not hold a string", () => {
		const malformed = { profile: { info_cache: { Default: { name: {}, user_name: 5 } } } };
		expect(profileIdentity(malformed, "Default")).toEqual({
			accountName: undefined,
			accountEmail: undefined,
			picture: undefined,
		});
	});
});
