import { describe, expect, it } from "vitest";
import { sanitizeCookies } from "./youtube-cookies";

function cookie(overrides: Record<string, unknown> = {}) {
	return {
		name: "SAPISID",
		value: "abc123",
		domain: ".youtube.com",
		path: "/",
		secure: true,
		httpOnly: false,
		expirationDate: 1_800_000_000,
		...overrides,
	};
}

describe("sanitizeCookies", () => {
	it("keeps a well-formed payload", () => {
		const result = sanitizeCookies([cookie(), cookie({ name: "SID", value: "x" })]);
		expect(result).toHaveLength(2);
		expect(result?.[0]?.name).toBe("SAPISID");
	});

	it("carries a session cookie whose expirationDate is absent", () => {
		const result = sanitizeCookies([cookie({ expirationDate: undefined })]);
		expect(result?.[0]?.expirationDate).toBeUndefined();
	});

	it("refuses an empty array", () => {
		expect(sanitizeCookies([])).toBeUndefined();
	});

	it("refuses more than the cap", () => {
		expect(sanitizeCookies(Array.from({ length: 33 }, () => cookie()))).toBeUndefined();
	});

	it("refuses the whole payload over one unknown name", () => {
		expect(sanitizeCookies([cookie(), cookie({ name: "TRACKING_COOKIE" })])).toBeUndefined();
	});

	it("refuses a value with a control character", () => {
		expect(sanitizeCookies([cookie({ value: "abc\ndef" })])).toBeUndefined();
	});

	it("refuses a value that is too long", () => {
		expect(sanitizeCookies([cookie({ value: "a".repeat(4097) })])).toBeUndefined();
	});

	it("refuses a domain outside youtube.com", () => {
		expect(sanitizeCookies([cookie({ domain: "evil.com" })])).toBeUndefined();
		expect(sanitizeCookies([cookie({ domain: "notyoutube.com" })])).toBeUndefined();
	});

	it("accepts the bare and the dotted youtube.com domain", () => {
		expect(sanitizeCookies([cookie({ domain: "youtube.com" })])).toHaveLength(1);
		expect(sanitizeCookies([cookie({ domain: ".youtube.com" })])).toHaveLength(1);
	});

	it("refuses a path that is not rooted", () => {
		expect(sanitizeCookies([cookie({ path: "relative" })])).toBeUndefined();
	});

	it("refuses a non-boolean flag", () => {
		expect(sanitizeCookies([cookie({ secure: "yes" })])).toBeUndefined();
	});

	it("refuses a non-finite expirationDate", () => {
		expect(sanitizeCookies([cookie({ expirationDate: Infinity })])).toBeUndefined();
	});

	it("refuses a non-array", () => {
		expect(sanitizeCookies("nope")).toBeUndefined();
		expect(sanitizeCookies(null)).toBeUndefined();
		expect(sanitizeCookies({ name: "SAPISID" })).toBeUndefined();
	});
});
