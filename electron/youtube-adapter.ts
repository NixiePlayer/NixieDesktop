import { randomBytes } from "node:crypto";
import { readdir, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Innertube, UniversalCache, YTMusic } from "youtubei.js";
import type { AccountSettingEndpoints } from "../src/shared/account-settings";
import { extractAccountSettings } from "../src/shared/account-settings";
import type {
	AccountSetting,
	AccountSettingKey,
	Album,
	Artist,
	AudioQuality,
	AudioVariantFingerprint,
	BrowseTarget,
	ExploreData,
	ExploreSection,
	MusicCommand,
	MusicEntity,
	MusicQuery,
	MusicSection,
	Page,
	Playlist,
	PlaylistPrivacy,
	Track,
	TrackRating,
	WatchTarget,
} from "../src/shared/contracts";
import { autoPlaylist, isTrack } from "../src/shared/entities";
import type { SecureResourceRegistry } from "./media-protocol";

type UnknownRecord = Record<string, unknown>;
type Continuable = { has_continuation?: boolean; getContinuation?: () => Promise<unknown> };

/**
 * What upstream's own create dialog sends for a collaborative playlist, verbatim and percent-encoded
 * the way it states it (`createPlaylistParamsCollaborationEnabled`). Its opposite is `KAA%3D`, which
 * is also what leaving `params` off means, so only the one value is ever sent.
 */
const COLLABORATION_PARAMS = "KAE%3D";

function record(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}

function text(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!record(value)) return;
	if (typeof value.text === "string") return value.text;
	if (Array.isArray(value.runs))
		return value.runs
			.map((run) => text(run))
			.filter(Boolean)
			.join("");
}

function firstString(value: UnknownRecord, ...keys: string[]) {
	for (const key of keys) {
		const found = text(value[key]);
		if (found) return found;
	}
}

function numberValue(value: unknown) {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parts = value.split(":").map(Number);
		if (parts.every(Number.isFinite)) return parts.reduce((total, part) => total * 60 + part, 0);
	}
	return 0;
}

/**
 * A song row carries nothing above 120px, so quick picks would render a thumbnail blown up to card
 * size. Google's image CDN reads the size out of the URL, so ask it for one that fits instead.
 */
function atCardSize(url: string) {
	return url.replace(/=(?:w\d+-h\d+|s\d+)(?=-|$)/, "=w544-h544");
}

/**
 * The same image behind a page rather than beside its title, where card size is a blur. The CDN fits
 * within the box rather than filling it, so a square source stays square and the hero crops it.
 */
function atBannerSize(url: string) {
	return url.replace(/=(?:w\d+-h\d+|s\d+)(?=-|$)/, "=w1920-h1080");
}

/** The image itself, sizes and all: what it measures is the only thing that says it came from a video. */
function largestThumbnail(value: UnknownRecord): { url: string; width?: number; height?: number } | undefined {
	const candidates = [
		value.thumbnail,
		value.thumbnails,
		// A MusicThumbnail keeps the sizes under `contents`, everything older under `thumbnails`.
		record(value.thumbnail) ? value.thumbnail.contents : undefined,
		record(value.thumbnail) ? value.thumbnail.thumbnails : undefined,
	];
	for (const candidate of candidates) {
		if (!Array.isArray(candidate)) continue;
		const images = candidate.filter((item) => record(item) && typeof item.url === "string");
		const largest = images.at(-1);
		if (largest) return largest as { url: string; width?: number; height?: number };
	}
}

function thumbnail(value: UnknownRecord) {
	const largest = largestThumbnail(value);
	return largest && atCardSize(largest.url);
}

/**
 * Parental advisory. A row carries it under `badges`, a responsive header under `subtitle_badge`,
 * and both hold the same `MusicInlineBadge` whose icon names it.
 */
function explicitFrom(node: UnknownRecord) {
	return [node.badges, node.subtitle_badge]
		.flatMap((badges) => (Array.isArray(badges) ? badges : []))
		.some((badge) => record(badge) && typeof badge.icon_type === "string" && badge.icon_type.includes("EXPLICIT"));
}

function endpointPayload(node: UnknownRecord) {
	return record(node.endpoint) && record(node.endpoint.payload) ? node.endpoint.payload : undefined;
}

function artistFrom(value: UnknownRecord): Artist {
	const payload = endpointPayload(value);
	return {
		// Empty, never a placeholder: a row that names an artist without identifying one (an album
		// row, a subtitle) has nowhere to link, and the id is what the player bar reads to decide.
		id:
			firstString(value, "channel_id", "channelId", "browse_id", "browseId") ??
			(payload && firstString(payload, "browseId")) ??
			"",
		name: firstString(value, "name", "title", "author", "text") ?? "Unknown artist",
	};
}

/** An album's own browse id, wherever a node points at one. Only a release is addressed by `MPRE`. */
function albumId(value: UnknownRecord): string | undefined {
	const payload = endpointPayload(value);
	const id = payload && firstString(payload, "browseId");
	return id?.startsWith("MPRE") ? id : undefined;
}

/**
 * The release a song row came from. Upstream states it on the row, and a song's thumbnail is that
 * release's cover, so the album is knowable without opening the song's page. Artists stay empty:
 * the row names them for the song, not for the album.
 *
 * `node.album` is upstream's parse of the subtitle, and it only ever reads the second and third
 * columns: an artist's top songs spend those on the play count and put the release in the fourth,
 * so the columns are searched for the album's own browse id rather than trusted to that field.
 */
function albumFrom(node: UnknownRecord, artworkUrl: string | undefined): Album | undefined {
	const parsed = record(node.album) ? node.album : undefined;
	const run = flexRuns(node).find(albumId);
	const id = (parsed && firstString(parsed, "id")) ?? (run && albumId(run));
	const title = (parsed && firstString(parsed, "name", "title")) ?? (run && firstString(run, "text"));
	return id && title ? { id, title, artists: [], artworkUrl } : undefined;
}

/**
 * The release a row points at without naming it. A search result states its album nowhere in its
 * columns, but upstream still renders a "Go to album" for it, and that menu item carries the id.
 */
function albumIdFrom(node: UnknownRecord): string | undefined {
	const items = record(node.menu) && Array.isArray(node.menu.items) ? node.menu.items : [];
	return items.filter(record).map(albumId).find(Boolean);
}

/**
 * Who made a playlist. A responsive row is parsed with an `author` of its own, a grid tile is not:
 * upstream states the name as one of that tile's subtitle runs, beside "21 songs" and a separator,
 * and the only thing telling it apart from those is that a name links to the channel behind it.
 */
function playlistAuthor(node: UnknownRecord): string | undefined {
	if (record(node.author)) return firstString(node.author, "name");
	const subtitle = record(node.subtitle) && Array.isArray(node.subtitle.runs) ? node.subtitle.runs.filter(record) : [];
	const linked = [...flexRuns(node), ...subtitle].find((run) =>
		firstString(endpointPayload(run) ?? {}, "browseId")?.startsWith("UC")
	);
	return linked && text(linked);
}

/** The subtitle runs of a row, flattened: every column upstream splits its byline across. */
function flexRuns(node: UnknownRecord): UnknownRecord[] {
	const columns = Array.isArray(node.flex_columns) ? node.flex_columns : [];
	return columns.flatMap((column) => {
		const title = record(column) ? column.title : undefined;
		return record(title) && Array.isArray(title.runs) ? title.runs.filter(record) : [];
	});
}

/**
 * How often a song has been played. It arrives as a flex column of its own beside the subtitle, and
 * `MusicResponsiveListItem` only reads that column for a video, so a song's count is left on the raw
 * node. Localised and already abbreviated ("96M plays"), so it is only ever shown, and only taken
 * when it opens with a digit: a podcast episode puts its show's name in the same column.
 *
 * Which column it is varies, since an album row spends none of them on the artist, so every column
 * after the title is searched. A column that links is skipped rather than read: it names an artist
 * or a release, and an artist can open with a digit too ("21 Savage").
 */
function playsFrom(node: UnknownRecord): string | undefined {
	const columns = Array.isArray(node.flex_columns) ? node.flex_columns : [];
	const counted = columns.slice(1).find((column) => {
		const title = record(column) ? column.title : undefined;
		const runs = record(title) && Array.isArray(title.runs) ? title.runs.filter(record) : [];
		// ponytail: an unlinked artist name opening with a digit would still read as a count. Nothing
		// upstream distinguishes the two beyond the link, so match the word if one ever shows up.
		return !runs.some(endpointPayload) && /^\d/.test(text(title) ?? "");
	});
	const plays = text(record(counted) ? counted.title : undefined) ?? firstString(node, "views");
	return plays && /^\d/.test(plays) ? plays : undefined;
}

