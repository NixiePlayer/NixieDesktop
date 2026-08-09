import { net } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: { fetch: vi.fn(async () => new Response("image", { status: 200 })) } }));

const { SecureResourceRegistry } = await import("./media-protocol");

function artworkId(url: string) {
	return new URL(new SecureResourceRegistry().registerArtwork(url)).pathname.split("/").at(-1) ?? "";
}

describe("artwork", () => {
	it("serves a YouTube CDN thumbnail through a fresh registry, the way a restart sees it", async () => {
		for (const url of [
			"https://lh3.googleusercontent.com/cover=w544-h544",
			// Liked music and saved episodes, the only two covers YouTube Music draws itself.
			"https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-music-@576.png",
			// The collage YouTube Music draws for a mix, served from the site's own origin.
			"https://music.youtube.com/image/mixart?r=ENgEGNgEMh0IBxoKL20",
		]) {
			const response = await new SecureResourceRegistry().handleArtwork(new Request("noctune://app/"), artworkId(url));
			expect(response.status, url).toBe(200);
		}
	});

	it("refuses any other host, so the id is artwork and not a proxy", async () => {
		for (const url of [
			"https://example.test/cover.jpg",
			"http://i.ytimg.com/cover.jpg",
			"file:///etc/passwd",
			// The mix collages are one path on that origin, not a door onto the rest of the site.
			"https://music.youtube.com/playlist?list=LM",
		]) {
			const response = await new SecureResourceRegistry().handleArtwork(new Request("noctune://app/"), artworkId(url));
			expect(response.status, url).toBe(404);
		}
	});
});

describe("remote media", () => {
	it("preserves an upstream rejection instead of presenting its body as a byte range", async () => {
		const cancel = vi.fn();
		vi.mocked(net.fetch).mockResolvedValueOnce(
			new Response(new ReadableStream({ cancel }), {
				status: 403,
				headers: { "content-length": "9", "content-type": "text/plain" },
			})
		);
		const log = vi.fn();
		const registry = new SecureResourceRegistry({ log });
		const url = registry.registerMedia({
			url: "https://example.test/audio",
			contentLength: 10,
			fingerprint: {
				itag: 251,
				mimeType: 'audio/webm; codecs="opus"',
				codec: "opus",
				bitrate: 128_000,
				durationMs: 1_000,
			},
		});
		const id = new URL(url).pathname.split("/").at(-1) ?? "";

		const response = await registry.handleMedia(new Request(url, { headers: { range: "bytes=2-5" } }), id);

		expect(response.status).toBe(403);
		expect(response.headers.get("content-range")).toBeNull();
		expect(response.headers.get("content-length")).toBeNull();
		expect(cancel).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith("media fetch rejected: 403 itag 251");
	});
});
