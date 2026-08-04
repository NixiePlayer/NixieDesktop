import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cookieExpiry, decryptCookieValue, profileIdentity, storageKeyFromPassword } from "./browser-cookies";

const key = storageKeyFromPassword("test-safe-storage");

function encrypt(value: string, hostKey?: string) {
	const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
	const prefix = hostKey ? createHash("sha256").update(hostKey).digest() : Buffer.alloc(0);
	const body = Buffer.concat([prefix, Buffer.from(value, "utf8")]);
	return Buffer.concat([Buffer.from("v10"), cipher.update(body), cipher.final()]);
}

describe("decryptCookieValue", () => {
	it("reads a value written by Chromium 130 and later, which prefixes the domain hash", () => {
		expect(decryptCookieValue(encrypt("secret-value", ".youtube.com"), key, ".youtube.com")).toBe("secret-value");
	});

	it("reads a value written by older Chromium, which has no prefix", () => {
		expect(decryptCookieValue(encrypt("secret-value"), key, ".youtube.com")).toBe("secret-value");
	});

	it("keeps a value that happens to start with 32 bytes of its own text", () => {
		const value = "x".repeat(48);
		expect(decryptCookieValue(encrypt(value, ".youtube.com"), key, ".youtube.com")).toBe(value);
	});

	it("refuses a scheme it does not know", () => {
		expect(() => decryptCookieValue(Buffer.from("v20abc"), key, ".youtube.com")).toThrow(/Unsupported/);
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