/**
 * The line YouTube Music prints under an artist's name, its own wording and its own figure: monthly
 * listeners where it knows one, subscribers where it does not, and nothing at all for a channel row
 * ("Profile • @handle"). It arrives as one subtitle segment beside the kind, so the segment opening
 * with a digit is the count, the same test `playsFrom` makes for the same reason: the wording is
 * localised and pre-abbreviated ("806K ascoltatori mensili"), so it is only ever shown.
 */
function listenersFrom(node: UnknownRecord): string | undefined {
	return text(node.subtitle)
		?.split("•")
		.map((part) => part.trim())
		.find((part) => /^\d/.test(part));
}

/**
 * The same line on the artist's own page, which states it in the raw response and nowhere in the
 * parse: `MusicImmersiveHeader` copies the fields it declares and has no property for this one, so
 * it is read off the browse response before the wrapper is built around it.
 */
export function monthlyListeners(data: unknown): string | undefined {
	const header = record(data) && record(data.header) ? data.header.musicImmersiveHeaderRenderer : undefined;
	return record(header) ? text(header.monthlyListenerCount) : undefined;
}

/**
 * Where a chart puts the row, as upstream numbers it. It has to come from the response rather than
 * from the row's position: a row of a kind `extractEntities` has no entity for is dropped on the way
 * here, and counting the survivors off then renumbers everything under the first one dropped.
 */
function rankFrom(node: UnknownRecord): number | undefined {
	const position = Number.parseInt(text(node.index) ?? "", 10);
	return Number.isInteger(position) && position > 0 ? position : undefined;
}

function jsonValue(value: unknown): unknown {
	if (!record(value)) return value;
	const toJSON = value.toJSON;
	if (typeof toJSON === "function") {
		try {
			return toJSON.call(value);
		} catch {
			return value;
		}
	}
	return value;
}

/** The tree inside a `SuperParsedResult`, which holds it in a private field `walk` cannot reach. */
function unwrapParsed(value: { is_array: boolean; array: () => unknown; item: () => unknown } | undefined) {
	if (!value) return;
	return value.is_array ? value.array() : value.item();
}

function walk(value: unknown, visit: (node: UnknownRecord) => void, seen = new Set<unknown>()) {
	value = jsonValue(value);
	if (!record(value) || seen.has(value)) return;
	seen.add(value);
	visit(value);
	for (const child of Object.values(value)) {
		if (Array.isArray(child)) child.forEach((item) => walk(item, visit, seen));
		else walk(child, visit, seen);
	}
}

export class YouTubeAdapter {
	#client?: Innertube;
	#cookie?: string;
	readonly #continuations = new Map<string, { next: () => Promise<unknown>; skipVideos: boolean }>();
	/**
	 * Home's own tokens, opaque outside this process: a chip's browse parameters, or a page's upstream
	 * continuation string. Unlike `#continuations` these are never spent. A chip has to survive being
	 * tabbed away from and back to, and a continuation has to survive the router serving a cached home
	 * page whose token was already used on the way down, which would otherwise land a reader at the
	 * bottom of a feed that can no longer grow. Replaying either one just refetches the same page.
	 * ponytail: a flat cap standing in for an expiry clock. An evicted token degrades, it does not fail.
	 */
	readonly #homeTokens = new Map<string, { browseId: string; params?: string; continuation?: string }>();
	/**
	 * The last track a history report opened. `addToWatchHistory` and `updateWatchTime` are both stamped
	 * with the playback id their `TrackInfo` minted, so asking for the info a second time reports a
	 * second play rather than the end of the first. One slot is enough, nothing plays two at once.
	 */
	#playing?: { trackId: string; info: Awaited<ReturnType<Innertube["music"]["getInfo"]>> };
	/**
	 * The endpoints the last `accountSettings()` read handed out, one pair per switch. A write replays
	 * the payload upstream stated rather than building one, since the two mechanisms behind these
	 * switches take different bodies and a `boolValue` does not always run the same way as the state
	 * beside it. Never crosses to the renderer: a feedback token is a bearer credential.
	 */
	readonly #settingEndpoints = new Map<AccountSettingKey, AccountSettingEndpoints>();
	readonly #resources: SecureResourceRegistry;
	readonly #cachePath: string;
	readonly #getCookieHeader: () => Promise<string>;
	readonly #getSessionOptions: () => Promise<{ region?: string; restricted?: boolean }>;
	#sessionKey?: string;

	constructor(
		resources: SecureResourceRegistry,
		cachePath: string,
		getCookieHeader: () => Promise<string>,
		getSessionOptions: () => Promise<{ region?: string; restricted?: boolean }> = async () => ({})
	) {
		this.#resources = resources;
		this.#cachePath = cachePath;
		this.#getCookieHeader = getCookieHeader;
		this.#getSessionOptions = getSessionOptions;
	}

	/**
	 * Builds the session ahead of the first query. `Innertube.create` downloads and parses the
	 * player, so leaving it lazy makes whichever page you open first pay for the whole handshake.
	 */
	async warm() {
		await this.#getClient();
	}

