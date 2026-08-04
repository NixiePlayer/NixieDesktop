import { describe, expect, it } from "vitest";
import type { LyricsCandidate } from "./lyrics";
import { isBestPossible, pickBest } from "./lyrics";

const synced = "[00:12.00] one\n[00:15.00] two";

describe("lyrics ranking", () => {
	it("prefers a synced result over a plain one from a higher source", () => {
		const candidates: LyricsCandidate[] = [
			{ source: "LRCLIB", plainLyrics: "flat" },
			{ source: "NetEase", syncedLyrics: synced },
		];
		const best = pickBest(candidates, 180);
		expect(best?.source).toBe("NetEase");
		expect(best?.lines).toHaveLength(2);
		expect(isBestPossible(best)).toBe(true);
	});

	it("breaks a quality tie on source order", () => {
		const best = pickBest(
			[
				{ source: "YouTube Music", plainLyrics: "flat" },
				{ source: "LRCLIB", plainLyrics: "flat" },
			],
			180
		);
		expect(best?.source).toBe("LRCLIB");
		expect(isBestPossible(best)).toBe(false);
	});

	it("drops candidates whose length disagrees, and keeps ones that state none", () => {
		expect(pickBest([{ source: "LRCLIB", durationSeconds: 240, syncedLyrics: synced }], 180)).toBeUndefined();
		expect(pickBest([{ source: "LRCLIB", durationSeconds: 182, syncedLyrics: synced }], 180)?.source).toBe("LRCLIB");
		expect(pickBest([{ source: "YouTube Music", plainLyrics: "flat" }], 180)?.source).toBe("YouTube Music");
	});

	it("keeps every candidate when the track itself has no length", () => {
		expect(pickBest([{ source: "NetEase", durationSeconds: 240, syncedLyrics: synced }], 0)?.source).toBe("NetEase");
	});

	it("ranks an instrumental marking below synced text and above plain", () => {
		expect(
			pickBest(
				[
					{ source: "LRCLIB", instrumental: true },
					{ source: "NetEase", syncedLyrics: synced },
				],
				180
			)?.source
		).toBe("NetEase");
		const instrumental = pickBest(
			[
				{ source: "NetEase", plainLyrics: "flat" },
				{ source: "LRCLIB", instrumental: true },
			],
			180
		);
		expect(instrumental?.instrumental).toBe(true);
		expect(isBestPossible(instrumental)).toBe(true);
	});

	it("strips the credit block NetEase stamps at the head of the file", () => {
		// Real files run the credits past two seconds and separate them with a blank line.
		const best = pickBest(
			[
				{
					source: "NetEase",
					syncedLyrics: `[00:00.000] 作词 : A\n[00:01.00] Produced by : B\n[00:02.20] 编曲 : C\n[00:02.30]\n${synced}`,
				},
			],
			180
		);
		expect(best?.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});

	it("stops the credit run at the first line that reads like a lyric", () => {
		// A real opening line can be timed at 0.1, and a later line holding a colon is not a credit.
		const best = pickBest(
			[{ source: "NetEase", syncedLyrics: "[00:00.000] 作词 : A\n[00:00.10] one\n[00:15.00] two: three" }],
			180
		);
		expect(best?.lines.map((line) => line.text)).toEqual(["one", "two: three"]);
	});

	it("leaves a file that is all lyrics alone", () => {
		expect(pickBest([{ source: "LRCLIB", syncedLyrics: synced }], 180)?.lines).toHaveLength(2);
	});

	it("reads NetEase's stock instrumental notice as instrumental rather than as lyrics", () => {
		const best = pickBest(
			[{ source: "NetEase", syncedLyrics: "[00:00.000] 作曲 : A\n[00:05.00] 纯音乐，请欣赏" }],
			180
		);
		expect(best?.instrumental).toBe(true);
		expect(best?.lines).toHaveLength(0);
		expect(best?.plainLyrics).toBeUndefined();
	});

	it("drops a NetEase file that is nothing but credits instead of printing them raw", () => {
		// The tag it stamps on a credits-only file, `-1` and all, and the whole file for an indie
		// release nobody has transcribed. It parsed as plain text with the brackets showing.
		const credits = "[00:00.00-1] 作词 : A\n[00:00.00-1] 作曲 : A\n";
		expect(pickBest([{ source: "NetEase", syncedLyrics: credits }], 180)).toBeUndefined();

		// Which is what leaves the plain YouTube Music text to win, rather than losing to a NetEase
		// answer holding no lyrics at all.
		const best = pickBest(
			[
				{ source: "NetEase", syncedLyrics: credits },
				{ source: "YouTube Music", plainLyrics: "flat" },
			],
			180
		);
		expect(best?.source).toBe("YouTube Music");
	});

	it("treats a timestamp-free file as plain text rather than dropping it", () => {
		const best = pickBest([{ source: "NetEase", syncedLyrics: "no tags here" }], 180);
		expect(best?.lines).toHaveLength(0);
		expect(best?.plainLyrics).toBe("no tags here");
	});

	it("returns nothing when every provider came back empty", () => {
		expect(pickBest([{ source: "LRCLIB" }, { source: "NetEase" }], 180)).toBeUndefined();
		expect(isBestPossible(undefined)).toBe(false);
	});
});
