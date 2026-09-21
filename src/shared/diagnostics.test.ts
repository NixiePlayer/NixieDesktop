import { describe, expect, it } from "vitest";
import { diagnosticError, diagnosticIssueUrl, diagnosticReason, diagnosticReport } from "./diagnostics";

const info = { version: "0.4.0", os: "Windows 10.0.26100", arch: "x64", electron: "43.2.0", chrome: "150.0.0.0" };

describe("safe diagnostics", () => {
	it("keeps an HTTP status without the URL, body, token, path or stack", () => {
		const error = Object.assign(
			new Error("Request to https://private.test/?token=secret failed with status code 403"),
			{
				name: "InnertubeError",
				info: { cookie: "SAPISID=secret" },
				stack: "C:\\Users\\Person\\private.txt",
			}
		);
		expect(diagnosticReason(error)).toBe("InnertubeError / HTTP 403");
		expect(
			diagnosticReason(new Error("cookie=secret Authorization: Bearer secret lyric text /Users/person/private"))
		).toBe("Error");
	});
	it("keeps known system codes, including a fetch cause, and rejects invented metadata", () => {
		expect(diagnosticReason(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))).toBe(
			"TypeError / ENOTFOUND"
		);
		expect(diagnosticError({ name: "secret", code: "SAPISID_secret", status: 200, message: "secret" })).toEqual({
			name: "Error",
			code: undefined,
			status: undefined,
		});
		expect(diagnosticError(null).name).toBe("Error");
		const error = { name: "Error", cause: {} };
		error.cause = error;
		expect(diagnosticReason(error)).toBe("Error");
	});
	it("identifies known sign-in refusals without copying arbitrary messages", () => {
		expect(diagnosticReason(new Error("That profile is not signed in to YouTube"))).toBe("Error / notSignedIn");
		expect(diagnosticReason({ name: "MediaError", code: "MEDIA_ERR_NETWORK" })).toBe("MediaError / MEDIA_ERR_NETWORK");
	});
	it("keeps the updater code and HTTP status without the feed URL", () => {
		const error = Object.assign(
			new Error(
				"Cannot parse releases feed: Unable to find latest version on GitHub (https://github.com/x): HttpError: 504"
			),
			{ code: "ERR_UPDATER_INVALID_RELEASE_FEED" }
		);
		expect(diagnosticReason(error)).toBe("Error / ERR_UPDATER_INVALID_RELEASE_FEED / HTTP 504");
		expect(diagnosticReason({ name: "HttpError", statusCode: 404 })).toBe("Error / HTTP 404");
	});
	it("includes system information but keeps the full log out of the issue URL", () => {
		const report = diagnosticReport(
			info,
			"Build: packaged; language: en",
			"2026-09-17 ERROR home: HTTP 403\n".repeat(100)
		);
		expect(report).toContain("Windows 10.0.26100 (x64)");
		expect(report).toContain("Electron: 43.2.0");
		const url = new URL(diagnosticIssueUrl(report));
		expect(url.origin + url.pathname).toBe("https://github.com/NixiePlayer/NixieDesktop/issues/new");
		expect(url.searchParams.get("body")).toContain("Nixie: 0.4.0");
		expect(url.searchParams.get("body")).not.toContain("ERROR home");
		expect(url.toString().length).toBeLessThan(2000);
	});
});
