import { describe, expect, it } from "vitest";
import { musicLink } from "./music-link";

describe("musicLink", () => {
	it("leaves plain text to the search", () => {
		expect(musicLink("pink floyd")).toBeUndefined();
		expect(musicLink("music youtube")).toBeUndefined();
	});

	it("reads every kind the share sheet hands out", () => {
		expect(musicLink("https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&si=abc")).toEqual({
			type: "playlist",
			id: "VLPLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
		});
		expect(musicLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ")).toEqual({
			type: "song",
			id: "dQw4w9WgXcQ",
		});
		expect(musicLink("https://music.youtube.com/browse/MPREb_4pL8gzRtw1p")).toEqual({
			type: "album",
			id: "MPREb_4pL8gzRtw1p",
		});
		expect(musicLink("https://music.youtube.com/channel/UCiMhD4jzUqG-IgPzUmmytRQ")).toEqual({
			type: "artist",
			id: "UCiMhD4jzUqG-IgPzUmmytRQ",
		});
		expect(musicLink("https://music.youtube.com/browse/MPSPPLxyz123")).toEqual({
			type: "playlist",
			id: "MPSPPLxyz123",
		});
	});

	it("reads short links and links without a scheme", () => {
		expect(musicLink("https://youtu.be/dQw4w9WgXcQ?si=abc")).toEqual({ type: "song", id: "dQw4w9WgXcQ" });
		expect(musicLink("  youtu.be/dQw4w9WgXcQ ")).toEqual({ type: "song", id: "dQw4w9WgXcQ" });
		expect(musicLink("music.youtube.com/playlist?list=LM")).toEqual({ type: "playlist", id: "VLLM" });
	});

	it("refuses other hosts and look-alikes", () => {
		for (const link of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://example.com/playlist?list=PL123",
			"https://music.youtube.com.example.com/playlist?list=PL123",
			"https://music.youtube.com@example.com/playlist?list=PL123",
			"https://user:pass@music.youtube.com/playlist?list=PL123",
			"https://music.youtube.com:8443/playlist?list=PL123",
			"http://youtu.be.example.com/dQw4w9WgXcQ",
			"https://",
		]) {
			expect(musicLink(link), link).toEqual({ type: "unsupported" });
		}
	});

	it("refuses ids that do not have upstream's shape", () => {
		for (const link of [
			"https://music.youtube.com/watch?v=short",
			"https://music.youtube.com/watch?v=dQw4w9WgXcQ%2F..",
			"https://music.youtube.com/playlist?list=../../etc",
			"https://music.youtube.com/playlist",
			"https://music.youtube.com/browse/FEmusic_home",
			"https://music.youtube.com/channel/not-a-channel",
			"https://music.youtube.com/browse/MPREb_abc/extra",
			"https://youtu.be/dQw4w9WgXcQ/extra",
		]) {
			expect(musicLink(link), link).toEqual({ type: "unsupported" });
		}
	});
});