	async reset() {
		this.#client = undefined;
		this.#cookie = undefined;
		this.#sessionKey = undefined;
		this.#continuations.clear();
		this.#homeTokens.clear();
		this.#settingEndpoints.clear();
		this.#playing = undefined;
		await rm(this.#cachePath, { recursive: true, force: true });
	}

	async query(request: MusicQuery): Promise<Page<MusicEntity>> {
		// Home's continuation is a bare upstream string rather than the bound `getContinuation` the
		// shared branch below expects, and its first page, a filtered page and a later page all go
		// through one browse, so it is routed before that branch rather than inside the switch.
		if (request.type === "home") return this.#home(request, await this.#getClient());
		if ("continuation" in request && request.continuation) {
			const continuation = this.#continuations.get(request.continuation);
			if (!continuation) throw new Error("Continuation expired");
			this.#continuations.delete(request.continuation);
			return this.#page(await continuation.next(), continuation.skipVideos);
		}

		const client = await this.#getClient();
		switch (request.type) {
			case "explore": {
				const browseId = request.browseId ?? "FEmusic_explore";
				const browsed = await this.#browse(client, browseId, request.params);
				const landing = request.browseId === undefined;
				const explore = extractExploreData(
					browsed?.contents,
					(url) => this.#resources.registerArtwork(url),
					landing,
					browsed?.header
				);
				return {
					...this.#page(browsed?.contents, true),
					explore: !landing || explore.shortcuts.length || explore.sections.length ? explore : undefined,
				};
			}
			case "suggestions":
				// This response also carries the rich rows shown under YouTube Music's search box.
				// Ignore its text suggestions and keep those upstream-ranked entities in their order.
				return this.#page(await client.music.getSearchSuggestions(request.query));
			case "search": {
				const source = await client.music.search(request.query, {
					type: request.filter
						? ({ songs: "song", albums: "album", artists: "artist", playlists: "playlist" } as const)[request.filter]
						: "all",
				});
				const page = this.#page(source, true);
				// Only the unfiltered search is ranked, and only it carries a top result card.
				if (request.filter) return page;
				return {
					...page,
					items: withSearchTopResult(source, page.items, (url) => this.#resources.registerArtwork(url)),
				};
			}
			case "library":
				// The landing feed is recent activity, not the whole library, so the one filter with a list
				// of its own asks for that list: `FEmusic_liked_playlists` is every playlist the account
				// holds, where the landing shows only the few it surfaces. The navigation rail is its caller.
				return this.#page(
					(
						await this.#browse(
							client,
							request.filter === "playlists" ? "FEmusic_liked_playlists" : "FEmusic_library_landing"
						)
					)?.contents
				);
			case "radio": {
				// `music.getUpNext` asserts its way down to `.as(MusicQueue)` and then to an automix node,
				// so this goes through the raw endpoint like `#browse` does. The radio playlist id is named
				// alongside the video because a bare `videoId` answers with one row and an automix
				// placeholder that costs a second round trip to expand, where this answers with about eighty.
				// A `WatchTarget` names its own playlist (an artist's shuffled mix or its radio) and the
				// song it opens on, and its `params` is replayed rather than derived.
				const source = await client.actions.execute("/next", {
					videoId: request.id,
					playlistId: request.playlistId ?? `RDAMVM${request.id}`,
					params: request.params,
					client: "YTMUSIC",
					parse: true,
				});
				// The rows are read out of the memo rather than off the response, because a parsed watch-next
				// keeps its contents in a `Map` and `walk` only descends arrays and plain objects: walking
				// the response itself finds two navigation endpoints and no queue at all.
				// ponytail: no continuation. `PlaylistPanel.continuation` is a bare token, not the
				// `getContinuation()` closure `#page` mints its opaque tokens from, so paging a radio means
				// teaching `#continuations` a second shape. Upstream hands back about eighty rows at once.
				const rows = [...(source.contents_memo?.values() ?? [])].flat();
				return { items: extractQueueTracks(rows, (url) => this.#resources.registerArtwork(url)) };
			}
			case "album": {
				const source = await client.music.getAlbum(request.id);
				const page = this.#page(source);
				return {
					...page,
					items: withAlbumHeader(request.id, source.header, page.items, (url) => this.#resources.registerArtwork(url)),
				};
			}
			case "artist": {
				// `music.getArtist` is this call and this constructor, and it is split open here for the one
				// field the parse throws away: `monthlyListenerCount` sits on the immersive header beside
				// the title, `MusicImmersiveHeader` has no property for it, and asking for it separately
				// would be a second round trip for a line the page has already been answered with.
				const response = await client.actions.execute("/browse", {
					browseId: request.id,
					client: "YTMUSIC",
					parse: false,
				});
				const source = new YTMusic.Artist(response, client.actions);
				// Videos are skipped for the same reason search skips them: an artist page carries a shelf
				// of music videos, lyric uploads and live clips beside its top songs, and the page renders
				// one flat song list, so those arrive as tracks with no release and no length (the top
				// songs playlist below does not hold them either) and read as duplicate rows of the songs.
				const page = this.#page(source, true);
				const items = withArtistHeader(
					request.id,
					source.header,
					page.items,
					(url) => this.#resources.registerArtwork(url),
					monthlyListeners(response.data)
				);
				// The shelves are kept beside the flat page for the "See all" each one states: upstream
				// draws the releases as its own "Albums" and "Singles", and the browse behind that button
				// is a page of its own that appears nowhere in the items below.
				const sections = extractSections(source, (url) => this.#resources.registerArtwork(url));
				return {
					...page,
					sections: sections.length ? sections : undefined,
					items: withTopSongs(items, await this.#topSongs(client, source)),
				};
			}
			case "playlist": {
				const source = await client.music.getPlaylist(request.id);
				const page = this.#page(source);
				return {
					...page,
					items: withPlaylistHeader(request.id, source, page.items, (url) => this.#resources.registerArtwork(url)),
				};
			}
		}
	}

	async command(request: MusicCommand): Promise<{ ok: true; id?: string }> {
		const client = await this.#getClient();
		switch (request.type) {
			case "rate": {
				// Not `client.interact.*`: that passes `target` as a bare video id string where the endpoint
				// wants `{ videoId }` (youtubei.js' own `LikeRequest` type says so, its implementation
				// disagrees with it), and it forces the TV client onto a YouTube Music action.
				const path = { like: "like/like", dislike: "like/dislike", indifferent: "like/removelike" }[request.rating];
				await client.actions.execute(path, { target: { videoId: request.trackId }, client: "YTMUSIC" });
				break;
			}
			case "subscribe":
				await (request.subscribed
					? client.interact.subscribe(request.artistId)
					: client.interact.unsubscribe(request.artistId));
				break;
			case "library-save": {
				// The library holds a release through the same endpoint a thumb goes through, addressed by
				// a playlist instead of a video. An album is addressed by a browse id everywhere in this app,
				// but what the library holds is the audio playlist behind it, which only the album's own
				// canonical URL names, so a save from a card costs the album page it was never opened from.
				const source = request.id.startsWith("MPRE") ? await client.music.getAlbum(request.id) : undefined;
				const path = request.saved ? "like/like" : "like/removelike";
				await client.actions.execute(path, {
					target: { playlistId: libraryTarget(request.id, source?.url) },
					client: "YTMUSIC",
				});
				break;
			}
			case "history": {
				// The start of a play and its end have to be the same playback session. `getInfo` mints a
				// fresh playback id every call and both reports are stamped with it, so asking twice
				// reports two plays rather than one play and how much of it was heard.
				const opened = this.#playing?.trackId === request.trackId ? this.#playing.info : undefined;
				const info = opened ?? (await client.music.getInfo(request.trackId));
				if (!opened) {
					this.#playing = { trackId: request.trackId, info };
					await info.addToWatchHistory();
				}
				if (request.positionSeconds > 0) await info.updateWatchTime(request.positionSeconds);
				break;
			}
			case "playlist-create": {
				// `playlist.create` sends a title and nothing else, where the endpoint behind it takes the
				// description and the privacy in the same request. `params` is the opaque pair upstream's own
				// dialog hands its collaborate toggle, and a private playlist refuses one ("Change privacy to
				// allow collaboration"), which is why the dialog turns the toggle off with the privacy.
				const created = await client.actions.execute("/playlist/create", {
					title: request.title,
					description: request.description,
					privacyStatus: request.privacy.toUpperCase(),
					params: request.collaborate ? COLLABORATION_PARAMS : undefined,
					client: "YTMUSIC",
				});
				return { ok: true, id: record(created.data) ? firstString(created.data, "playlistId") : undefined };
			}
			case "playlist-update": {
				// Not `playlist.setName` and `playlist.setDescription`: both call the edit endpoint on the WEB
				// client, which answers a YouTube Music playlist with a 400, so nothing an edit ever saved
				// landed. Raw, every action rides one request. The privacy action names its value
				// `playlistPrivacy`, not the `privacyStatus` the create endpoint takes, and a request that
				// carries the wrong key succeeds while changing nothing.
				const actions: Record<string, string>[] = [];
				if (request.title) actions.push({ action: "ACTION_SET_PLAYLIST_NAME", playlistName: request.title });
				if (request.description !== undefined) {
					actions.push({ action: "ACTION_SET_PLAYLIST_DESCRIPTION", playlistDescription: request.description });
				}
				if (request.privacy) {
					actions.push({ action: "ACTION_SET_PLAYLIST_PRIVACY", playlistPrivacy: request.privacy.toUpperCase() });
				}
				await client.actions.execute("/browse/edit_playlist", {
					// A playlist is addressed by its browse id everywhere in this app, and this endpoint wants
					// the playlist's own id, which is the same string without the `VL` a browse id carries.
					playlistId: request.playlistId.replace(/^VL/, ""),
					actions,
					client: "YTMUSIC",
				});
				break;
			}
			case "playlist-add":
				await client.playlist.addVideos(request.playlistId, request.trackIds);
				break;
			case "playlist-remove":
				await client.playlist.removeVideos(request.playlistId, request.itemIds, true);
				break;
			case "playlist-reorder":
				if (!request.beforeItemId) throw new Error("A destination item is required");
				await client.playlist.moveVideo(request.playlistId, request.itemId, request.beforeItemId);
				break;
			case "playlist-delete": {
				const result = await client.playlist.delete(request.playlistId.replace(/^VL/, ""));
				if (!result.success) throw new Error("YouTube Music refused to delete the playlist");
				break;
			}
			case "account-setting": {
				// Only an endpoint a read handed out is ever sent, so a key that was never read, or one
				// read before a sign-out cleared the map, refuses rather than guessing a payload.
				const endpoints = this.#settingEndpoints.get(request.key);
				const write = endpoints?.[request.enabled ? "enable" : "disable"];
				if (!write) throw new Error("YouTube Music did not offer that setting");
				if (write.kind === "setting") {
					// `Actions` rewrites `boolValue` into `newValue: { boolValue }` on the way out, which is
					// the shape this endpoint takes, so the payload goes through exactly as it arrived.
					await client.actions.execute("account/set_setting", { ...write.payload, client: "YTMUSIC" });
				} else {
					// The history switches are feedback tokens instead, and the token is minted for one
					// client: the same call under WEB answers 404. Upstream applies it a beat late, so a
					// read straight after this one still states the old value. Nothing here reads back.
					await client.actions.execute("/feedback", { feedbackTokens: [write.token], client: "YTMUSIC" });
				}
				break;
			}
		}
		return { ok: true };
	}

	/**
	 * Whether the account has already rated a track. Nothing in a search, shelf or playlist response
	 * states it, and neither does the parsed watch-next: youtubei.js only reads `like_status` off two
	 * WEB watch-page nodes, and it has no class for the overlay a YouTube Music response keeps it in.
	 * So the response is taken raw and `extractRating` reads the overlay itself. A re-layout costs the
	 * thumbs their state, never the playback.
	 */
	async rating(trackId: string): Promise<TrackRating | undefined> {
		const client = await this.#getClient();
		const response = await client.actions.execute("/next", { videoId: trackId, client: "YTMUSIC" });
		return extractRating(response.data, trackId);
	}

	async resolve(trackId: string, quality: AudioQuality) {
		const client = await this.#getClient();
		// Three separate upstream limits pick this order. WEB and ANDROID hand back SABR-only formats
		// with no URL to decipher. TVHTML5 and MWEB do return a deciphered URL, but googlevideo then
		// answers 403 for it unless the request carries a proof-of-origin token this app cannot mint.
		// YTMUSIC leads because it is the only one that both resolves and streams at opus; IOS is the
		// fallback and is mp4a-only, so its opus attempt always misses.
		const attempts = (["YTMUSIC", "TV_SIMPLY", "IOS"] as const).flatMap((innertubeClient) =>
			(["opus", "mp4a"] as const).map((codec) => ({ innertubeClient, codec }))
		);
		let format;
		let lastError: unknown;
		for (const attempt of attempts) {
			try {
				const candidate = await client.getStreamingData(trackId, {
					type: "audio",
					format: "any",
					codec: attempt.codec,
					quality: quality === "low" ? "bestefficiency" : "best",
					client: attempt.innertubeClient,
				});
				if (candidate.url) {
					format = candidate;
					break;
				}
			} catch (error) {
				lastError = error;
			}
		}
		if (!format?.url) throw lastError instanceof Error ? lastError : new Error("No playable audio stream");
		const codec = /codecs="([^"]+)/.exec(format.mime_type)?.[1] ?? "unknown";
		const fingerprint: AudioVariantFingerprint = {
			itag: format.itag,
			mimeType: format.mime_type,
			codec,
			bitrate: format.bitrate,
			durationMs: format.approx_duration_ms,
		};
		return {
			url: this.#resources.registerMedia({
				url: format.url,
				contentLength: format.content_length,
				fingerprint,
			}),
			fingerprint,
			// YouTube's own measurement. `loudnessDb` is the same value expressed as an offset
			// from the -14 LUFS target, so a loud track reports a positive number there.
			integratedLufs:
				format.track_absolute_loudness_lkfs ?? (format.loudness_db === undefined ? undefined : format.loudness_db - 14),
		};
	}

	/**
	 * Whether the linked account holds a Music Premium subscription. Nothing upstream states it
	 * outright: no response carries an entitlement flag, which is why youtubei.js parses none, and the
	 * account menu's "Paid memberships" row means only that something is being paid for, a channel
	 * membership or a bought film as readily as this.
	 *
	 * What a subscription does change is what `/player` is willing to offer. The 256 kbps tiers, itag
	 * 141 and itag 774, both marked `AUDIO_QUALITY_HIGH`, are offered to a subscriber and to nobody
	 * else, where a free account tops out at the ~130 kbps mediums (140 and 251). That is the same
	 * signal yt-dlp documents, and it is read here rather than off `resolve`, which asks for one format
	 * and would not see the tiers it did not pick.
	 *
	 * One fixed track, never whatever is about to play: the high tier is per master as well as per
	 * account, so a track nobody mastered above 128 states nothing about the subscription and reading
	 * one would refuse a paying listener. This one is a stable, worldwide catalogue entry that carries
	 * both tiers.
	 */
	async entitled(): Promise<boolean | undefined> {
		const client = await this.#getClient();
		const response = await client.actions
			.execute("/player", { videoId: ENTITLEMENT_PROBE_ID, client: "YTMUSIC", parse: false })
			.catch(() => undefined);
		return readEntitlement(response?.data);
	}

	/**
	 * Who the copied session belongs to, for the top bar. `getInfo(true)` is the channel switcher
	 * list: it collects `AccountItem`s out of the response memo, where `getInfo()` asserts the TV
	 * layout around them and throws when upstream moves it. The photo goes through `registerArtwork`
	 * like every other image, so the renderer never holds an identity-bearing Google URL.
	 */
	async account() {
		const client = await this.#getClient();
		const accounts = await client.account.getInfo(true);
		const selected = accounts.find((account) => account.is_selected) ?? accounts[0];
		if (!selected) return;
		// Sorted small to large, and the largest is the one a retina 28px avatar wants.
		const photo = selected.account_photo.at(-1)?.url;
		return {
			accountName: selected.account_name.text,
			avatarUrl: photo ? this.#resources.registerArtwork(photo) : undefined,
		};
	}

	/**
	 * The settings the account holds, which apply to every device signed in to it.
	 *
	 * Raw, and not through `account.getSettings()`, which browses `SPaccount_overview` on the WEB
	 * client: those are youtube.com's own switches (subscription privacy, mentions, leaderboards) and
	 * none of the music ones are among them, while every `SPaccount_*` id answers the music client
	 * with a 500. `account/get_setting` under `YTMUSIC` is what the web player itself asks and it
	 * returns all of them in one response, so there is nothing to page through and nothing to assert.
	 *
	 * Answers empty rather than throwing: this is one section of the settings page, and the page has
	 * to render without it. The endpoints are kept here so a later write can replay them.
	 */
	async accountSettings(): Promise<AccountSetting[]> {
		const client = await this.#getClient();
		const response = await client.actions.execute("account/get_setting", { client: "YTMUSIC" }).catch(() => undefined);
		const { settings, endpoints } = extractAccountSettings(response?.data);
		this.#settingEndpoints.clear();
		for (const [key, value] of endpoints) this.#settingEndpoints.set(key, value);
		return settings;
	}

	/**
	 * YouTube Music's own lyrics, the backstop for everything LRCLIB and NetEase have never seen.
	 * Plain text, never timed: the panel shows it as a block, so there is nothing to sync against.
	 *
	 * This is one of the `client.music.*` wrappers, and it asserts a layout twice over, so it throws
	 * on the ordinary "no lyrics for this track" answer as readily as on a re-layout. Both are the
	 * same outcome here, one tier coming back empty, so neither is worth telling apart. `Text` is
	 * read through the local `text()` rather than `toString()`, which returns the literal "N/A" for
	 * an empty field. Nothing here is logged: the text itself never leaves this call's return value.
	 */
	async lyrics(videoId: string) {
		const client = await this.#getClient();
		const shelf = await client.music.getLyrics(videoId).catch(() => undefined);
		const body = text(shelf?.description)?.trim();
		if (!body) return;
		// A footer states who licensed the text ("Source: Musixmatch"), and it is their credit to keep.
		return { text: body, attribution: text(shelf?.footer)?.trim() || undefined };
	}

	/**
	 * `music.getLibrary()` throws on the shape YouTube serves today ("Expected node of any type
	 * Grid, MusicShelf, got ItemSection"), because its typed wrapper asserts a layout upstream has
	 * moved on from. `extractEntities` only ever reads `id` and `item_type` off parsed nodes, so
	 * the wrapper buys nothing here and the generic browse parse survives a re-layout.
	 * ponytail: no continuation token, since those live on the wrapper. Add one back if these
	 * feeds ever need a second page.
	 *
	 * The parse hands the tree back inside a `SuperParsedResult`, which keeps it in a private field:
	 * `walk` reaches nothing through it, so every feed browsed here came back as an empty page until
	 * the contents were unwrapped. It is the response's own contents either way, never the memo.
	 *
	 * The page's own header is unwrapped and handed back beside those contents, since that is where a
	 * destination states its name and it is nowhere in the shelves below it: dropping it left every
	 * Explore destination titled after its first shelf, printing "Songs" over a shelf of songs.
	 */
	async #browse(client: Innertube, browseId: string, params?: string) {
		const response = await client.actions.execute("/browse", {
			browseId,
			...(params ? { params } : {}),
			client: "YTMUSIC",
			parse: true,
		});
		if (!response.contents) return;
		return { contents: unwrapParsed(response.contents), header: unwrapParsed(response.header) };
	}

	/**
	 * The next page of a browse feed. A continuation response carries no `contents` at all, only
	 * `continuation_contents`, which is why this cannot go through `#browse` and why `HomeFeed`'s own
	 * `getContinuation` throws "Could not find Home tab" on the response it has just fetched.
	 */
	async #continue(client: Innertube, continuation: string) {
		const { continuation_contents } = await client.actions.execute("/browse", {
			continuation,
			client: "YTMUSIC",
			parse: true,
		});
		return continuation_contents;
	}

