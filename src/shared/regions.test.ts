import { describe, expect, it } from "vitest";
import { regionCode } from "./regions";

describe("regionCode", () => {
	it("recovers the code upstream never states, from the name it does", () => {
		expect(regionCode("Italy")).toBe("IT");
		expect(regionCode("United States")).toBe("US");
		expect(regionCode("Japan")).toBe("JP");
	});

	it("matches across the case, accents and punctuation the two tables disagree on", () => {
		expect(regionCode("ITALY")).toBe("IT");
		expect(regionCode("U.S. Virgin Islands")).toBe(regionCode("US Virgin Islands"));
		expect(regionCode("Côte d’Ivoire")).toBe("CI");
	});

	it("falls back to the reader's own locale when upstream answered in it", () => {
		expect(regionCode("Italia", "it")).toBe("IT");
		expect(regionCode("Giappone", "it")).toBe("JP");
	});

	it("states nothing for a name no locale holds, rather than a code meaning somewhere else", () => {
		expect(regionCode("Global")).toBeUndefined();
		expect(regionCode("")).toBeUndefined();
	});
});
