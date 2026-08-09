import { describe, expect, it } from "vitest";
import { expandPlays } from "./format";

describe("expandPlays", () => {
	it("multiplies the abbreviation upstream states back out, and drops its wording", () => {
		expect(expandPlays("96M plays")).toBe("96.000.000");
		expect(expandPlays("1.8M views")).toBe("1.800.000");
		expect(expandPlays("612K plays")).toBe("612.000");
		expect(expandPlays("1.2B views")).toBe("1.200.000.000");
		// French states the same suffix as a word of its own.
		expect(expandPlays("96 M de lectures")).toBe("96.000.000");
	});

	it("regroups a count upstream stated in full", () => {
		expect(expandPlays("902 plays")).toBe("902");
		expect(expandPlays("1,234,567 plays")).toBe("1.234.567");
	});

	it("states nothing for a count it cannot read, rather than one a thousandfold short", () => {
		expect(expandPlays("96 Mln di riproduzioni")).toBeUndefined();
		expect(expandPlays("96 Mio. Wiedergaben")).toBeUndefined();
		expect(expandPlays("Much Rewind")).toBeUndefined();
	});
});