	/**
	 * Every home page is one browse: the first page, a chip-filtered page and a continuation page come
	 * back as the same section list and go through the same walk.
	 *
	 * `music.getHomeFeed()` is not used at all. It asserts its shelf list down to `MusicCarouselShelf`
	 * and `MusicTastebuilderShelf`, so one unrecognised shelf throws the whole feed away, and its own
	 * continuation rebuilds a `HomeFeed` from a response that has no browse tab in it, so a second page
	 * has never worked through it. The raw call is what the wrapper sends anyway.
	 */
	async #home(request: { filter?: string; continuation?: string }, client: Innertube): Promise<Page<MusicEntity>> {
		const registerArtwork = (url: string) => this.#resources.registerArtwork(url);
		const next = request.continuation ? this.#homeTokens.get(request.continuation) : undefined;
		// An unknown continuation ends the scroll rather than restarting it: answering with the first
		// page here would append the shelves already on screen, and then do it again forever.
		if (request.continuation && !next?.continuation) return { items: [] };
		// An unknown or evicted chip is the unfiltered feed. Reloading a filtered home after a restart
		// hands back exactly that, and it is not an error.
		const chip = request.filter ? this.#homeTokens.get(request.filter) : undefined;
		const source = next?.continuation
			? await this.#continue(client, next.continuation)
			: (await this.#browse(client, chip?.browseId ?? "FEmusic_home", chip?.params))?.contents;

		const sections = extractSections(source, registerArtwork);
		const filters = extractHomeFilters(source).map((filter) => ({
			label: filter.label,
			token: filter.params ? this.#mintHome({ browseId: filter.browseId, params: filter.params }) : undefined,
			selected: filter.selected || undefined,
		}));
		const continuation = feedContinuation(source);
		return {
			// Videos are skipped here the way search and an artist page skip them: home's shelves of
			// live clips and hour-long uploads read as duplicates of the songs, with no release and no
			// length. A shelf left empty by that is dropped like any other empty shelf.
			items: extractEntities(source, registerArtwork, true),
			sections: sections.length ? sections : undefined,
			filters: filters.length ? filters : undefined,
			continuation: continuation ? this.#mintHome({ browseId: "FEmusic_home", continuation }) : undefined,
		};
	}

