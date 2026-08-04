import type {
	Album,
	Artist,
	MusicEntity,
	MusicSection,
	Page,
	Playlist,
	PlaylistItem,
	RemoteId,
	Track,
} from "./contracts";

/**
 * Music entities are narrowed by field presence. `PlaylistItem` is checked first because it wraps
 * a `Track` and would otherwise satisfy none of the other predicates cleanly.
 */
export function isPlaylistItem(item: MusicEntity): item is PlaylistItem {
	return "track" in item;
}

export function isTrack(item: MusicEntity): item is Track {
	return "durationSeconds" in item;
}

export function isArtist(item: MusicEntity): item is Artist {
	return "name" in item && !isPlaylistItem(item);
}

export function isAlbum(item: MusicEntity): item is Album {
	return "artists" in item && !isTrack(item) && !isPlaylistItem(item);
}

export function isPlaylist(item: MusicEntity): item is Playlist {
	return "title" in item && !isTrack(item) && !isAlbum(item) && !isPlaylistItem(item);
}

export function trackAlbumId(track: Track): RemoteId | undefined {
	return track.album?.id ?? track.albumId;
}

/**
 * Where a chart puts an entity. Only a song and an artist are ever charted, and only upstream knows
 * the number: counting rows off instead is wrong the moment a shelf loses one, which every chart
 * shelf does, since its video rows are dropped before the renderer sees them.
 */
export function entityRank(item: MusicEntity): number | undefined {
	const subject = isPlaylistItem(item) ? item.track : item;
	return isTrack(subject) || isArtist(subject) ? subject.rank : undefined;
}

/** Flattens a mixed page down to the tracks that can actually be queued. */
export function toTracks(items: MusicEntity[]): Track[] {
	return items.map((item) => (isPlaylistItem(item) ? item.track : item)).filter(isTrack);
}

export function entityTitle(item: MusicEntity): string {
	if (isPlaylistItem(item)) return item.track.title;
	if (isPlaylist(item)) return autoPlaylist(item.id)?.title ?? item.title;
	return isArtist(item) ? item.name : item.title;
}

export function entityArtwork(item: MusicEntity): string | undefined {
	if (isPlaylistItem(item)) return item.track.artworkUrl;
	if (isPlaylist(item)) return autoPlaylist(item.id)?.artworkUrl ?? item.artworkUrl;
	return item.artworkUrl;
}

/**
 * The two playlists every account holds and nobody made. Upstream draws no cover for either and names
 * no author, so both are keyed off the one stable, unlocalised thing they carry: the browse id, `LM`
 * for liked music and `SE` for saved episodes, which a browse response prefixes with `VL`.
 *
 * Their high-resolution covers use the same restricted artwork protocol as every upstream image.
 */
export function autoPlaylist(
	id: RemoteId
): { artworkUrl: string; author: string; title: string; description?: string } | undefined {
	const key = id.replace(/^VL/, "");
	const cover = autoCovers[key];
	if (!cover) return;
	return {
		artworkUrl: cover,
		author: "Auto-generated",
		title: key === "LM" ? "Liked music" : "Episodes for later",
		description: key === "LM" ? "Songs you like in YouTube Music appear here." : undefined,
	};
}

function artworkProxy(url: string) {
	const id = btoa(url).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	return `noctune://app/artwork/${id}`;
}

const autoCovers: Record<string, string> = {
	LM: artworkProxy("https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-1200.png"),
	SE: artworkProxy("https://www.gstatic.com/youtube/media/ytm/images/pbg/podcast-queue-delhi-1200.png"),
};

export function artistNames(artists: Artist[]): string {
	return artists.map((artist) => artist.name).join(", ");
}

export function entitySubtitle(item: MusicEntity): string {
	if (isPlaylistItem(item)) return artistNames(item.track.artists);
	if (isTrack(item) || isAlbum(item)) return artistNames(item.artists);
	if (isArtist(item)) return "Artist";
	// A search row knows nothing about its length, and "0 tracks" reads as an empty playlist.
	return (
		item.description ??
		item.author ??
		autoPlaylist(item.id)?.author ??
		(item.itemCount ? `${item.itemCount} tracks` : "")
	);
}

