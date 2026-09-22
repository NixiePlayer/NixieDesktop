import { describe, expect, it } from "vitest";
import { validateLinkedAccount } from "./validation";

describe("validateLinkedAccount", () => {
	it("accepts a legacy browser link only when source is absent", () => {
		expect(() => validateLinkedAccount({ browser: "Chrome", profile: "Default" })).not.toThrow();
		expect(() => validateLinkedAccount({ source: null, browser: "Chrome", profile: "Default" })).toThrow(
			"Invalid linked account"
		);
	});

	it("accepts a chosen account only as a browser sign-in index", () => {
		expect(() => validateLinkedAccount({ browser: "Firefox", profile: "Default", authUser: 2 })).not.toThrow();
		for (const authUser of [-1, 10, 1.5, "1"]) {
			expect(() => validateLinkedAccount({ browser: "Firefox", profile: "Default", authUser })).toThrow();
		}
	});
});
