import { describe, expect, it } from "vitest";
import type { Album, Artist, Playlist, PlaylistItem, Track } from "./contracts";
import {
	appendPage,
	autoPlaylist,
	byPopularity,
	entityArtwork,
	entityKind,
	entityRank,
	entitySubtitle,
	entityTitle,
	homeShelves,
	isAlbum,
	isArtist,
	isPlaylist,
	isPlaylistItem,
	isTrack,
	searchAnchor,
	toTracks,
} from "./entities";

const artist: Artist = { id: "ar1", name: "Artist" };
const track: Track = { id: "t1", title: "Track", artists: [artist], durationSeconds: 180 };
const album: Album = { id: "al1", title: "Album", artists: [artist] };
const playlist: Playlist = { id: "p1", title: "Playlist", itemCount: 2 };
const item: PlaylistItem = { itemId: "i1", track };

describe("entity guards", () => {
	it("assigns every entity kind to exactly one guard", () => {
		const guards = [isTrack, isAlbum, isArtist, isPlaylist, isPlaylistItem];
		for (const entity of [track, album, artist, playlist, item]) {
			expect(guards.filter((guard) => guard(entity))).toHaveLength(1);
		}
	});

	it("labels a mixed search row by what it is", () => {
		expect([track, album, artist, playlist].map(entityKind)).toEqual(["Song", "Album", "Artist", "Playlist"]);
		expect(entityKind({ ...album, kind: "Single" })).toBe("Single");
		// A search row carries no length, and "0 tracks" would read as an empty playlist.
		expect(entitySubtitle({ id: "p2", title: "Best of" })).toBe("");
	});

	it("unwraps playlist items when flattening a page to a queue", () => {
		expect(toTracks([album, item, artist, track, playlist])).toEqual([track, track]);
	});
});

describe("chart position", () => {
	it("states a number only for a row upstream numbered", () => {
		expect(entityRank({ ...track, rank: 5 })).toBe(5);
		expect(entityRank({ ...artist, rank: 2 })).toBe(2);
		// A row inside a playlist is charted as the song it wraps.
		expect(entityRank({ ...item, track: { ...track, rank: 7 } })).toBe(7);
		// An ordinary shelf row carries none, and nothing charts a release at all.
		expect(entityRank(track)).toBeUndefined();
		expect(entityRank(album)).toBeUndefined();
	});
});

