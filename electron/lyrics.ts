import { net } from "electron";
import { durationsMatch } from "../src/shared/lrc";
import { isBestPossible, type LyricsCandidate, pickBest } from "../src/shared/lyrics";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Everything here arrives from the renderer, so it is clamped before it reaches a URL. */
interface LyricsQuery {
	track: string;
	artist: string;
	album: string;
	durationSeconds: number;
	videoId?: string;
}

interface LrclibRecord {
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
}

interface NeteaseSong {
	id: number;
	/** Milliseconds. */
	duration: number;
}

export class LyricsClient {
	#tail = Promise.resolve();
	#lastLrclib = 0;
	#youtube: (videoId: string) => Promise<{ text: string; attribution?: string } | undefined>;

	constructor(youtube: (videoId: string) => Promise<{ text: string; attribution?: string } | undefined>) {
		this.#youtube = youtube;
	}

	query(parameters: URLSearchParams) {
		const task = this.#tail.then(() => this.#query(parameters));
		this.#tail = task.then(
			() => undefined,
			() => undefined
		);
		return task;
	}

	/**
	 * The providers are asked in order and stop at the first result nothing later could beat, which
	 * lands on the same answer as fetching all three and ranking them: the only short circuit is on
	 * the top tier. Most tracks never get past LRCLIB, and a failing provider only costs its own tier.
	 */
	async #query(parameters: URLSearchParams) {
		const query = parseQuery(parameters);
		if (!query.track) return json(undefined);

		const candidates: LyricsCandidate[] = [];
		const providers = [() => this.#lrclib(query), () => this.#netease(query), () => this.#youtubeMusic(query)];
		for (const provider of providers) {
			candidates.push(...(await provider().catch(() => [])));
			const best = pickBest(candidates, query.durationSeconds);
			if (isBestPossible(best)) return json(best);
		}
		return json(pickBest(candidates, query.durationSeconds));
	}

	/** The exact match needs all four fields, so a track with no length goes straight to the search. */
	async #lrclib(query: LyricsQuery): Promise<LyricsCandidate[]> {
		if (query.durationSeconds) {
			const exact = await this.#lrclibFetch(
				buildUrl("https://lrclib.net/api/get", {
					track_name: query.track,
					artist_name: query.artist,
					album_name: query.album,
					duration: String(Math.round(query.durationSeconds)),
				})
			);
			if (exact.ok) return [fromLrclib((await exact.json()) as LrclibRecord)];
		}

		const search = await this.#lrclibFetch(
			buildUrl("https://lrclib.net/api/search", { track_name: query.track, artist_name: query.artist })
		);
		if (!search.ok) return [];
		const records = (await search.json()) as LrclibRecord[];
		return records.slice(0, 10).map(fromLrclib);
	}

	/**
	 * Undocumented but unauthenticated public endpoints, carrying the large synced catalogue that
	 * LRCLIB is missing. Two round trips, since the search only names a song id, so the song is
	 * chosen here on its length rather than by fetching the lyrics of every result and ranking those.
	 */
	async #netease(query: LyricsQuery): Promise<LyricsCandidate[]> {
		const found = await this.#json(
			buildUrl("https://music.163.com/api/search/get", {
				s: `${query.track} ${query.artist}`.trim(),
				type: "1",
				limit: "5",
				offset: "0",
			})
		);
		const songs = ((found as { result?: { songs?: NeteaseSong[] } } | undefined)?.result?.songs ?? []).filter(
			(song) => typeof song?.id === "number"
		);
		const song = query.durationSeconds
			? songs.find((candidate) => durationsMatch(query.durationSeconds, candidate.duration / 1000))
			: songs.at(0);
		if (!song) return [];

		const lyric = (await this.#json(
			buildUrl("https://music.163.com/api/song/lyric", { id: String(song.id), lv: "-1", kv: "-1", tv: "-1" })
		)) as { code?: number; nolyric?: boolean; lrc?: { lyric?: string } } | undefined;
		if (lyric?.code !== 200) return [];
		return [
			{
				source: "NetEase",
				durationSeconds: song.duration / 1000,
				syncedLyrics: lyric.lrc?.lyric || undefined,
				instrumental: lyric.nolyric === true,
			},
		];
	}

	/** Plain text only, but it comes from the session already streaming the track. */
	async #youtubeMusic(query: LyricsQuery): Promise<LyricsCandidate[]> {
		if (!query.videoId) return [];
		const lyrics = await this.#youtube(query.videoId);
		if (!lyrics) return [];
		return [{ source: "YouTube Music", plainLyrics: lyrics.text, attribution: lyrics.attribution }];
	}

	/** LRCLIB asks for one request every 350ms, and this now spends up to two per lookup. */
	async #lrclibFetch(url: URL) {
		await wait(Math.max(0, 350 - (Date.now() - this.#lastLrclib)));
		this.#lastLrclib = Date.now();
		return this.#fetch(url);
	}

	async #json(url: URL) {
		const response = await this.#fetch(url).catch(() => undefined);
		if (!response?.ok) return;
		return (await response.json().catch(() => undefined)) as unknown;
	}

	#fetch(url: URL): Promise<Response> {
		// `credentials: omit` so none of this carries a cookie from the default session.
		const request = () =>
			net.fetch(url.toString(), {
				credentials: "omit",
				headers: {
					"user-agent": "Noctune/0.1 (+https://github.com/NoctunePlayer/NoctuneDesktop)",
					// NetEase answers an off-site referrer with an error body rather than results.
					...(url.hostname.endsWith("music.163.com") ? { referer: "https://music.163.com" } : {}),
				},
			});
		return request().then(async (response) => {
			if (response.status !== 429) return response;
			await wait(Math.min(Number(response.headers.get("retry-after") ?? 1), 30) * 1000);
			return request();
		});
	}
}

/** A video id is spent on an upstream call, so it is checked rather than merely trimmed. */
function parseQuery(parameters: URLSearchParams): LyricsQuery {
	const videoId = parameters.get("id") ?? "";
	return {
		track: clamp(parameters.get("track")),
		artist: clamp(parameters.get("artist")),
		album: clamp(parameters.get("album")),
		durationSeconds: Math.min(Math.max(Number(parameters.get("duration")) || 0, 0), 24 * 60 * 60),
		videoId: /^[\w-]{1,64}$/.test(videoId) ? videoId : undefined,
	};
}

const clamp = (value: string | null) => (value ?? "").trim().slice(0, 200);

function buildUrl(base: string, parameters: Record<string, string>) {
	const url = new URL(base);
	for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
	return url;
}

const fromLrclib = (record: LrclibRecord): LyricsCandidate => ({
	source: "LRCLIB",
	durationSeconds: record.duration,
	syncedLyrics: record.syncedLyrics ?? undefined,
	plainLyrics: record.plainLyrics ?? undefined,
	instrumental: record.instrumental,
});

const json = (value: unknown) =>
	new Response(JSON.stringify(value ?? null), {
		headers: { "cache-control": "no-store", "content-type": "application/json" },
	});