/**
 * What a page of search results can be organised around. A result names its own artist, and a song
 * also names the release it came from, which is enough to lead with the things someone searching
 * that term was probably reaching for. An id is only claimed when upstream identified one:
 * `artistFrom` leaves it empty for a name it could not link, and an empty id addresses nothing.
 */
export function searchAnchor(top: MusicEntity | undefined): { artistId?: string; from: MusicEntity[] } {
	// A playlist is nobody's release and has no artist, so it anchors nothing.
	if (!top || isPlaylistItem(top) || isPlaylist(top)) return { from: [] };
	if (isArtist(top)) return { artistId: top.id || undefined, from: [] };
	const artist = top.artists[0];
	// The album a song came from, then whoever made it: what the result itself points at, ahead of
	// what merely ranked near it.
	const from = [isTrack(top) ? top.album : undefined, artist].filter((item): item is Album | Artist =>
		Boolean(item?.id)
	);
	return { artistId: artist?.id || undefined, from };
}

/**
 * An artist page lists releases the way YouTube orders them, newest first, which puts anniversary
 * reissues ahead of the records someone searched the name to find. Nothing upstream ranks albums by
 * popularity, but two lists already on the page are ranked: the search results, and the artist's top
 * songs, which each name the release they came from. So whichever of those reaches an album first
 * decides its place, and an album neither mentions keeps upstream's order behind them.
 *
 * A reissue carries its own id, so "American Idiot" ranking well does not lift the anniversary
 * edition with it. That is the point: the ranked signal is what someone actually plays.
 */
export function byPopularity(albums: Album[], ranked: MusicEntity[]): Album[] {
	const rank = new Map<string, number>();
	for (const item of ranked) {
		const id = isTrack(item) ? item.album?.id : isAlbum(item) ? item.id : undefined;
		if (id && !rank.has(id)) rank.set(id, rank.size);
	}
	if (!rank.size) return albums;
	// Sorting is stable, so everything unranked keeps the order it arrived in.
	return [...albums].sort(
		(a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
	);
}

/**
 * What a row is, the way YouTube Music labels one in a mixed list. An album says which kind of
 * release it is when upstream told us, since "Single" and "EP" are what that page will call itself.
 */
export function entityKind(item: MusicEntity): string {
	if (isPlaylistItem(item) || isTrack(item)) return "Song";
	if (isAlbum(item)) return item.kind ?? "Album";
	if (isArtist(item)) return "Artist";
	return "Playlist";
}

/**
 * A home page's shelves. Upstream states them, and the four kind shelves are the fallback for a feed
 * that came back flat.
 *
 * Only the first page of a feed may fall back. A later page synthesising its own "Quick picks" and
 * "Albums" would put a second shelf under each of those headings every time the reader scrolls.
 */
export function homeShelves(page: Page<MusicEntity>, allowFallback: boolean): MusicSection<MusicEntity>[] {
	const sections =
		page.sections?.length || !allowFallback
			? (page.sections ?? [])
			: [
					{ title: "Quick picks", items: page.items.filter(isTrack) },
					{ title: "Albums", items: page.items.filter(isAlbum) },
					{ title: "Artists", items: page.items.filter(isArtist) },
					{ title: "Playlists", items: page.items.filter(isPlaylist) },
				];
	return sections.filter((section) => section.items.length);
}

/** The shelves a home feed has grown past its first page, and which feed they belong to. */
export interface GrownFeed {
	key: string;
	shelves: MusicSection<MusicEntity>[];
	next?: string;
}

/**
 * Appends a page to the feed it was requested for. The key is the chip the request was made under,
 * and a mismatch means a chip was tapped while the page was in flight: that page belongs to a feed
 * nobody is looking at any more, so it is dropped rather than appended under the new one. Returning
 * the input unchanged is what makes the guard a pure function instead of an aborted request.
 */
export function appendPage(state: GrownFeed | undefined, key: string, page?: Page<MusicEntity>): GrownFeed {
	if (state && state.key !== key) return state;
	return {
		key,
		shelves: [...(state?.shelves ?? []), ...(page ? homeShelves(page, false) : [])],
		// A page that states no continuation ends the feed, and so does one that never arrived.
		next: page?.continuation,
	};
}