describe("auto-generated playlists", () => {
	it("covers and labels the two nobody made, with or without the browse prefix", () => {
		for (const id of ["VLLM", "LM", "VLSE", "SE"]) {
			expect(autoPlaylist(id)?.artworkUrl).toMatch(/^nixie:\/\/app\/artwork\//);
		}
		expect(autoPlaylist("LM")?.artworkUrl).toBe(
			`nixie://app/artwork/${Buffer.from("https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-1200.png").toString("base64url")}`
		);
		expect(autoPlaylist("SE")?.artworkUrl).toBe(
			`nixie://app/artwork/${Buffer.from("https://www.gstatic.com/youtube/media/ytm/images/pbg/podcast-queue-delhi-1200.png").toString("base64url")}`
		);
		expect(autoPlaylist("VLLM")).toMatchObject({
			title: "Liked music",
			description: "Songs you like in YouTube Music appear here.",
		});
		expect(autoPlaylist("VLSE")).toMatchObject({ title: "Episodes for later" });
		expect(entityTitle({ id: "VLLM", title: "Liked Music" })).toBe("Liked music");
		expect(entitySubtitle({ id: "VLLM", title: "Liked Music" })).toBe("Auto-generated");
		expect(entityArtwork({ id: "VLSE", title: "Episodes for Later" })).toBe(autoPlaylist("SE")?.artworkUrl);
	});

	it("leaves an ordinary playlist to its own cover and author", () => {
		expect(autoPlaylist("VLPLcool")).toBeUndefined();
		expect(entityArtwork({ ...playlist, artworkUrl: "nixie://app/artwork/cover" })).toBe("nixie://app/artwork/cover");
		expect(entitySubtitle({ ...playlist, author: "Edoardo" })).toBe("Edoardo");
	});
});

describe("album popularity", () => {
	const reissue: Album = { ...album, id: "al2", title: "Album (Anniversary Edition)" };
	const other: Album = { ...album, id: "al3", title: "Other" };
	const catalogue = [reissue, other, album];

	it("leads with what the ranked lists reach first", () => {
		// A top song names the release it came from, which is the strongest signal on the page.
		expect(byPopularity(catalogue, [{ ...track, album }, other])).toEqual([album, other, reissue]);
	});

	it("keeps upstream's order for anything unranked, and for all of it when nothing ranks", () => {
		expect(byPopularity(catalogue, [other])).toEqual([other, reissue, album]);
		expect(byPopularity(catalogue, [artist, playlist, track])).toEqual(catalogue);
	});
});

describe("search anchor", () => {
	it("anchors an artist on itself and lifts nothing above the ranking", () => {
		expect(searchAnchor(artist)).toEqual({ artistId: "ar1", from: [] });
	});

	it("leads a song with the album it came from, then who made it", () => {
		expect(searchAnchor({ ...track, album })).toEqual({ artistId: "ar1", from: [album, artist] });
		// No album on the row is the common case, and the artist alone is still worth leading with.
		expect(searchAnchor(track)).toEqual({ artistId: "ar1", from: [artist] });
	});

	it("leads an album with its artist", () => {
		expect(searchAnchor(album)).toEqual({ artistId: "ar1", from: [artist] });
	});

	it("claims nothing upstream did not identify", () => {
		// A row that only names an artist in its subtitle carries no id, and an empty id addresses
		// nothing: querying it throws in main, and a card built from it links nowhere.
		const unlinked: Track = { ...track, artists: [{ id: "", name: "Artist" }] };
		expect(searchAnchor(unlinked)).toEqual({ artistId: undefined, from: [] });
		expect(searchAnchor(playlist)).toEqual({ from: [] });
		expect(searchAnchor(item)).toEqual({ from: [] });
		expect(searchAnchor(undefined)).toEqual({ from: [] });
	});
});

describe("home feed", () => {
	const shelf = { title: "Listen again", items: [track] };

	it("keeps the shelves upstream sent, and drops the empty ones", () => {
		expect(homeShelves({ items: [], sections: [shelf, { title: "Empty", items: [] }] }, true)).toEqual([shelf]);
	});

	it("synthesises shelves by kind only for a first page", () => {
		const flat = { items: [track, album, artist, playlist] };
		expect(homeShelves(flat, true).map((section) => section.title)).toEqual([
			"Quick picks",
			"Albums",
			"Artists",
			"Playlists",
		]);
		// A later page falling back would file a second "Quick picks" under the first, every scroll.
		expect(homeShelves(flat, false)).toEqual([]);
	});

	it("appends a page to the feed it was asked for", () => {
		const grown = appendPage({ key: "", shelves: [shelf], next: "one" }, "", {
			items: [],
			sections: [{ title: "Mixed for you", items: [album] }],
			continuation: "two",
		});
		expect(grown).toEqual({
			key: "",
			shelves: [shelf, { title: "Mixed for you", items: [album] }],
			next: "two",
		});
	});

	it("drops a page that lands after the chip it was requested under changed", () => {
		const state = { key: "relax", shelves: [shelf], next: "one" };
		// Identity, not just equality: nothing re-renders off a page belonging to a feed nobody is
		// looking at any more.
		expect(appendPage(state, "festa", { items: [], sections: [{ title: "Late", items: [album] }] })).toBe(state);
	});

	it("ends the feed on a page that states no continuation, and on one that never arrived", () => {
		expect(appendPage({ key: "", shelves: [], next: "one" }, "", { items: [] }).next).toBeUndefined();
		const failed = appendPage({ key: "", shelves: [shelf], next: "one" }, "", undefined);
		expect(failed).toEqual({ key: "", shelves: [shelf], next: undefined });
	});
});
