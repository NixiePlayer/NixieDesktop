import { describe, expect, it } from "vitest";
import { normalizationGainDb, normalizationTargets, volumeGain } from "./normalization";
import { nextQueueIndex } from "./queue";

describe("playback core", () => {
	it("attenuates loud tracks to the target and leaves quiet ones alone", () => {
		// The stats for nerds example: content at -5.9 LUFS plays at -8.1 dB, which is 40%.
		expect(normalizationGainDb(-5.9)).toBeCloseTo(-8.1, 5);
		expect(normalizationGainDb(-10)).toBe(-4);
		expect(normalizationGainDb(-18)).toBe(0);
		// A louder target only attenuates less, it never boosts.
		expect(normalizationGainDb(-10, normalizationTargets.loud)).toBe(-1);
		expect(normalizationGainDb(-10, normalizationTargets.quiet)).toBe(-9);
		expect(normalizationGainDb(-25, normalizationTargets.loud)).toBe(0);
	});

	it("attenuates a stream that states no loudness rather than passing it through", () => {
		// The failure has to be quiet, never loud: an unmeasured track is assumed to be a loud master.
		expect(normalizationGainDb(undefined)).toBeLessThan(0);
		expect(normalizationGainDb(undefined, normalizationTargets.loud)).toBeLessThan(0);
		expect(normalizationGainDb(undefined, normalizationTargets.quiet)).toBeLessThan(
			normalizationGainDb(undefined, normalizationTargets.loud)
		);
	});

	it("drops the volume 10 dB per halving of the slider", () => {
		expect(volumeGain(1)).toBe(1);
		expect(volumeGain(0)).toBe(0);
		// Every halving is another 10 dB down, which is another halving of what is heard.
		expect(20 * Math.log10(volumeGain(0.5))).toBeCloseTo(-10, 5);
		expect(20 * Math.log10(volumeGain(0.25))).toBeCloseTo(-20, 5);
		// A linear slider would have left half the travel at -6 dB, so it is quieter throughout.
		expect(volumeGain(0.5)).toBeLessThan(0.5);
	});

	it("handles queue boundaries, repeat, and shuffle", () => {
		expect(nextQueueIndex(2, 3, "off")).toEqual({ index: 2, shouldStop: true });
		expect(nextQueueIndex(2, 3, "all")).toEqual({ index: 0, shouldStop: false });
		expect(nextQueueIndex(1, 3, "one")).toEqual({ index: 1, shouldStop: false });
		expect(nextQueueIndex(0, 3, "off", "next", () => 0, true)).toEqual({ index: 1, shouldStop: false });
	});
});