	#mintHome(value: { browseId: string; params?: string; continuation?: string }) {
		const token = randomBytes(18).toString("base64url");
		this.#homeTokens.set(token, value);
		if (this.#homeTokens.size > 200) {
			const oldest = this.#homeTokens.keys().next();
			if (!oldest.done) this.#homeTokens.delete(oldest.value);
		}
		return token;
	}

	/**
	 * A session carries its cookies from the moment it was built, and the ones it was built from
	 * rotate. Once they do, the old session still answers a browse but every stream URL it mints
	 * comes back 403, so a changed header has to build a new session rather than reuse this one.
	 */
	async #getClient() {
		const cookie = await this.#getCookieHeader();
		// Region and Restricted Mode are fixed when the session is built, exactly as the cookies are,
		// so changing either has to build a new session rather than reuse one still carrying the old
		// value. Compared as one string so a single check covers all three.
		const session = await this.#getSessionOptions();
		const key = `${session.region ?? ""}|${session.restricted ? "1" : ""}`;
		if (!this.#client || cookie !== this.#cookie || key !== this.#sessionKey) {
			await pruneCache(this.#cachePath);
			this.#cookie = cookie;
			this.#sessionKey = key;
			this.#client = await Innertube.create({
				cookie,
				cache: new UniversalCache(true, this.#cachePath),
				location: session.region,
				enable_safety_mode: session.restricted,
			});
		}
		return this.#client;
	}

	/**
	 * The playlist behind the artist page's "Top songs", parsed as a page of its own: it is where both
	 * the lengths the shelf omits and the songs past the fifth come from, so an artist page always
	 * takes this second round trip. Failing it costs those, never the page. Videos are skipped here
	 * for the same reason the artist page skips them.
	 */
	async #topSongs(client: Innertube, source: unknown): Promise<MusicEntity[]> {
		const id = topSongsPlaylist(source);
		if (!id) return [];
		const playlist = await client.music.getPlaylist(id).catch(() => undefined);
		return playlist ? extractEntities(playlist, (url) => this.#resources.registerArtwork(url), true) : [];
	}

	#page(value: unknown, skipVideos = false): Page<MusicEntity> {
		const items = extractEntities(value, (url) => this.#resources.registerArtwork(url), skipVideos);
		const continuationSource = value as Continuable;
		let continuation: string | undefined;
		if (continuationSource.has_continuation && continuationSource.getContinuation) {
			continuation = randomBytes(18).toString("base64url");
			this.#continuations.set(continuation, {
				next: continuationSource.getContinuation.bind(continuationSource),
				skipVideos,
			});
		}
		return { items, continuation };
	}
}

function browseTarget(value: UnknownRecord, title?: string): BrowseTarget | undefined {
	const endpoint = record(value.endpoint) ? value.endpoint : record(value.on_tap) ? value.on_tap : undefined;
	const payload = endpoint && record(endpoint.payload) ? endpoint.payload : undefined;
	const browseId = payload && firstString(payload, "browseId");
	const label = firstString(value, "button_text", "text", "label", "title");
	if (!browseId || !label) return;
	let pageType: string | undefined;
	walk(payload, (node) => {
		if (!pageType && typeof node.pageType === "string") pageType = node.pageType;
	});
	return {
		label,
		title: title ?? label,
		browseId,
		params: firstString(payload, "params"),
		destination: pageType === "MUSIC_PAGE_TYPE_PLAYLIST" || browseId.startsWith("VL") ? "playlist" : "explore",
	};
}

function sectionContents(section: UnknownRecord): UnknownRecord[] {
	const contents = section.type === "Grid" ? section.items : section.contents;
	return Array.isArray(contents) ? contents.filter(record) : [];
}

/** The containers upstream draws a shelf in. A type youtubei.js has no class for never reaches here. */
const shelfTypes = ["Grid", "MusicCarouselShelf", "MusicShelf", "MusicPlaylistShelf"];

/**
 * One shelf of a structured page, whatever container upstream drew it in. Home and Explore read their
 * shelves through this, since the fields are the same and only Explore's navigation shelves and its
 * landing promotion sit outside it. Videos are skipped, so a video-only shelf comes back with nothing
 * in it and is dropped by the same branch that has always dropped an empty one.
 */
function mediaSection(
	section: UnknownRecord,
	contents: UnknownRecord[],
	registerArtwork: (url: string) => string,
	keepListVideos = false
): (MusicSection<MusicEntity> & { layout: "cards" | "ranked" }) | undefined {
	const header = record(section.header) ? section.header : undefined;
	// A carousel states its title in its header, while a MusicShelf and a Grid state it on the section.
	const title = firstString(header ?? section, "title");
	const ranked = contents.some((item) => item.type === "MusicResponsiveListItem");
	// A chart row is a song whatever upstream types it: Explore's "Trending" is eighteen clips in
	// twenty rows, so dropping them left two songs under a heading promising a chart. A shelf of
	// video *cards* ("New music videos") is still dropped whole, here and everywhere else.
	const items = extractEntities(contents, registerArtwork, !(keepListVideos && ranked));
	if (!title || !items.length) return;
	const moreSource =
		(header && record(header.more_content) && header.more_content) ||
		(record(section.bottom_button) && section.bottom_button) ||
		(record(section.endpoint) && { text: "More", endpoint: section.endpoint });
	const artworkUrl = header && thumbnail(header);
	const itemsPerColumn = section.num_items_per_column;
	return {
		title,
		strapline: header && firstString(header, "strapline"),
		artworkUrl: artworkUrl ? registerArtwork(artworkUrl) : undefined,
		itemsPerColumn:
			typeof itemsPerColumn === "number" && Number.isInteger(itemsPerColumn) && itemsPerColumn > 0
				? itemsPerColumn
				: undefined,
		layout: ranked ? "ranked" : "cards",
		items,
		more: record(moreSource) ? browseTarget(moreSource, title) : undefined,
	};
}

/** Preserves Explore navigation, shelf boundaries, and upstream order beside the flat fallback page. */
export function extractExploreData(
	value: unknown,
	registerArtwork: (url: string) => string,
	landing = false,
	header?: unknown
): ExploreData {
	const shortcuts: BrowseTarget[] = [];
	const sections: ExploreSection[] = [];
	let navigationIndex = 0;
	walk(value, (section) => {
		if (!shelfTypes.includes(String(section.type))) return;
		const contents = sectionContents(section);
		if (!contents.length) return;
		const header = record(section.header) ? section.header : undefined;
		const title = firstString(header ?? section, "title");
		const targets = contents
			.filter((item) => item.type === "MusicNavigationButton")
			.map((item) => browseTarget(item))
			.filter((item) => item !== undefined);
		if (targets.length === contents.length) {
			if (landing && section.type === "Grid" && !title && !shortcuts.length) {
				shortcuts.push(...targets);
				return;
			}
			if (!title) return;
			sections.push({
				type: "navigation",
				title,
				layout: navigationIndex++ === 0 ? "moods" : "genres",
				items: targets,
			});
			return;
		}
		const media = mediaSection(section, contents, registerArtwork, true);
		if (media) sections.push({ ...media, type: "media" });
	});
	if (landing) {
		const mood = sections.findIndex((section) => section.type === "navigation");
		if (mood >= 0) {
			const section = sections[mood];
			if (section?.type === "navigation") {
				// What the section adopts, the grid gives up: the shortcut and the section's own "Browse
				// all" lead to the same browse, so leaving both draws one destination twice, a tile and a
				// heading apart. A response whose labels no longer match keeps both, as it always did.
				const index = shortcuts.findIndex((shortcut) => shortcut.label === section.title);
				const target = shortcuts[index];
				if (target) {
					section.more = { ...target, label: "Browse all", title: section.title };
					shortcuts.splice(index, 1);
				}
			}
			if (mood > 0) sections.unshift(...sections.splice(mood, 1));
		}
	}
	const regions = extractExploreRegions(value);
	return {
		// The response's own header first, which is the only place a destination names itself. The
		// contents are still walked behind it, since a page that states no header of its own may
		// still carry one over its lead section.
		title: exploreTitle([header, value]),
		shortcuts,
		sections,
		regions: regions.length ? regions : undefined,
	};
}

