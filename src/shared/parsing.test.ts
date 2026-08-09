import { describe, expect, it } from "vitest";
import { durationsMatch, parseLrc } from "./lrc";
import { parseByteRange } from "./range";
import { validateMusicCommand, validateMusicQuery } from "./validation";

describe("boundary parsing", () => {
	it("parses and sorts multi-timestamp LRC lines", () => {
		expect(parseLrc("[00:10.50][00:12.5] Hello\n[00:02] Intro")).toEqual([
			{ timeSeconds: 2, text: "Intro" },
			{ timeSeconds: 10.5, text: "Hello" },
			{ timeSeconds: 12.5, text: "Hello" },
		]);
		expect(durationsMatch(180, 182.9)).toBe(true);
		expect(durationsMatch(180, 184)).toBe(false);
	});

	it("supports bounded, open, and suffix byte ranges", () => {
		expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
		expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
		expect(() => parseByteRange("bytes=1000-", 1000)).toThrow(RangeError);
	});

	it("rejects malformed IPC payloads", () => {
		expect(() => validateMusicQuery({ type: "search", query: "soul" })).not.toThrow();
		expect(() => validateMusicQuery({ type: "search", query: "x".repeat(201) })).toThrow();
		expect(() =>
			validateMusicQuery({ type: "explore", browseId: "FEmusic_moods_and_genres", params: "ggMPOgE%3D" })
		).not.toThrow();
		expect(() => validateMusicQuery({ type: "explore", browseId: "../bad" })).toThrow();
		expect(() => validateMusicQuery({ type: "explore", params: "ggMPOgE%3D" })).toThrow();
		expect(() => validateMusicQuery({ type: "explore", browseId: "FEmusic_moods", params: "bad\nvalue" })).toThrow();
		expect(() =>
			validateMusicQuery({ type: "explore", browseId: "FEmusic_moods", params: "bad\u0085value" })
		).toThrow();
		expect(() =>
			validateMusicQuery({ type: "explore", browseId: "FEmusic_moods", params: "x".repeat(2049) })
		).toThrow();
		// A radio around one song names no playlist; an artist header's own Shuffle names both.
		expect(() => validateMusicQuery({ type: "radio", id: "vid1" })).not.toThrow();
		expect(() =>
			validateMusicQuery({ type: "radio", id: "vid1", playlistId: "RDAO_x", params: "wAEB8gECKAE%3D" })
		).not.toThrow();
		expect(() => validateMusicQuery({ type: "radio", id: "vid1", playlistId: "../bad" })).toThrow();
		expect(() => validateMusicQuery({ type: "radio", id: "vid1", params: "wAEB8gECKAE%3D" })).toThrow();
		expect(() =>
			validateMusicQuery({ type: "radio", id: "vid1", playlistId: "RDAO_x", params: "bad\nvalue" })
		).toThrow();
		expect(() =>
			validateMusicCommand({ type: "playlist-remove", playlistId: "PL1", itemIds: ["set-1"] })
		).not.toThrow();
		expect(() => validateMusicCommand({ type: "playlist-remove", playlistId: "../bad", itemIds: [] })).toThrow();
		expect(() =>
			validateMusicCommand({ type: "playlist-create", title: "Mix", privacy: "unlisted", collaborate: true })
		).not.toThrow();
		expect(() => validateMusicCommand({ type: "playlist-create", title: "Mix" })).toThrow();
		expect(() => validateMusicCommand({ type: "playlist-create", title: "Mix", privacy: "friends" })).toThrow();
		// Privacy alone is an edit of its own, and the update takes the same three values the create does.
		expect(() =>
			validateMusicCommand({ type: "playlist-update", playlistId: "PL1", privacy: "private" })
		).not.toThrow();
		expect(() => validateMusicCommand({ type: "playlist-update", playlistId: "PL1", privacy: "friends" })).toThrow();
		expect(() => validateMusicCommand({ type: "playlist-update", playlistId: "PL1" })).toThrow();
	});
});
