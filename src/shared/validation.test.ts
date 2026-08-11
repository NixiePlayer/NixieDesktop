import { describe, expect, it } from "vitest";
import { validateLinkedAccount } from "./validation";

describe("validateLinkedAccount", () => {
	it("accepts a legacy browser link only when source is absent", () => {
		expect(() => validateLinkedAccount({ browser: "Chrome", profile: "Default" })).not.toThrow();
		expect(() => validateLinkedAccount({ source: null, browser: "Chrome", profile: "Default" })).toThrow(
			"Invalid linked account"
		);
	});
});