/**
 * A chart's region picker, where every option is a browse of its own and so a target of its own. Only
 * an option carrying a browse id is kept: a plain sort option ("Most popular") carries none, which is
 * what keeps a library sort menu, drawn from the same node, out of a page that has no regions.
 */
export function extractExploreRegions(value: unknown): BrowseTarget[] {
	const regions: BrowseTarget[] = [];
	walk(value, (node) => {
		if (node.type !== "MusicMultiSelectMenuItem") return;
		const payload = endpointPayload(node);
		const browseId = payload && firstString(payload, "browseId");
		const title = firstString(node, "title");
		if (!browseId || !title) return;
		const params = firstString(payload, "params");
		if (regions.some((region) => region.browseId === browseId && region.params === params)) return;
		regions.push({
			label: title,
			title,
			browseId,
			params,
			destination: "explore",
			selected: node.selected === true || undefined,
		});
	});
	return regions;
}

/**
 * What a destination page calls itself. Read duck-typed rather than through one of youtubei.js'
 * header classes, since a page states its name in whichever of them upstream drew it with today.
 *
 * A shelf's own header is a node like any other and `walk` reaches a shelf before the header inside
 * it, so the type is what keeps one from winning: a carousel's header parses as
 * `MusicCarouselShelfBasicHeader`, which ends in "Header" exactly like the page's does.
 */
export function exploreTitle(value: unknown): string | undefined {
	let title: string | undefined;
	walk(value, (node) => {
		const type = typeof node.type === "string" ? node.type : "";
		if (title || !type.startsWith("Music") || !type.endsWith("Header") || type.includes("Shelf")) return;
		title = firstString(node, "title");
	});
	return title;
}

/**
 * The shelves of a page that keeps them, read off whatever container the response arrived in: home's
 * first page is a section list under a browse tab, its continuation is a bare `SectionListContinuation`,
 * a chip-filtered page is shaped like the first, and an artist page is a `sections` array. Nothing here
 * keys on any of those fields, which is what lets one walk serve every entry point. Nothing dedupes
 * across shelves either, since the same recommendation is meant to appear in more than one upstream group.
 */
export function extractSections(value: unknown, registerArtwork: (url: string) => string): MusicSection<MusicEntity>[] {
	const sections: MusicSection<MusicEntity>[] = [];
	walk(value, (node) => {
		if (!shelfTypes.includes(String(node.type))) return;
		const contents = sectionContents(node);
		if (!contents.length) return;
		const section = mediaSection(node, contents, registerArtwork);
		if (section) sections.push(section);
	});
	return sections;
}

/**
 * The mood and genre chips over the feed. Only the label and the browse parameters come out of here:
 * `#home` mints the parameters into an opaque token, so nothing upstream states about a chip reaches
 * the renderer. The chip a response already answers is marked selected and carries no parameters.
 *
 * The podcasts chip is dropped: Nixie does not play them, so it is a feed of dead rows. It is
 * matched on the label, which is the "podcast" loanword in most locales, since the params behind a
 * chip are an opaque protobuf with nothing stable to test and every chip shares one browse id.
 */
export function extractHomeFilters(
	value: unknown
): { label: string; browseId: string; params?: string; selected: boolean }[] {
	const filters: { label: string; browseId: string; params?: string; selected: boolean }[] = [];
	walk(value, (node) => {
		if (node.type !== "ChipCloudChip") return;
		const label = firstString(node, "text");
		if (!label || /podcast/i.test(label) || filters.some((filter) => filter.label === label)) return;
		const endpoint = record(node.endpoint) ? node.endpoint : undefined;
		const payload = endpoint && record(endpoint.payload) ? endpoint.payload : undefined;
		filters.push({
			label,
			browseId: (payload && firstString(payload, "browseId")) ?? "FEmusic_home",
			params: payload && firstString(payload, "params"),
			selected: node.is_selected === true,
		});
	});
	return filters;
}

/**
 * The token for the next page of a feed. `walk` visits a node before descending into it, which is what
 * makes the section list's own continuation win over one a shelf inside it happens to carry.
 */
export function feedContinuation(value: unknown): string | undefined {
	let token: string | undefined;
	walk(value, (node) => {
		if (!token && typeof node.continuation === "string" && node.continuation) token = node.continuation;
	});
	return token;
}

/**
 * Only a parsed music node carries both `id` and `item_type`, and that pair is what separates a real
 * entity from the navigation endpoints, menus, and raw payloads wrapped around it.
 *
 * `skipVideos` drops the `video` kind, which is the music videos, lyric uploads and hour-long mixes
 * a search for an artist does not mean to return. Search and Explore set it, while a feed or a
 * playlist that holds a video means to hold it. Podcast episodes (`non_music_track`) and shows
 * (`podcast_show`) are kept: they are results someone searched for.
 */
export function extractEntities(
	value: unknown,
	registerArtwork: (url: string) => string,
	skipVideos = false
): MusicEntity[] {
	const items: MusicEntity[] = [];
	const ids = new Set<string>();
	walk(value, (node) => {
		if (items.length >= 100) return;
		const id = firstString(node, "id");
		const kind = typeof node.item_type === "string" ? node.item_type : undefined;
		const title = firstString(node, "title", "name");
		if (!id || !kind || !title || ids.has(id)) return;
		// Before the id is claimed, so the same upload reappearing as a real song is still taken.
		if (skipVideos && kind === "video") return;
		ids.add(id);
		const artworkUrl = thumbnail(node);
		const artwork = artworkUrl ? registerArtwork(artworkUrl) : undefined;
		const artists = Array.isArray(node.artists)
			? node.artists.filter(record).map(artistFrom)
			: record(node.author)
				? [artistFrom(node.author)]
				: [];

		switch (kind) {
			case "song":
			case "video":
			case "non_music_track": {
				const subtitle = firstString(node, "subtitle");
				// A subscribed channel is labelled a video too, and only the endpoint tells the two apart:
				// anything playable is reached by a watch endpoint, a channel by a browse one.
				const payload = endpointPayload(node);
				if (payload && !firstString(payload, "videoId") && firstString(payload, "browseId")) {
					const channel: Artist = { id, name: title, artworkUrl: artwork };
					items.push(channel);
					return;
				}
				// ponytail: upstream drops playlistSetVideoId when it parses an item, so a track inside a
				// playlist arrives without the id that addresses its row. Read it out of the item's own
				// menu when removing and reordering have to name a row rather than a video.
				const album = albumFrom(node, artwork);
				const track: Track = {
					id,
					title,
					// An album row arrives with no artist at all. Leave it empty rather than inventing one,
					// so `withAlbumHeader` can fill it from the album the row belongs to.
					artists: artists.length ? artists : subtitle ? [artistFrom({ name: subtitle })] : [],
					album,
					albumId: album ? undefined : albumIdFrom(node),
					durationSeconds: numberValue(record(node.duration) ? node.duration.seconds : node.duration),
					artworkUrl: artwork,
					explicit: explicitFrom(node) || undefined,
					plays: playsFrom(node),
					rank: rankFrom(node),
				};
				items.push(track);
				return;
			}
			case "album": {
				// Upstream states the year as the last subtitle run of a release card, and only where the
				// row names no artist, which is exactly an artist page's own "Albums" and "Singles" shelves.
				const album: Album = {
					id,
					title,
					artists,
					year: firstString(node, "year"),
					artworkUrl: artwork,
					explicit: explicitFrom(node) || undefined,
				};
				items.push(album);
				return;
			}
			case "playlist":
			case "podcast_show": {
				// A playlist someone made on YouTube proper reaches the music library alongside the music
				// ones, and this app is only music. Nothing on the row states which it is, but its cover
				// does: a video playlist is pictured with a frame from its first video, 16:9, where every
				// cover YouTube Music draws for itself is square.
				const art = largestThumbnail(node);
				if (art?.width && art.height && art.width !== art.height) return;
				const auto = autoPlaylist(id);
				const playlist: Playlist = {
					id,
					title: auto?.title ?? title,
					artworkUrl: artwork,
					author: playlistAuthor(node),
					itemCount: numberValue(firstString(node, "item_count", "song_count")) || undefined,
				};
				items.push(playlist);
				return;
			}
			case "artist":
			case "library_artist": {
				const artist: Artist = {
					id,
					name: title,
					artworkUrl: artwork,
					rank: rankFrom(node),
					listeners: listenersFrom(node),
				};
				items.push(artist);
			}
		}
	});
	return items;
}

