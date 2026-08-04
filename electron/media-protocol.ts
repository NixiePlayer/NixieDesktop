import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { net } from "electron";
import type { AudioVariantFingerprint } from "../src/shared/contracts";
import { parseByteRange, type ByteRange } from "../src/shared/range";

interface MediaTarget {
	url?: string;
	filePath?: string;
	contentLength?: number;
	fingerprint: AudioVariantFingerprint;
	expiresAt: number;
}

/**
 * Image CDNs YouTube hands out thumbnails from. Anything else is not artwork, it is a proxy request.
 * `gstatic` is the one that is not a CDN of uploads: liked music and saved episodes are the two
 * playlists nobody made, and their covers are static art YouTube Music ships with itself
 * (`/youtube/media/ytm/images/pbg/…-@576.png`). Leaving it out 404s the only cover those two carry.
 */
const ARTWORK_HOSTS = [".googleusercontent.com", ".ggpht.com", ".ytimg.com", ".gstatic.com"];

/**
 * A mix nobody made ("Discover Mix", "New Release Mix", the rest of them) is pictured with a collage
 * YouTube Music renders on demand from its own origin, `music.youtube.com/image/mixart?r=…`, and not
 * from any CDN of uploads. Left out, every mix on Home fell back to the placeholder note. Only that
 * one path is allowed, since the rest of the origin is the site itself rather than an image.
 */
function isArtworkHost(target: URL) {
	if (target.hostname === "music.youtube.com") return target.pathname.startsWith("/image/");
	return ARTWORK_HOSTS.some((host) => target.hostname.endsWith(host));
}

function token() {
	return randomBytes(24).toString("base64url");
}

export class SecureResourceRegistry {
	readonly #media = new Map<string, MediaTarget>();
	readonly #log: (message: string) => void;
	readonly #allowedOrigins: ReadonlySet<string>;

	constructor(options: { log?: (message: string) => void; allowedOrigins?: readonly string[] } = {}) {
		this.#log = options.log ?? (() => undefined);
		this.#allowedOrigins = new Set(options.allowedOrigins ?? []);
	}

	/**
	 * The decks fetch with `crossOrigin="anonymous"`, so a cross-origin stream needs this header or
	 * the element is tainted and the WebAudio graph goes silent. Only origins this app serves are
	 * echoed, never whatever the request happens to claim.
	 */
	#cors(request: Request) {
		const origin = request.headers.get("origin");
		return origin && this.#allowedOrigins.has(origin) ? { "access-control-allow-origin": origin } : undefined;
	}

	registerMedia(target: Omit<MediaTarget, "expiresAt">) {
		const id = token();
		this.#media.set(id, { ...target, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
		this.#prune();
		return `noctune://app/media/${id}`;
	}

	registerOffline(filePath: string, contentLength: number, fingerprint: AudioVariantFingerprint) {
		return this.registerMedia({ filePath, contentLength, fingerprint });
	}

	/**
	 * Artwork rides along inside the queue and the playback snapshot, which outlive this process, so
	 * the id carries the upstream URL instead of pointing into a map that dies with it. Public CDN
	 * images, no signature and no identity, and `handleArtwork` still refuses every host but theirs.
	 */
	registerArtwork(url: string) {
		return `noctune://app/artwork/${Buffer.from(url).toString("base64url")}`;
	}

	async saveMedia(mediaUrl: string, filePath: string) {
		const id = new URL(mediaUrl).pathname.split("/").at(-1);
		const target = id ? this.#media.get(id) : undefined;
		if (!target?.url || target.expiresAt < Date.now()) throw new Error("Download expired");

		const response = await net.fetch(target.url, { headers: { "cache-control": "no-store" } });
		if (!response.ok || !response.body) throw new Error(`Download failed with status ${response.status}`);
		try {
			await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(filePath));
		} catch (error) {
			await rm(filePath, { force: true });
			throw error;
		}
	}

	async handleMedia(request: Request, id: string) {
		const target = this.#media.get(id);
		if (!target || target.expiresAt < Date.now()) return new Response("Not found", { status: 404 });
		// The type without its codec parameters, which is what an element wants and what a range
		// response has to keep stating.
		const [mimeType = target.fingerprint.mimeType] = target.fingerprint.mimeType.split(";");

		let range: ByteRange | undefined;
		try {
			range = parseByteRange(request.headers.get("range"), target.contentLength);
		} catch {
			return new Response("Range not satisfiable", {
				status: 416,
				headers: target.contentLength ? { "content-range": `bytes */${target.contentLength}` } : undefined,
			});
		}

		if (target.filePath) {
			const headers = new Headers({
				"accept-ranges": "bytes",
				"cache-control": "private, no-store",
				"content-length": String(range ? range.end - range.start + 1 : target.contentLength),
				"content-type": mimeType,
			});
			for (const [name, value] of Object.entries(this.#cors(request) ?? {})) headers.set(name, value);
			if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${target.contentLength}`);
			const body = Readable.toWeb(createReadStream(target.filePath, range && { start: range.start, end: range.end }));
			return new Response(body as unknown as ReadableStream, { status: range ? 206 : 200, headers });
		}

		if (!target.url) return new Response("Not found", { status: 404 });
		const url = new URL(target.url);
		if (range) url.searchParams.set("range", `${range.start}-${range.end}`);
		const upstream = await net.fetch(url.toString(), {
			signal: request.signal,
			headers: { "cache-control": "no-store" },
		});
		if (!upstream.ok) {
			this.#log(`media fetch rejected: ${upstream.status} itag ${target.fingerprint.itag}`);
			await upstream.body?.cancel().catch(() => undefined);
			const headers = new Headers({ "cache-control": "no-store" });
			for (const [name, value] of Object.entries(this.#cors(request) ?? {})) headers.set(name, value);
			return new Response(null, { status: upstream.status, headers });
		}
		const headers = new Headers(upstream.headers);
		headers.set("accept-ranges", "bytes");
		headers.set("cache-control", "no-store");
		headers.set("content-type", mimeType);
		for (const [name, value] of Object.entries(this.#cors(request) ?? {})) headers.set(name, value);
		if (range) {
			headers.set("content-length", String(range.end - range.start + 1));
			headers.set("content-range", `bytes ${range.start}-${range.end}/${target.contentLength ?? "*"}`);
		}
		return new Response(upstream.body, { status: range ? 206 : upstream.status, headers });
	}

	async handleArtwork(request: Request, id: string) {
		let target: URL;
		try {
			target = new URL(Buffer.from(id, "base64url").toString());
		} catch {
			return new Response("Not found", { status: 404 });
		}
		const allowed = target.protocol === "https:" && isArtworkHost(target);
		if (!allowed) return new Response("Not found", { status: 404 });
		const upstream = await net.fetch(target.toString(), { signal: request.signal });
		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				"cache-control": "private, max-age=86400",
				"content-type": upstream.headers.get("content-type") ?? "image/jpeg",
			},
		});
	}

	#prune() {
		const now = Date.now();
		for (const [id, value] of this.#media) if (value.expiresAt < now) this.#media.delete(id);
	}
}
