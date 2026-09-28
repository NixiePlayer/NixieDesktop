import { describe, expect, it } from "vitest";
import type { LyricsCandidate } from "./lyrics";
import { isBestPossible, pickBest } from "./lyrics";

// Starts inside the intro threshold, so no break is marked ahead of it.
const synced = "[00:02.00] one\n[00:05.00] two";

describe("lyrics ranking", () => {
	it("prefers a synced result over a plain one from a higher source", () => {
		const candidates: LyricsCandidate[] = [
			{ source: "LRCLIB", plainLyrics: "flat" },
			{ source: "NetEase", syncedLyrics: synced },
		];
		const best = pickBest(candidates, 180);
		expect(best?.source).toBe("NetEase");
		expect(best?.lines).toHaveLength(2);
		expect(isBestPossible(best, ["YouTube Music"])).toBe(true);
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
		expect(isBestPossible(best, ["NetEase", "YouTube Music"])).toBe(false);
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
		expect(isBestPossible(instrumental, ["NetEase", "YouTube Music"])).toBe(true);
	});

	it("strips the credit block NetEase stamps at the head of the file", () => {
		// Real files run the credits past two seconds and separate them with a blank line.
		const best = pickBest(
			[
				{
					source: "NetEase",
					syncedLyrics: `[00:00.000] 作词 : A\n[00:01.00] Produced by : B\n[00:02.20] 编曲 : C\n[00:02.30]\n[00:05.00] one\n[00:06.00] two`,
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

	it("strips the credit block NetEase stamps at the tail of the file", () => {
		// From "光年之外": a blank line then the credit in the LRC file, the credit alone in the yrc one.
		const lrc = "[00:01.00] one\n[00:04.00] two\n[03:50.737]\n[03:54.371]监制 : Lupo Groinig";
		const yrc =
			"[1000,500](1000,500,0)one\n[4000,500](4000,500,0)two\n[230920,4580](230920,910,0)监(231830,910,0)制 (232740,910,0): (233650,910,0)Lupo (234560,940,0)Groinig";
		for (const candidate of [{ syncedLyrics: lrc }, { wordSyncedLyrics: yrc }]) {
			const best = pickBest([{ source: "NetEase", ...candidate }], 0);
			expect(best?.lines.map((line) => line.text)).toEqual(["one", "two"]);
		}
	});

	it("blanks song-part names instead of showing them as lyrics", () => {
		const labels = ["[Verse 1]", "【副歌】", "(Pre-Chorus)", "[Chorus: Someone]", "Bridge:"];
		const lrc = ["[00:01.00] one", ...labels.map((label, index) => `[00:0${index + 2}.00] ${label}`), "[00:08.00] two"];
		const best = pickBest([{ source: "LRCLIB", syncedLyrics: lrc.join("\n") }], 180);
		expect(best?.lines.map((line) => line.text)).toEqual(["one", "two"]);
		expect(best?.lines.every((line) => !line.background)).toBe(true);
	});

	it("keeps a lyric that only mentions a song part", () => {
		const lrc = "[00:01.00] Sing the chorus\n[00:02.00] (Hook me up)\n[00:03.00] Verse: one\n[00:04.00] end";
		const best = pickBest([{ source: "LRCLIB", syncedLyrics: lrc }], 180);
		expect(best?.lines.map((line) => line.text || line.background)).toEqual([
			"Sing the chorus",
			"Hook me up",
			"Verse: one",
			"end",
		]);
	});

	it("opens a break at a label heading an instrumental part", () => {
		const lrc = "[00:01.00] one\n[00:04.00] [Instrumental]\n[00:20.00] two";
		const best = pickBest([{ source: "LRCLIB", syncedLyrics: lrc }], 180);
		expect(best?.lines.map((line) => [line.timeSeconds, line.text])).toEqual([
			[1, "one"],
			[4, ""],
			[20, "two"],
		]);
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
		expect(isBestPossible(undefined, [])).toBe(false);
	});
});

// The head of NetEase's real file for "Blinding Lights", credits and all.
const yrc = [
	'{"t":0,"c":[{"tx":"制作人: "},{"tx":"The Weeknd"}]}',
	"[0,1000](0,1000,0) 制作人 : The Weeknd/Max Martin",
	"[1000,1000](1000,1000,0) 作词 : Max Martin",
	"[23550,120](23550,120,0)Yeah",
	"[27360,1290](27360,240,0)I've (27600,90,0)been (27690,300,0)tryna (27990,660,0)call",
	"[40000,2000](40000,500,0)Hey (40500,500,0)(Hey, (41000,500,0)hey) (41500,500,0)you",
].join("\n");

// NetEase's own form, from "Bohemian Rhapsody": full-width parentheses as zero-length tokens.
const fullWidth =
	"[25200,3480](25200,480,0)I'm (25680,510,0)just (26190,210,0)a (26400,930,0)poor (27330,1020,0)boy(28350,0,0), (28350,0,0)（(28350,30,0)oooh(28380,0,0), (28380,180,0)poor (28560,60,0)boy(28620,60,0)）";

describe("word-synced lyrics", () => {
	it("parses NetEase's yrc words and strips its credit lines", () => {
		const best = pickBest([{ source: "NetEase", wordSyncedLyrics: yrc, syncedLyrics: synced }], 180);
		const sung = best?.lines.filter((line) => line.text) ?? [];
		expect(sung.map((line) => line.text)).toEqual(["Yeah", "I've been tryna call", "Hey you"]);
		expect(sung[1]?.words?.map((word) => word.startSeconds)).toEqual([27.36, 27.6, 27.69, 27.99]);
		expect(sung[1]?.endSeconds).toBeCloseTo(28.65);
	});

	it("ranks word timing above line timing, and asks NetEase after a line-synced LRCLIB answer", () => {
		const lrclib = pickBest([{ source: "LRCLIB", syncedLyrics: synced }], 180);
		expect(isBestPossible(lrclib, ["NetEase", "YouTube Music"])).toBe(false);
		expect(isBestPossible(lrclib, ["YouTube Music"])).toBe(true);

		const best = pickBest(
			[
				{ source: "LRCLIB", syncedLyrics: synced },
				{ source: "NetEase", wordSyncedLyrics: yrc },
			],
			180
		);
		expect(best?.source).toBe("NetEase");
		expect(isBestPossible(best, ["YouTube Music"])).toBe(true);
	});

	it("falls back to the LRC file when the yrc one is nothing but credits", () => {
		const best = pickBest(
			[{ source: "NetEase", wordSyncedLyrics: "[0,1000](0,1000,0) 作词 : A", syncedLyrics: synced }],
			180
		);
		expect(best?.lines.some((line) => line.words)).toBe(false);
		expect(best?.lines.map((line) => line.text)).toEqual(["one", "two"]);
	});

	it("marks the parenthesised words as the backing vocal", () => {
		const line = pickBest([{ source: "NetEase", wordSyncedLyrics: yrc }], 180)?.lines.at(-1);
		expect(line?.text).toBe("Hey you");
		expect(line?.background).toBe("Hey, hey");
		expect(line?.words?.map((word) => word.background ?? false)).toEqual([false, true, true, false]);
	});

	it("reads NetEase's full-width parentheses the same way", () => {
		const line = pickBest([{ source: "NetEase", wordSyncedLyrics: fullWidth }], 180)?.lines.at(-1);
		expect(line?.text).toBe("I'm just a poor boy,");
		expect(line?.background).toBe("oooh, poor boy");
	});
});

describe("backing vocals in line-synced lyrics", () => {
	const lines = (lrc: string) => pickBest([{ source: "LRCLIB", syncedLyrics: lrc }], 180)?.lines ?? [];

	it("takes the parenthesised part out of the lead text", () => {
		expect(lines("[00:01.00] The city's cold and empty (oh)")[0]).toMatchObject({
			text: "The city's cold and empty",
			background: "oh",
		});
		expect(lines("[00:01.00] I'm just walking (by to let) you (know)")[0]).toMatchObject({
			text: "I'm just walking you",
			background: "by to let know",
		});
	});

	it("keeps a line that is all backing vocal, and leaves an unclosed parenthesis alone", () => {
		expect(lines("[00:01.00] (Hey, hey, hey)")[0]).toMatchObject({ text: "", background: "Hey, hey, hey" });
		expect(lines("[00:01.00] Mama（oooh）")[0]).toMatchObject({ text: "Mama", background: "oooh" });
		const unclosed = lines("[00:01.00] (Ooh, don't")[0];
		expect(unclosed?.text).toBe("(Ooh, don't");
		expect(unclosed?.background).toBeUndefined();
	});
});

describe("instrumental breaks", () => {
	const gaps = (candidate: LyricsCandidate) =>
		(pickBest([candidate], 180)?.lines ?? [])
			.filter((line) => !line.text && !line.background)
			.map((line) => [line.timeSeconds, line.endSeconds]);

	it("marks a long intro, whatever the source", () => {
		expect(gaps({ source: "LRCLIB", syncedLyrics: "[00:12.00] one\n[00:15.00] two" })).toEqual([[0, 12]]);
		expect(gaps({ source: "LRCLIB", syncedLyrics: "[00:06.00] one\n[00:15.00] two" })).toEqual([]);
	});

	it("measures a word-synced break from where the line stops singing", () => {
		const breaks = gaps({ source: "NetEase", wordSyncedLyrics: yrc });
		expect(breaks[0]).toEqual([0, 23.55]);
		expect(breaks[1]?.[0]).toBeCloseTo(28.65);
		expect(breaks[1]?.[1]).toBe(40);
	});

	it("reads an LRC empty line as the start of a break, and drops one before a short pause", () => {
		const lrc = "[00:01.00] one\n[00:04.00]\n[00:20.00] two\n[00:23.00]\n[00:25.00] three\n[00:30.00]";
		const best = pickBest([{ source: "LRCLIB", syncedLyrics: lrc }], 180);
		expect(best?.lines.map((line) => [line.timeSeconds, line.text])).toEqual([
			[1, "one"],
			[4, ""],
			[20, "two"],
			[25, "three"],
		]);
		expect(best?.lines[1]?.endSeconds).toBe(20);
	});
});