/**
 * The songs in a radio queue. `extractEntities` finds none of them: a queue row is a
 * `PlaylistPanelVideo`, which states its `video_id` and carries neither the `id` nor the `item_type`
 * that walk keys on. Everything else about the row parses the same way a shelf row does, so the
 * helpers are shared.
 */
export function extractQueueTracks(value: unknown, registerArtwork: (url: string) => string): Track[] {
	// A row upstream has a music video for arrives wrapped, holding the song as `primary` and the
	// video as a `counterpart`. That pair is the "Switch to video" toggle, not two entries in the
	// queue, but the memo files both under `PlaylistPanelVideo`, so the walk below sees them as
	// separate rows and a radio plays every such track twice, once as the song and once as its clip.
	// The counterparts are named in a pass of their own because the memo lists all the videos before
	// any of the wrappers, so there is nothing to skip yet by the time the walk reaches them.
	const counterparts = new Set<string>();
	walk(value, (node) => {
		if (!Array.isArray(node.counterpart)) return;
		for (const one of node.counterpart) {
			const id = record(one) && firstString(one, "video_id");
			if (id) counterparts.add(id);
		}
	});
	const tracks: Track[] = [];
	const ids = new Set(counterparts);
	walk(value, (node) => {
		if (tracks.length >= 100) return;
		const id = firstString(node, "video_id");
		const title = firstString(node, "title");
		if (!id || !title || ids.has(id)) return;
		ids.add(id);
		const artworkUrl = thumbnail(node);
		const artwork = artworkUrl ? registerArtwork(artworkUrl) : undefined;
		const artists = Array.isArray(node.artists) ? node.artists.filter(record).map(artistFrom) : [];
		const album = albumFrom(node, artwork);
		tracks.push({
			id,
			title,
			// A queue row names its artists in one joined byline when it does not list them separately.
			// Only the byline is handed over, never the row: `artistFrom` would read the song's own title
			// as the artist's name, since that is the first key it looks at.
			artists: artists.length ? artists : typeof node.author === "string" ? [artistFrom({ name: node.author })] : [],
			album,
			albumId: album ? undefined : albumIdFrom(node),
			durationSeconds: numberValue(record(node.duration) ? node.duration.seconds : node.duration),
			artworkUrl: artwork,
			explicit: explicitFrom(node) || undefined,
		});
	});
	return tracks;
}

/**
 * The track `entitled` asks about. Nothing plays it and nothing shows it: only its format list is
 * read. It is fixed rather than chosen because the answer has to be about the account and not about
 * the track, and it is this one because it is as close to permanent as a catalogue entry gets.
 */
const ENTITLEMENT_PROBE_ID = "dQw4w9WgXcQ";

/**
 * Whether a raw `/player` response was offered a subscriber-only audio tier. See `entitled`.
 *
 * Undefined rather than false whenever the answer cannot be trusted, since a caller locks the app on
 * a negative: a request that failed, a response carrying no `streamingData`, and a format list with
 * no audio in it at all are all "not asked" rather than "asked and refused". Only a list that does
 * hold audio, none of it high, is a definite no.
 */
export function readEntitlement(value: unknown): boolean | undefined {
	const streaming = record(value) && record(value.streamingData) ? value.streamingData : undefined;
	const formats = Array.isArray(streaming?.adaptiveFormats) ? streaming.adaptiveFormats : undefined;
	const audio = formats?.filter((format) => record(format) && String(format.mimeType).startsWith("audio"));
	if (!audio?.length) return undefined;
	return audio.some((format) => record(format) && format.audioQuality === "AUDIO_QUALITY_HIGH");
}

const ratings: Record<string, TrackRating> = { LIKE: "like", DISLIKE: "dislike", INDIFFERENT: "indifferent" };

/**
 * The rating a raw watch-next response states for one video. It lives in the player overlay's own
 * like button, which is the only place any response states all three values outright.
 *
 * Two nearby things are deliberately not used. `likeStatusEntity`, where the web layout keeps this,
 * is absent from a YouTube Music response entirely. And the queue row's menu holds a like toggle
 * whose remaining action implies the state, but it offers no dislike at all, so it could never tell a
 * disliked song from an unrated one. The overlay is read raw because these nodes do not survive the
 * parser: it files them under a `Map` the walk cannot see into, and no class models this overlay.
 */
export function extractRating(value: unknown, trackId: string): TrackRating | undefined {
	let rating: TrackRating | undefined;
	walk(value, (node) => {
		const button = record(node.likeButtonRenderer) ? node.likeButtonRenderer : undefined;
		if (rating || !button) return;
		// The overlay describes the video that was asked for, and states its target when it says so.
		const target = record(button.target) ? button.target : undefined;
		if (target && target.videoId !== trackId) return;
		const status = typeof button.likeStatus === "string" ? ratings[button.likeStatus] : undefined;
		if (status) rating = status;
	});
	return rating;
}

/**
 * A search answers with a `MusicCardShelf` above the list, the one result YouTube Music is most
 * confident about, and it is the only node in the response carrying neither `id` nor `item_type`,
 * so `extractEntities` walks straight past it: searching an artist never returned that artist.
 * Same blind spot as `withAlbumHeader`, and the same fix.
 *
 * Browse cards and watch cards are both rebuilt. The latter matters because the ranked song is not
 * necessarily repeated in the mixed list underneath, while its linked artist and duration are
 * still stated structurally in the card subtitle.
 */
export function withSearchTopResult(
	source: unknown,
	items: MusicEntity[],
	registerArtwork: (url: string) => string
): MusicEntity[] {
	let card: UnknownRecord | undefined;
	walk(source, (node) => {
		if (!card && node.type === "MusicCardShelf") card = node;
	});
	if (!card) return items;
	const title = firstString(card, "title");
	const payload = endpointPayload({ endpoint: card.on_tap });
	const browseId = payload && firstString(payload, "browseId");
	const videoId = payload && firstString(payload, "videoId");
	const id = browseId ?? videoId;
	if (!title || !id) return items;
	// The page the card opens, which is the only unlocalised statement of what the card holds.
	let pageType: string | undefined;
	walk(payload, (node) => {
		if (!pageType && typeof node.pageType === "string") pageType = node.pageType;
	});
	const artworkUrl = thumbnail(card);
	const artwork = artworkUrl ? registerArtwork(artworkUrl) : undefined;
	// "Album • Daft Punk": the separators and the word are localised, the linked runs are the artists.
	const artists = (record(card.subtitle) && Array.isArray(card.subtitle.runs) ? card.subtitle.runs : [])
		.filter(record)
		.map((run) => ({ name: text(run), browseId: firstString(endpointPayload(run) ?? {}, "browseId") }))
		.filter((run) => run.name && run.browseId)
		.map(artistFrom);

	let top: MusicEntity;
	if (videoId) {
		const runs = record(card.subtitle) && Array.isArray(card.subtitle.runs) ? card.subtitle.runs : [];
		top = {
			id,
			title,
			artists,
			albumId: albumIdFrom(card),
			durationSeconds: runs.map(text).map(numberValue).filter(Boolean).at(-1) ?? 0,
			artworkUrl: artwork,
			explicit: explicitFrom(card) || undefined,
		} satisfies Track;
	} else {
		switch (pageType) {
			case "MUSIC_PAGE_TYPE_ARTIST":
				// The card states the count in the same subtitle a row does ("Artist • 806K monthly
				// listeners"), so the top result names it the way every other artist here does.
				top = { id, name: title, artworkUrl: artwork, listeners: listenersFrom(card) } satisfies Artist;
				break;
			case "MUSIC_PAGE_TYPE_ALBUM":
				top = { id, title, artists, artworkUrl: artwork, explicit: explicitFrom(card) || undefined } satisfies Album;
				break;
			case "MUSIC_PAGE_TYPE_PLAYLIST":
			case "MUSIC_PAGE_TYPE_PODCAST_SHOW":
				top = { id, title, artworkUrl: artwork, author: firstString(card, "subtitle") } satisfies Playlist;
				break;
			default:
				return items;
		}
	}
	// The list underneath sometimes repeats the card. The card wins, it is the ranked one.
	return [top, ...items.filter((item) => !("id" in item) || item.id !== id)];
}

/**
 * Same blind spot as `withAlbumHeader`, and the same fix: a playlist names, pictures and describes
 * itself only in its header, which carries no `id`/`item_type` pair, so the page arrived titled
 * "Playlist" with nothing under it and took its cover from the first track.
 *
 * The whole `Playlist` is passed rather than its header because the privacy is not in the header.
 * Upstream states it only for a playlist the account owns, in a second header the parse files in the
 * response memo: a `Map` keyed by node type, which `walk` cannot descend and which `Playlist` reaches
 * only through the page it was parsed from. `header` is the display one, and it says nothing.
 */
export function withPlaylistHeader(
	id: string,
	source: unknown,
	items: MusicEntity[],
	registerArtwork: (url: string) => string
): MusicEntity[] {
	if (!record(source) || !record(source.header)) return items;
	const header = source.header;
	const auto = autoPlaylist(id);
	const title = auto?.title ?? firstString(header, "title");
	if (!title) return items;
	const artworkUrl = thumbnail(header);
	const playlist: Playlist = {
		id,
		title,
		// A responsive header wraps its description in a shelf of its own, an older one states it flat.
		description:
			auto?.description ??
			firstString(header, "description") ??
			(record(header.description) ? firstString(header.description, "description") : undefined),
		artworkUrl: artworkUrl ? registerArtwork(artworkUrl) : undefined,
		// A responsive header names the account that made it in its strapline, an older one under `author`.
		author: playlistAuthor(header) ?? firstString(header, "strapline_text_one"),
		privacy: playlistPrivacy(source),
	};
	return [playlist, ...items];
}

const privacies: Record<string, PlaylistPrivacy> = { PUBLIC: "public", UNLISTED: "unlisted", PRIVATE: "private" };

/** Unlocalised, unlike everything else that header states, so it is the one thing worth reading off it. */
function playlistPrivacy(source: UnknownRecord): PlaylistPrivacy | undefined {
	const page = record(source.page) ? source.page : undefined;
	const memo = page?.contents_memo;
	if (!(memo instanceof Map)) return;
	const editHeader: unknown = (memo.get("MusicPlaylistEditHeader") as unknown[] | undefined)?.[0];
	return record(editHeader) && typeof editHeader.privacy === "string" ? privacies[editHeader.privacy] : undefined;
}

/**
 * Same blind spot as `withAlbumHeader`: an artist page names and pictures itself only in its
 * header, which carries no `id`/`item_type` pair, so the only `Artist` entities `extractEntities`
 * finds on it are the "fans might also like" rows. Without this the page would take its title and
 * photo from whichever unrelated artist that shelf happens to list first.
 */
export function withArtistHeader(
	id: string,
	header: unknown,
	items: MusicEntity[],
	registerArtwork: (url: string) => string,
	listeners?: string
): MusicEntity[] {
	if (!record(header)) return items;
	const name = firstString(header, "title", "name");
	if (!name) return items;
	const image = largestThumbnail(header);
	const artist: Artist = {
		id,
		name,
		description: firstString(header, "description"),
		artworkUrl: image ? registerArtwork(atCardSize(image.url)) : undefined,
		bannerUrl: image ? registerArtwork(atBannerSize(image.url)) : undefined,
		shuffle: watchTarget(header.play_button),
		radio: watchTarget(header.start_radio_button),
		listeners,
	};
	return [artist, ...items];
}

/**
 * The queue behind an artist header's own Shuffle or Mix button. Both are watch endpoints naming a
 * playlist upstream generated, which is the only way to play what YouTube Music plays there: its
 * shuffle is a mix of its own, not this page's ten top songs in another order.
 * ponytail: undefined when upstream states no such button, and the page then omits it. A local
 * fallback would be a second mechanism behind the same word, playing something else.
 */
function watchTarget(button: unknown): WatchTarget | undefined {
	const payload = record(button) ? endpointPayload(button) : undefined;
	if (!payload) return;
	const id = firstString(payload, "videoId");
	const playlistId = firstString(payload, "playlistId");
	return id && playlistId ? { id, playlistId, params: firstString(payload, "params") } : undefined;
}

/**
 * An artist page states no length for its top songs: those rows spend their columns on the play
 * count and the release and carry no fixed column behind them, so the length is absent from the raw
 * response rather than lost on the way out. The one shelf on the page that is a list rather than a
 * carousel is that one, and it points at the playlist holding the same songs, which does state a
 * duration for each. `VL` is what separates a playlist browse id from an album's.
 */
export function topSongsPlaylist(source: unknown) {
	let id: string | undefined;
	walk(source, (node) => {
		if (id || node.type !== "MusicShelf") return;
		const browseId = firstString(endpointPayload(node) ?? {}, "browseId");
		if (browseId?.startsWith("VL")) id = browseId;
	});
	return id;
}

/**
 * That playlist is the same songs in the same ranked order, longer than the shelf and stating a
 * length for every row, so it fills both gaps: the lengths merge back in by video id, and the songs
 * the shelf stopped short of follow up to `limit`. Anything already stating a length keeps it. The
 * extra rows are appended to the flat page, since every reader of it filters by kind and their place
 * among the songs is all that shows.
 */
export function withTopSongs(items: MusicEntity[], songs: MusicEntity[], limit = 10): MusicEntity[] {
	const ranked = songs.filter(isTrack);
	if (!ranked.length) return items;
	const lengths = new Map(ranked.map((track) => [track.id, track.durationSeconds]));
	const filled = items.map((item) =>
		isTrack(item) && !item.durationSeconds ? { ...item, durationSeconds: lengths.get(item.id) ?? 0 } : item
	);
	const have = new Set(filled.filter(isTrack).map((track) => track.id));
	const room = Math.max(0, limit - have.size);
	return [...filled, ...ranked.filter((track) => !have.has(track.id)).slice(0, room)];
}

/**
 * What the like endpoint holds a release under. A playlist reaches here under the `VL` browse prefix
 * it is addressed by, and the endpoint wants it bare. An album reaches here as a browse id, which
 * that endpoint does not know at all: `albumUrl` is the album page's own canonical URL, and the
 * `list` it carries is the audio playlist the library actually stores.
 */
export function libraryTarget(id: string, albumUrl?: string): string {
	if (!albumUrl) return id.replace(/^VL/, "");
	const list = /[?&]list=([\w-]+)/.exec(albumUrl)?.[1];
	if (!list) throw new Error("No audio playlist for this album");
	return list;
}

/**
 * An album's cover, artist and year live only on its header, which carries no `id`/`item_type`
 * pair for `extractEntities` to recognise. Its rows arrive without artwork and may name an artist
 * without the channel id, so the header becomes the page's `Album` and fills in both.
 */
export function withAlbumHeader(
	id: string,
	header: unknown,
	items: MusicEntity[],
	registerArtwork: (url: string) => string
): MusicEntity[] {
	if (!record(header)) return items;
	const title = firstString(header, "title");
	if (!title) return items;
	// A MusicDetailHeader names the artist under `author`, a MusicResponsiveHeader in its strapline.
	const artist: UnknownRecord = record(header.author)
		? header.author
		: record(header.strapline_text_one)
			? header.strapline_text_one
			: { name: firstString(header, "strapline_text_one") };
	const artworkUrl = thumbnail(header);
	// A responsive header has no `year` field, only a subtitle reading "Album • Artist • 2004",
	// whose first segment is also the only place the release says it is a single or an EP.
	const subtitle = firstString(header, "subtitle") ?? "";
	const label = (subtitle.split("•")[0] ?? "").trim();
	const album: Album = {
		id,
		title,
		artists: firstString(artist, "name", "text") ? [artistFrom(artist)] : [],
		year: firstString(header, "year") ?? /\b(?:19|20)\d{2}\b/.exec(subtitle)?.[0],
		artworkUrl: artworkUrl ? registerArtwork(artworkUrl) : undefined,
		// An older header opens its subtitle with the artist or the year instead, and neither is a label.
		kind: label && label !== firstString(artist, "name") && !/^\d+$/.test(label) ? label : undefined,
		explicit: explicitFrom(header) || undefined,
	};
	return [
		album,
		...items.map((item) =>
			isTrack(item)
				? {
						...item,
						album,
						artists: item.artists.length
							? item.artists.map(
									(artist) => artist.id || album.artists.find((candidate) => candidate.name === artist.name) || artist
								)
							: album.artists,
						artworkUrl: item.artworkUrl ?? album.artworkUrl,
					}
				: item
		),
	];
}

export async function pruneCache(path: string, maximumBytes = 16 * 1024 * 1024) {
	const files = await readdir(path).catch(() => []);
	const entries = await Promise.all(
		files.map(async (name) => {
			const filePath = join(path, name);
			const value = await stat(filePath).catch(() => undefined);
			return value?.isFile() ? { filePath, size: value.size, modified: value.mtimeMs } : undefined;
		})
	);
	const ordered = entries.filter((entry) => entry !== undefined).sort((a, b) => b.modified - a.modified);
	let total = 0;
	for (const entry of ordered) {
		total += entry.size;
		if (total > maximumBytes) await unlink(entry.filePath).catch(() => undefined);
	}
}
