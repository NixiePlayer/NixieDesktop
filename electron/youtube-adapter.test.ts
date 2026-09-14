import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Innertube } from "youtubei.js";
import { isArtist, isTrack } from "../src/shared/entities";
import {
	extractEntities,
	extractExploreData,
	extractHomeFilters,
	extractSections,
	extractQueueTracks,
	extractRating,
	readEntitlement,
	exploreTitle,
	feedContinuation,
	libraryTarget,
	pruneCache,
	monthlyListeners,
	topSongsPlaylist,
	withAlbumHeader,
	withArtistHeader,
	withPlaylistHeader,
	withSearchTopResult,
	withTopSongs,
	YouTubeAdapter,
} from "./youtube-adapter";

vi.mock("youtubei.js", () => ({
	Innertube: { create: vi.fn(() => Promise.resolve({})) },
	UniversalCache: vi.fn(),
}));

const paths: string[] = [];

afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

/** Shaped like what the parser hands back: a shelf of items, each wrapped in navigation payloads. */
const shelf = {
	type: "MusicCarouselShelf",
	header: { type: "MusicCarouselShelfBasicHeader", title: "Quick picks" },
	contents: [
		{
			type: "MusicResponsiveListItem",
			id: "zvC6jsZnicY",
			item_type: "song",
			title: "Vengo Dalla Luna",
			duration: { text: "4:15", seconds: 255 },
			artists: [{ name: "Caparezza", channel_id: "UCGsv8l1sq32W1Xptp7ywaNA" }],
			thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/small.jpg" }] },
			endpoint: { type: "NavigationEndpoint", name: "watchEndpoint", payload: { videoId: "zvC6jsZnicY" } },
		},
		{
			type: "MusicTwoRowItem",
			id: "MPREb_2OsyiPiMOco",
			item_type: "album",
			title: "Museica",
			artists: [{ name: "Caparezza", channel_id: "UCGsv8l1sq32W1Xptp7ywaNA" }],
			thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/album.jpg" }] },
		},
		{
			type: "MusicTwoRowItem",
			id: "VLPL0PpBFf",
			item_type: "playlist",
			title: "ita rocco",
			item_count: "85",
		},
		{ type: "MusicTwoRowItem", id: "UCGsv8l1sq32W1Xptp7ywaNA", item_type: "artist", title: "Caparezza" },
		{
			// A subscribed channel arrives labelled a video, addressed by a browse endpoint.
			type: "MusicTwoRowItem",
			id: "UCzP4Y0ePukTJFW7-obgrMxg",
			item_type: "video",
			title: "Josh Dun",
			subtitle: "Profile • @JoshuaDun",
			endpoint: {
				type: "NavigationEndpoint",
				name: "browseEndpoint",
				payload: { browseId: "UCzP4Y0ePukTJFW7-obgrMxg" },
			},
		},
	],
};

const identity = (url: string) => url;

const browseButton = (label: string, browseId: string, params?: string, pageType?: string) => ({
	type: "MusicNavigationButton",
	button_text: label,
	endpoint: {
		payload: {
			browseId,
			params,
			browseEndpointContextSupportedConfigs: pageType ? { browseEndpointContextMusicConfig: { pageType } } : undefined,
		},
	},
});

describe("Explore shelves", () => {
	const repeated = {
		type: "MusicTwoRowItem",
		id: "album-one",
		item_type: "album",
		title: "Discovery",
		thumbnail: { contents: [{ url: "https://example.test/discovery.jpg" }] },
		endpoint: { payload: { browseId: "MPREalbum-one" } },
	};
	const explore = [
		{
			type: "Grid",
			items: [
				browseButton("New releases", "FEmusic_new_releases"),
				browseButton("Charts", "FEmusic_charts"),
				browseButton("Moods & genres", "FEmusic_moods_and_genres", "ggMPOgE%3D"),
			],
		},
		{
			type: "MusicCarouselShelf",
			header: {
				title: "New albums & singles",
				strapline: "Fresh this week",
				thumbnail: { contents: [{ url: "https://example.test/releases.jpg" }] },
				more_content: {
					text: "More",
					endpoint: { payload: { browseId: "FEmusic_new_releases", params: "more-params" } },
				},
			},
			num_items_per_column: 2,
			contents: [repeated],
		},
		{
			type: "MusicCarouselShelf",
			header: { title: "Moods & genres" },
			contents: [
				browseButton("Feel good", "FEmusic_moods", "feel-good"),
				browseButton("Party", "FEmusic_moods", "party"),
			],
		},
		{
			type: "MusicShelf",
			title: "Trending",
			contents: [
				{ type: "MusicResponsiveListItem", id: "song-one", item_type: "song", title: "One More Time" },
				repeated,
			],
			endpoint: {
				payload: {
					browseId: "VLPLcharts",
					browseEndpointContextSupportedConfigs: {
						browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_PLAYLIST" },
					},
				},
			},
		},
		{
			type: "MusicCarouselShelf",
			header: { title: "New music videos" },
			contents: [
				{ type: "MusicTwoRowItem", id: "video-one", item_type: "video", title: "Around the World" },
				{ type: "MusicTwoRowItem", id: "video-two", item_type: "video", title: "Harder Better Faster Stronger" },
			],
		},
	];

	it("preserves shortcuts, shelf metadata, targets, and promoted mood order", () => {
		const data = extractExploreData(explore, (url) => `secure:${url}`, true);
		// The moods shortcut is gone from the grid, since the section below leads to the same browse. The
		// `more` assertion under this one is where it went: adopted, not dropped.
		expect(data.shortcuts.map(({ label, browseId, params }) => ({ label, browseId, params }))).toEqual([
			{ label: "New releases", browseId: "FEmusic_new_releases", params: undefined },
			{ label: "Charts", browseId: "FEmusic_charts", params: undefined },
		]);
		expect(data.sections.map(({ title }) => title)).toEqual(["Moods & genres", "New albums & singles", "Trending"]);
		expect(data.sections[0]).toMatchObject({
			type: "navigation",
			layout: "moods",
			more: {
				label: "Browse all",
				title: "Moods & genres",
				browseId: "FEmusic_moods_and_genres",
				params: "ggMPOgE%3D",
				destination: "explore",
			},
		});
		expect(data.sections[0]?.items[0]).toMatchObject({
			label: "Feel good",
			params: "feel-good",
			destination: "explore",
		});
		expect(data.sections[1]).toMatchObject({
			type: "media",
			strapline: "Fresh this week",
			artworkUrl: "secure:https://example.test/releases.jpg",
			itemsPerColumn: 2,
			layout: "cards",
			more: { label: "More", title: "New albums & singles", params: "more-params" },
		});
		expect(data.sections[2]).toMatchObject({
			type: "media",
			layout: "ranked",
			items: [{ id: "song-one" }, { id: "album-one" }],
			more: { browseId: "VLPLcharts", destination: "playlist" },
		});
		const releases = data.sections[1];
		const trending = data.sections[2];
		expect(releases?.type === "media" && releases.items[0]).toMatchObject({
			id: "album-one",
			artworkUrl: "secure:https://example.test/discovery.jpg",
		});
		expect(trending?.type === "media" && trending.items[1]).toMatchObject({ id: "album-one" });
	});

	it("keeps the destination navigation hierarchy", () => {
		const data = extractExploreData(
			[
				{ type: "Grid", header: { title: "Moods & moments" }, items: [browseButton("Chill", "FEmusic_moods")] },
				{ type: "Grid", header: { title: "Genres" }, items: [browseButton("Rock", "FEmusic_genres")] },
			],
			identity
		);
		expect(data).toMatchObject({
			shortcuts: [],
			sections: [
				{ type: "navigation", title: "Moods & moments", layout: "moods" },
				{ type: "navigation", title: "Genres", layout: "genres" },
			],
		});
	});

	it("extracts playlist shelf destinations without flattening their rows into another section", () => {
		const data = extractExploreData(
			{
				type: "MusicPlaylistShelf",
				title: "Top songs",
				contents: [{ type: "MusicResponsiveListItem", id: "song-one", item_type: "song", title: "One More Time" }],
			},
			identity
		);
		expect(data.sections).toMatchObject([
			{ type: "media", title: "Top songs", layout: "ranked", items: [{ id: "song-one" }] },
		]);
	});

	it("forwards the root and destination browse arguments exactly", async () => {
		const execute = vi.fn().mockResolvedValue({
			contents: { is_array: true, array: () => explore },
		});
		vi.mocked(Innertube.create).mockResolvedValueOnce({ actions: { execute } } as never);
		const adapter = new YouTubeAdapter(
			{ registerArtwork: identity } as never,
			join(tmpdir(), "nixie-cache-missing"),
			() => Promise.resolve("SID=explore")
		);

		await adapter.query({ type: "explore" });
		await adapter.query({ type: "explore", browseId: "FEmusic_moods", params: "opaque%3D" });
		expect(execute).toHaveBeenNthCalledWith(1, "/browse", {
			browseId: "FEmusic_explore",
			client: "YTMUSIC",
			parse: true,
		});
		expect(execute).toHaveBeenNthCalledWith(2, "/browse", {
			browseId: "FEmusic_moods",
			params: "opaque%3D",
			client: "YTMUSIC",
			parse: true,
		});
	});

	it("keeps the chart number upstream stated, for a song and for an artist", () => {
		const data = extractExploreData(
			[
				{
					type: "MusicShelf",
					title: "Top songs",
					contents: [
						// A chart row upstream types a video is still a chart row, and keeps its place.
						{
							type: "MusicResponsiveListItem",
							id: "video-one",
							item_type: "video",
							title: "Around the World",
							index: { text: "4" },
						},
						{
							type: "MusicResponsiveListItem",
							id: "song-one",
							item_type: "song",
							title: "One More Time",
							index: { text: "5" },
						},
						{ type: "MusicResponsiveListItem", id: "song-two", item_type: "song", title: "Aerodynamic" },
					],
				},
				{
					type: "MusicShelf",
					title: "Top artists",
					contents: [
						{
							type: "MusicResponsiveListItem",
							id: "UCartist",
							item_type: "artist",
							title: "Daft Punk",
							index: { text: "2" },
						},
					],
				},
			],
			identity
		);
		// Numbering the rows off their position would give a row upstream never numbered a place it
		// does not hold, and renumber everything under any row a kind filter did drop.
		expect(data.sections[0]).toMatchObject({
			items: [
				{ id: "video-one", rank: 4 },
				{ id: "song-one", rank: 5 },
				{ id: "song-two", rank: undefined },
			],
		});
		expect(data.sections[1]).toMatchObject({ items: [{ id: "UCartist", rank: 2 }] });
	});

	it("keeps a chart's video rows but still drops a shelf of video cards", () => {
		const data = extractExploreData(
			[
				{
					type: "MusicCarouselShelf",
					header: { type: "MusicCarouselShelfBasicHeader", title: "Trending" },
					contents: [{ type: "MusicResponsiveListItem", id: "video-one", item_type: "video", title: "Criminal" }],
				},
				{
					type: "MusicCarouselShelf",
					header: { type: "MusicCarouselShelfBasicHeader", title: "New music videos" },
					contents: [{ type: "MusicTwoRowItem", id: "video-two", item_type: "video", title: "Doom" }],
				},
			],
			identity
		);
		expect(data.sections).toMatchObject([{ title: "Trending", items: [{ id: "video-one" }] }]);
	});

	it("maps a chart's region picker and drops an option that browses nothing", () => {
		const data = extractExploreData(
			{
				type: "MusicShelf",
				title: "Top songs",
				contents: [{ type: "MusicResponsiveListItem", id: "song-one", item_type: "song", title: "One More Time" }],
				menu: {
					items: [
						{
							type: "MusicMultiSelectMenuItem",
							title: "Italy",
							selected: true,
							endpoint: { payload: { browseId: "FEmusic_charts", params: "IT" } },
						},
						{
							type: "MusicMultiSelectMenuItem",
							title: "Global",
							selected: false,
							endpoint: { payload: { browseId: "FEmusic_charts", params: "ZZ" } },
						},
						// A sort option is drawn with the same node and browses nowhere.
						{ type: "MusicMultiSelectMenuItem", title: "Recently added", selected: false },
					],
				},
			},
			identity
		);
		expect(data.regions).toMatchObject([
			{
				label: "Italy",
				title: "Italy",
				browseId: "FEmusic_charts",
				params: "IT",
				destination: "explore",
				selected: true,
			},
			{ label: "Global", browseId: "FEmusic_charts", params: "ZZ" },
		]);
		expect(data.regions?.[1]?.selected).toBeUndefined();
		expect(extractExploreData(shelf, identity).regions).toBeUndefined();
	});

	it("names the page from the response's own header, never from a shelf's", () => {
		// The real shape: a destination states its name in the browse response's `header`, beside the
		// contents rather than inside them, so a page titled from the contents alone is titled "Songs".
		const data = extractExploreData(shelf, identity, false, { type: "MusicHeader", title: "Charts" });
		expect(data.title).toBe("Charts");
		// A carousel's header ends in "Header" too, so only the type keeps it from titling the page.
		expect(exploreTitle(shelf)).toBeUndefined();
		expect(exploreTitle({ type: "MusicImmersiveHeader", title: "Moods & genres" })).toBe("Moods & genres");
	});

	it("leaves the root flat fallback available when no structured containers survive", async () => {
		const execute = vi.fn().mockResolvedValue({
			contents: {
				is_array: false,
				item: () => ({ id: "album-one", item_type: "album", title: "Discovery" }),
			},
		});
		vi.mocked(Innertube.create).mockResolvedValueOnce({ actions: { execute } } as never);
		const adapter = new YouTubeAdapter(
			{ registerArtwork: identity } as never,
			join(tmpdir(), "nixie-cache-missing"),
			() => Promise.resolve("SID=flat-explore")
		);

		const page = await adapter.query({ type: "explore" });
		expect(page.explore).toBeUndefined();
		expect(page.items).toMatchObject([{ id: "album-one" }]);
	});
});

describe("home shelves", () => {
	const repeated = { id: "song-one", item_type: "song", title: "One More Time" };
	const home = {
		sections: [
			{
				type: "MusicCarouselShelf",
				header: {
					title: { text: "Listen again" },
					strapline: { text: "Made for Edoardo" },
					thumbnail: { contents: [{ url: "https://example.test/avatar.jpg" }] },
				},
				num_items_per_column: 3,
				contents: [repeated, repeated, { id: "album-one", item_type: "album", title: "Discovery" }],
			},
			{ type: "MusicTasteBuilderShelf", primary_text: { text: "Tell us what you like" } },
			{
				type: "MusicCarouselShelf",
				header: { title: { text: "" } },
				contents: [{ id: "hidden", item_type: "song", title: "Hidden" }],
			},
			{ type: "MusicCarouselShelf", header: { title: { text: "Empty" } }, contents: [] },
			{
				type: "MusicCarouselShelf",
				header: { title: { text: "More like Daft Punk" } },
				contents: [repeated, { id: "artist-one", item_type: "artist", title: "Daft Punk" }],
			},
		],
	};

	it("preserves supported shelf metadata, order, and repeated recommendations", () => {
		const sections = JSON.parse(JSON.stringify(extractSections(home, (url) => `secure:${url}`)));
		expect(
			sections.map((section: { items: { id: string }[] } & Record<string, unknown>) => ({
				title: section.title,
				strapline: section.strapline,
				artworkUrl: section.artworkUrl,
				itemsPerColumn: section.itemsPerColumn,
				items: section.items.map((item) => item.id),
			}))
		).toEqual([
			{
				title: "Listen again",
				strapline: "Made for Edoardo",
				artworkUrl: "secure:https://example.test/avatar.jpg",
				itemsPerColumn: 3,
				items: ["song-one", "album-one"],
			},
			{
				title: "More like Daft Punk",
				items: ["song-one", "artist-one"],
			},
		]);
	});

	it("reads a shelf whatever container upstream drew it in, and states how to draw it", () => {
		const sections = extractSections(
			{
				contents: [
					{
						type: "MusicShelf",
						title: { text: "Cover e remix" },
						contents: [{ type: "MusicResponsiveListItem", id: "song-two", item_type: "song", title: "Hey Jude" }],
					},
					{
						type: "Grid",
						title: { text: "From your library" },
						items: [{ type: "MusicTwoRowItem", id: "MPREb_gridone", item_type: "album", title: "Dookie" }],
					},
					{ type: "MusicTasteBuilderShelf", primary_text: { text: "Tell us what you like" } },
				],
			},
			identity
		);
		expect(sections).toMatchObject([
			{ title: "Cover e remix", layout: "ranked", items: [{ id: "song-two" }] },
			{ title: "From your library", layout: "cards", items: [{ id: "MPREb_gridone" }] },
		]);
	});

	it("carries a shelf's own More target", () => {
		const [section] = extractSections(
			{
				type: "MusicCarouselShelf",
				header: {
					title: { text: "New releases" },
					more_content: {
						text: "More",
						endpoint: { payload: { browseId: "FEmusic_new_releases", params: "opaque%3D" } },
					},
				},
				contents: [{ id: "MPREb_release", item_type: "album", title: "Nimrods" }],
			},
			identity
		);
		expect(section?.more).toMatchObject({
			label: "More",
			title: "New releases",
			browseId: "FEmusic_new_releases",
			destination: "explore",
		});
	});

	it("prefers the feed's own continuation over one nested in a shelf", () => {
		expect(
			feedContinuation({
				type: "SectionList",
				continuation: "feed-token",
				contents: [{ type: "MusicShelf", continuation: "shelf-token" }],
			})
		).toBe("feed-token");
	});

	/** A first page: a section list under a browse tab, with the chip cloud as its header. */
	const chip = (text: string, params: string) => ({
		type: "ChipCloudChip",
		text: { text },
		is_selected: false,
		endpoint: { payload: { browseId: "FEmusic_home", params } },
	});
	const firstPage = {
		type: "SectionList",
		header: { type: "ChipCloud", chips: [chip("Relax", "relax%3D"), chip("Festa", "festa%3D")] },
		continuation: "upstream-page-two",
		contents: [
			...home.sections,
			{
				type: "MusicCarouselShelf",
				header: { title: { text: "New music videos" } },
				contents: [{ id: "video-one", item_type: "video", title: "Aurora Live at MSG" }],
			},
		],
	};

	const homeAdapter = (execute: ReturnType<typeof vi.fn>, cookie: string) => {
		vi.mocked(Innertube.create).mockResolvedValueOnce({ actions: { execute } } as never);
		return new YouTubeAdapter({ registerArtwork: identity } as never, join(tmpdir(), "nixie-cache-missing"), () =>
			Promise.resolve(cookie)
		);
	};
	const browsed = (value: unknown) => ({ contents: { is_array: false, item: () => value } });

	it("browses home raw, drops videos, and returns shelves beside the flat page", async () => {
		const execute = vi.fn().mockResolvedValue(browsed(firstPage));
		const page = await homeAdapter(execute, "SID=home").query({ type: "home" });

		expect(execute).toHaveBeenCalledExactlyOnceWith("/browse", {
			browseId: "FEmusic_home",
			client: "YTMUSIC",
			parse: true,
		});
		// The video and the shelf that held nothing else are both gone.
		expect(page.items.map((item) => ("id" in item ? item.id : undefined))).toEqual([
			"song-one",
			"album-one",
			"hidden",
			"artist-one",
		]);
		expect(page.sections?.map((section) => section.title)).toEqual(["Listen again", "More like Daft Punk"]);
		expect(page.filters?.map((filter) => filter.label)).toEqual(["Relax", "Festa"]);
		expect(page.continuation).toBeTruthy();
	});

	it("drops the podcasts chip, which filters the feed down to rows nothing here plays", () => {
		const chips = {
			type: "ChipCloud",
			chips: [chip("Podcast", "podcast%3D"), chip("Relax", "relax%3D")],
		};
		expect(extractHomeFilters(chips).map((filter) => filter.label)).toEqual(["Relax"]);
	});

	it("states nothing upstream about a chip beyond its label", async () => {
		const execute = vi.fn().mockResolvedValue(browsed(firstPage));
		const page = await homeAdapter(execute, "SID=opaque").query({ type: "home" });

		const serialised = JSON.stringify(page);
		expect(serialised).not.toContain("relax%3D");
		expect(serialised).not.toContain("upstream-page-two");
	});

	it("returns shelves on a later page, and asks for it by continuation alone", async () => {
		const execute = vi
			.fn()
			.mockResolvedValueOnce(browsed(firstPage))
			.mockResolvedValueOnce({
				continuation_contents: {
					type: "SectionListContinuation",
					continuation: "upstream-page-three",
					contents: [
						{
							type: "MusicCarouselShelf",
							header: { title: { text: "Mixed for you" } },
							contents: [{ id: "MPREb_second", item_type: "album", title: "Discovery" }],
						},
					],
				},
			});
		const adapter = homeAdapter(execute, "SID=pages");

		const first = await adapter.query({ type: "home" });
		const second = await adapter.query({ type: "home", continuation: first.continuation });

		expect(execute).toHaveBeenNthCalledWith(2, "/browse", {
			continuation: "upstream-page-two",
			client: "YTMUSIC",
			parse: true,
		});
		// The regression this whole feature rests on: a later page is shelved, not a flat item list.
		expect(second.sections?.map((section) => section.title)).toEqual(["Mixed for you"]);
		expect(second.continuation).toBeTruthy();
	});

	it("applies a chip through its own browse parameters", async () => {
		const execute = vi.fn().mockResolvedValue(browsed(firstPage));
		const adapter = homeAdapter(execute, "SID=chips");

		const page = await adapter.query({ type: "home" });
		const token = page.filters?.[0]?.token;
		await adapter.query({ type: "home", filter: token });
		// A chip has to survive being tabbed away from and back to, so its token is not spent.
		await adapter.query({ type: "home", filter: token });

		expect(execute).toHaveBeenNthCalledWith(2, "/browse", {
			browseId: "FEmusic_home",
			params: "relax%3D",
			client: "YTMUSIC",
			parse: true,
		});
		expect(execute).toHaveBeenNthCalledWith(3, "/browse", {
			browseId: "FEmusic_home",
			params: "relax%3D",
			client: "YTMUSIC",
			parse: true,
		});
	});

	it("degrades an unknown chip to the unfiltered feed and an unknown page to the end of the feed", async () => {
		const execute = vi.fn().mockResolvedValue(browsed(firstPage));
		const adapter = homeAdapter(execute, "SID=degrade");

		const filtered = await adapter.query({ type: "home", filter: "not-a-real-token" });
		expect(execute).toHaveBeenCalledExactlyOnceWith("/browse", {
			browseId: "FEmusic_home",
			client: "YTMUSIC",
			parse: true,
		});
		expect(filtered.sections?.length).toBeTruthy();

		// Answering an expired page with the first one would append what is already on screen, forever.
		const grown = await adapter.query({ type: "home", continuation: "not-a-real-token" });
		expect(grown).toEqual({ items: [] });
		expect(execute).toHaveBeenCalledOnce();
	});

	it("bounds the tokens it holds, and forgets them all on reset", async () => {
		const many = {
			...firstPage,
			header: {
				type: "ChipCloud",
				chips: Array.from({ length: 201 }, (_, index) => chip(`Mood ${index}`, `mood-${index}%3D`)),
			},
		};
		const execute = vi.fn().mockResolvedValue(browsed(many));
		const adapter = homeAdapter(execute, "SID=cap");

		// 201 chips and a continuation is two mints past the cap, so the two oldest are dropped and the
		// newest is not. Every query mints the whole cloud again, hence the order of these two.
		const page = await adapter.query({ type: "home" });
		const evicted = page.filters?.[0]?.token;
		const kept = page.filters?.at(-1)?.token;

		await adapter.query({ type: "home", filter: kept });
		expect(execute).toHaveBeenNthCalledWith(2, "/browse", {
			browseId: "FEmusic_home",
			params: "mood-200%3D",
			client: "YTMUSIC",
			parse: true,
		});

		await adapter.query({ type: "home", filter: evicted });
		expect(execute).toHaveBeenNthCalledWith(3, "/browse", { browseId: "FEmusic_home", client: "YTMUSIC", parse: true });
	});

	it("forgets every home token on reset", async () => {
		const execute = vi.fn().mockResolvedValue(browsed(firstPage));
		const adapter = homeAdapter(execute, "SID=reset");

		const page = await adapter.query({ type: "home" });
		await adapter.reset();
		vi.mocked(Innertube.create).mockResolvedValueOnce({ actions: { execute } } as never);

		await adapter.query({ type: "home", filter: page.filters?.[0]?.token });
		expect(execute).toHaveBeenNthCalledWith(2, "/browse", { browseId: "FEmusic_home", client: "YTMUSIC", parse: true });
	});
});

describe("history reporting", () => {
	it("keeps one playback session per track, so a start and an end are one play", async () => {
		const addToWatchHistory = vi.fn().mockResolvedValue(undefined);
		const updateWatchTime = vi.fn().mockResolvedValue(undefined);
		const getInfo = vi.fn().mockResolvedValue({ addToWatchHistory, updateWatchTime });
		vi.mocked(Innertube.create).mockResolvedValueOnce({ music: { getInfo } } as never);
		const adapter = new YouTubeAdapter(
			{ registerArtwork: identity } as never,
			join(tmpdir(), "nixie-cache-missing"),
			() => Promise.resolve("SID=history")
		);

		await adapter.command({ type: "history", trackId: "zvC6jsZnicY", positionSeconds: 0 });
		await adapter.command({ type: "history", trackId: "zvC6jsZnicY", positionSeconds: 254 });
		expect(getInfo).toHaveBeenCalledOnce();
		expect(addToWatchHistory).toHaveBeenCalledOnce();
		expect(updateWatchTime).toHaveBeenCalledExactlyOnceWith(254);

		await adapter.command({ type: "history", trackId: "aaaaaaaaaaa", positionSeconds: 0 });
		expect(getInfo).toHaveBeenCalledTimes(2);
		expect(addToWatchHistory).toHaveBeenCalledTimes(2);
	});
});

describe("entity extraction", () => {
	const items = extractEntities(shelf, (url) => `nixie://app/artwork/${encodeURIComponent(url)}`);

	it("keeps one entity per item and no wrapper", () => {
		// The shelf header and every navigation endpoint carry a title but no `item_type`.
		expect(items).toHaveLength(5);
	});

	it("keeps a channel labelled a video out of the playable rows", () => {
		expect(items[4]).toEqual({ id: "UCzP4Y0ePukTJFW7-obgrMxg", name: "Josh Dun", artworkUrl: undefined });
	});

	it("drops videos when search asks it to, and keeps podcasts", () => {
		const results = {
			contents: [
				{ id: "aaaaaaaaaaa", item_type: "song", title: "One More Time" },
				{ id: "bbbbbbbbbbb", item_type: "video", title: "Daft Punk Greatest Hits Mix" },
				{ id: "ccccccccccc", item_type: "non_music_track", title: "Thomas Bangalter, interviewed" },
				{ id: "MPSPPLddddddddd", item_type: "podcast_show", title: "Record Night Podcast" },
			],
		};
		expect(extractEntities(results, identity)).toHaveLength(4);
		expect(extractEntities(results, identity, true)).toMatchObject([
			{ id: "aaaaaaaaaaa" },
			{ id: "ccccccccccc" },
			{ id: "MPSPPLddddddddd" },
		]);
	});

	it("drops a playlist covered by a video frame, which is one from YouTube proper", () => {
		const library = {
			contents: [
				{
					id: "VLPLmusic",
					item_type: "playlist",
					title: "Cool pop punk",
					thumbnail: {
						type: "MusicThumbnail",
						contents: [{ url: "https://example.test/cover.jpg", width: 192, height: 192 }],
					},
				},
				{
					id: "VLPLvideos",
					item_type: "playlist",
					title: "blink-182 - ENEMA OF THE STATE [FULL ALBUM BASS COVER]",
					thumbnail: {
						type: "MusicThumbnail",
						contents: [{ url: "https://example.test/frame.jpg", width: 400, height: 225 }],
					},
				},
				// Upstream states no size for some rows, and a playlist is music until it says otherwise.
				{ id: "VLPLunsized", item_type: "playlist", title: "ita rocco" },
			],
		};
		expect(extractEntities(library, identity)).toMatchObject([{ id: "VLPLmusic" }, { id: "VLPLunsized" }]);
	});

	it("names whoever made a playlist, from the author or the one subtitle run that links", () => {
		const library = {
			contents: [
				// A responsive row: parsed with an author of its own.
				{ id: "VLPLrow", item_type: "playlist", title: "Cool pop punk", author: { name: "Edoardo" } },
				// A grid tile: the name is a subtitle run, and only the link tells it from the count.
				{
					id: "VLPLtile",
					item_type: "playlist",
					title: "ita rocco",
					subtitle: {
						runs: [
							{ text: "Edoardo", endpoint: { payload: { browseId: "UCGsv8l1sq32W1Xptp7ywaNA" } } },
							{ text: " • " },
							{ text: "85 songs" },
						],
					},
				},
				{ id: "VLLM", item_type: "playlist", title: "Liked Music", subtitle: { runs: [{ text: "Auto" }] } },
			],
		};
		expect(extractEntities(library, identity)).toMatchObject([
			{ id: "VLPLrow", author: "Edoardo" },
			{ id: "VLPLtile", author: "Edoardo" },
			{ id: "VLLM", title: "Liked music", author: undefined },
		]);
	});

	it("reads the fields upstream actually exposes", () => {
		expect(items[0]).toMatchObject({
			id: "zvC6jsZnicY",
			title: "Vengo Dalla Luna",
			durationSeconds: 255,
			artists: [{ id: "UCGsv8l1sq32W1Xptp7ywaNA", name: "Caparezza" }],
		});
		expect(items[0]).toHaveProperty("artworkUrl", expect.stringContaining("nixie://app/artwork/"));
		expect(items[1]).toMatchObject({ id: "MPREb_2OsyiPiMOco", title: "Museica" });
		expect(items[2]).toMatchObject({ id: "VLPL0PpBFf", title: "ita rocco", itemCount: 85 });
		expect(items[3]).toMatchObject({ id: "UCGsv8l1sq32W1Xptp7ywaNA", name: "Caparezza" });
	});

	it("keeps the release a song row names, and its cover with it", () => {
		const rows = extractEntities(
			{
				contents: [
					{
						id: "zvC6jsZnicY",
						item_type: "song",
						title: "Vengo Dalla Luna",
						album: { id: "MPREb_2OsyiPiMOco", name: "Museica" },
						thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://lh3.googleusercontent.com/cover" }] },
					},
					// A row that names no release, and one whose release upstream did not identify.
					{ id: "aaaaaaaaaaa", item_type: "song", title: "One More Time" },
					{ id: "bbbbbbbbbbb", item_type: "song", title: "Aerodynamic", album: { name: "Discovery" } },
				],
			},
			identity
		);
		expect(rows[0]).toHaveProperty("album", {
			id: "MPREb_2OsyiPiMOco",
			title: "Museica",
			artists: [],
			artworkUrl: "https://lh3.googleusercontent.com/cover",
		});
		expect(rows[1]).toHaveProperty("album", undefined);
		expect(rows[2]).toHaveProperty("album", undefined);
	});

	it("finds the release in the column upstream stops short of, and in the row's own menu", () => {
		const link = (text: string, browseId: string) => ({ text, endpoint: { payload: { browseId } } });
		const column = (...runs: object[]) => ({
			type: "MusicResponsiveListItemFlexColumn",
			title: { runs },
		});
		const rows = extractEntities(
			{
				contents: [
					// An artist's top songs: the columns upstream parses hold the artist and the play count,
					// and the release is in the one after them.
					{
						id: "aaaaaaaaaaa",
						item_type: "song",
						title: "Basket Case",
						flex_columns: [
							column({ text: "Basket Case" }),
							column(link("Green Day", "UC4JNeITH4P7G51C1hJoG6vQ")),
							column({ text: "695M plays" }),
							column(link("Dookie", "MPREb_j62lA390yon")),
						],
					},
					// A search result, which names its release nowhere but in its menu.
					{
						id: "bbbbbbbbbbb",
						item_type: "song",
						title: "American Idiot",
						flex_columns: [column({ text: "American Idiot" }), column({ text: "Song" })],
						menu: {
							type: "Menu",
							items: [
								{ type: "MenuNavigationItem", endpoint: { payload: { browseId: "MPTCVyV54YwPAkk" } } },
								{ type: "MenuNavigationItem", endpoint: { payload: { browseId: "MPREb_jnYA50rlu4H" } } },
							],
						},
					},
				],
			},
			identity
		);
		expect(rows[0]).toMatchObject({ album: { id: "MPREb_j62lA390yon", title: "Dookie" }, albumId: undefined });
		expect(rows[1]).toMatchObject({ album: undefined, albumId: "MPREb_jnYA50rlu4H" });
	});

	it("wraps a row of an editable playlist in the id that addresses it there", () => {
		const rows = extractEntities(
			{
				contents: [
					// A playlist row. Upstream states `playlistSetVideoId` on it and the parse drops the field
					// entirely, so the only copy left is inside the row's own "Remove from playlist" item.
					{
						id: "zvC6jsZnicY",
						item_type: "song",
						title: "Vengo Dalla Luna",
						menu: {
							type: "Menu",
							items: [
								{ type: "MenuNavigationItem", endpoint: { payload: { browseId: "MPREb_2OsyiPiMOco" } } },
								{
									type: "MenuServiceItem",
									endpoint: {
										payload: {
											playlistId: "PL0PpBFf",
											actions: [{ action: "ACTION_REMOVE_VIDEO", setVideoId: "AAA111BBB222" }],
										},
									},
								},
							],
						},
					},
					// The same row in a playlist this account cannot edit: no such item, so no such id, and a
					// song rather than a row. An id that addresses nothing is what the endpoint refuses.
					{ id: "aaaaaaaaaaa", item_type: "song", title: "Una Chiave" },
				],
			},
			identity
		);
		expect(rows[0]).toEqual({ itemId: "AAA111BBB222", track: expect.objectContaining({ id: "zvC6jsZnicY" }) });
		expect(rows[1]).toMatchObject({ id: "aaaaaaaaaaa", title: "Una Chiave" });
		expect(rows[1]).not.toHaveProperty("itemId");
	});

	it("reads the play count off the column upstream only parses for videos", () => {
		const column = (...runs: string[]) => ({
			type: "MusicResponsiveListItemFlexColumn",
			title: { runs: runs.map((run) => ({ text: run })) },
		});
		const rows = extractEntities(
			{
				contents: [
					{
						id: "xg_Y7Or_hWM",
						item_type: "song",
						title: "Last Night on Earth",
						flex_columns: [column("Last Night on Earth"), column("Song", " • ", "Green Day"), column("96M plays")],
					},
					// A video's count is the one upstream does read out, off the subtitle instead.
					{ id: "aaaaaaaaaaa", item_type: "video", title: "American Idiot (Live)", views: "1.8M views" },
					// An album row names no artist, so its count is the second column rather than the third.
					{
						id: "ccccccccccc",
						item_type: "song",
						title: "Welcome to the Black Parade",
						flex_columns: [column("Welcome to the Black Parade"), column("612M plays")],
					},
					// An episode puts its show in the same column, which is not a count of anything.
					{
						id: "bbbbbbbbbbb",
						item_type: "non_music_track",
						title: "Billie Joe Armstrong, interviewed",
						flex_columns: [column("Billie Joe Armstrong, interviewed"), column("Episode"), column("Much Rewind")],
					},
					// An artist opening with a digit is a link, and a count never is.
					{
						id: "ddddddddddd",
						item_type: "song",
						title: "a lot",
						flex_columns: [
							column("a lot"),
							{
								type: "MusicResponsiveListItemFlexColumn",
								title: {
									runs: [{ text: "21 Savage", endpoint: { payload: { browseId: "UCkFTAqzSJ8sqA7c8n_zEgSA" } } }],
								},
							},
						],
					},
				],
			},
			identity
		);
		expect(rows.map((row) => ("plays" in row ? row.plays : undefined))).toEqual([
			"96M plays",
			"1.8M views",
			"612M plays",
			undefined,
			undefined,
		]);
	});

	it("asks the image CDN for a card-sized cover instead of the 120px a song row offers", () => {
		const sized = extractEntities(
			{
				id: "zvC6jsZnicY",
				item_type: "song",
				title: "Vengo Dalla Luna",
				thumbnail: {
					type: "MusicThumbnail",
					contents: [
						{ url: "https://lh3.googleusercontent.com/cover=w60-h60-l90-rj" },
						{ url: "https://lh3.googleusercontent.com/cover=w120-h120-l90-rj" },
					],
				},
			},
			(url) => url
		);
		expect(sized[0]).toHaveProperty("artworkUrl", "https://lh3.googleusercontent.com/cover=w544-h544-l90-rj");
	});
});

describe("album header", () => {
	/** An album page: the header holds the cover and the artist, the rows hold neither. */
	const header = {
		type: "MusicResponsiveHeader",
		title: { text: "American Idiot" },
		subtitle: { runs: [{ text: "Album" }, { text: " • " }, { text: "Green Day" }, { text: " • " }, { text: "2004" }] },
		strapline_text_one: { text: "Green Day", endpoint: { payload: { browseId: "UC_green_day" } } },
		subtitle_badge: [{ type: "MusicInlineBadge", icon_type: "MUSIC_EXPLICIT_BADGE" }],
		thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/cover.jpg" }] },
	};
	const rows = extractEntities(
		{
			contents: [
				{
					type: "MusicResponsiveListItem",
					id: "vBBmyaGiRcs",
					item_type: "song",
					title: "Jesus of Suburbia",
					subtitle: "Green Day",
					duration: { text: "9:08", seconds: 548 },
					badges: [{ type: "MusicInlineBadge", icon_type: "MUSIC_EXPLICIT_BADGE" }],
					endpoint: { type: "NavigationEndpoint", name: "watchEndpoint", payload: { videoId: "vBBmyaGiRcs" } },
				},
			],
		},
		(url) => url
	);
	const items = withAlbumHeader("MPREb_album", header, rows, (url) => `nixie://app/artwork/${url}`);

	it("turns the header into the page's album", () => {
		expect(items[0]).toEqual({
			id: "MPREb_album",
			title: "American Idiot",
			artists: [{ id: "UC_green_day", name: "Green Day" }],
			year: "2004",
			artworkUrl: "nixie://app/artwork/https://example.test/cover.jpg",
			kind: "Album",
			explicit: true,
		});
	});

	it("marks the explicit rows", () => {
		expect(items[1]).toHaveProperty("explicit", true);
	});

	it("fills the bare rows from it", () => {
		expect(items[1]).toMatchObject({
			id: "vBBmyaGiRcs",
			artists: [{ id: "UC_green_day", name: "Green Day" }],
			artworkUrl: "nixie://app/artwork/https://example.test/cover.jpg",
			album: { title: "American Idiot" },
		});
	});
});

describe("playlist header", () => {
	/** A playlist page: the display header, and the edit header only its owner is served. */
	const source = {
		header: {
			type: "MusicResponsiveHeader",
			title: { text: "Cool pop punk" },
			subtitle: {
				runs: [{ text: "Playlist" }, { text: " • " }, { text: "Private" }, { text: " • " }, { text: "2026" }],
			},
			second_subtitle: { text: "21 tracks • 1 hour, 32 minutes" },
			strapline_text_one: { text: "Edoardo" },
			description: { type: "MusicDescriptionShelf", description: { text: "My cool pop punk collection" } },
			thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/cover.jpg" }] },
		},
		page: {
			contents_memo: new Map([
				["MusicPlaylistEditHeader", [{ type: "MusicPlaylistEditHeader", privacy: "PRIVATE", playlist_id: "PLcool" }]],
			]),
		},
	};
	const items = withPlaylistHeader("VLPLcool", source, [], (url) => `nixie://app/artwork/${url}`);

	it("turns the header into the page's playlist", () => {
		expect(items[0]).toEqual({
			id: "VLPLcool",
			title: "Cool pop punk",
			description: "My cool pop punk collection",
			artworkUrl: "nixie://app/artwork/https://example.test/cover.jpg",
			// Named in the strapline, which is the only place a playlist page says who made it.
			author: "Edoardo",
			privacy: "private",
		});
	});

	it("states no privacy for a playlist the account does not own", () => {
		const items = withPlaylistHeader("VLPLcool", { header: source.header }, [], (url) => url);
		expect(items[0]).toHaveProperty("privacy", undefined);
	});

	it("replaces auto-generated metadata that points at settings Nixie does not expose", () => {
		const items = withPlaylistHeader("VLLM", { header: source.header }, [], (url) => url);
		expect(items[0]).toMatchObject({
			title: "Liked music",
			description: "Songs you like in YouTube Music appear here.",
		});
	});

	it("leaves the page alone when upstream sent no header", () => {
		expect(withPlaylistHeader("VLPLcool", {}, [], (url) => url)).toEqual([]);
	});
});

describe("artist header", () => {
	/** An artist page: the header names it, the shelves below list somebody else. */
	const header = {
		type: "MusicImmersiveHeader",
		title: { text: "blink-182" },
		description: { text: "An American rock band formed in Poway, California." },
		thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/blink=w226-h226" }] },
		// Its own Shuffle and Mix: each names a queue upstream generated around the artist.
		play_button: { endpoint: { payload: { videoId: "song_1", playlistId: "RDAO_blink", params: "wAEB8gECKAE%3D" } } },
		start_radio_button: { endpoint: { payload: { videoId: "song_2", playlistId: "RDEM_blink" } } },
	};
	const related = extractEntities(
		{
			contents: [
				{ type: "MusicTwoRowItem", id: "UC_green_day", item_type: "artist", title: "Green Day" },
				{ type: "MusicTwoRowItem", id: "UC_sum_41", item_type: "artist", title: "Sum 41" },
			],
		},
		(url) => url
	);
	const items = withArtistHeader("UC_blink_182", header, related, (url) => `nixie://app/artwork/${url}`);

	it("turns the header into the page's artist", () => {
		expect(items[0]).toEqual({
			id: "UC_blink_182",
			name: "blink-182",
			description: "An American rock band formed in Poway, California.",
			// The same image twice: card size beside a title, and the wide box the page's banner needs.
			artworkUrl: "nixie://app/artwork/https://example.test/blink=w544-h544",
			bannerUrl: "nixie://app/artwork/https://example.test/blink=w1920-h1080",
			shuffle: { id: "song_1", playlistId: "RDAO_blink", params: "wAEB8gECKAE%3D" },
			radio: { id: "song_2", playlistId: "RDEM_blink" },
		});
	});

	it("keeps the related artists behind it", () => {
		expect(items.filter(isArtist).map((artist) => artist.name)).toEqual(["blink-182", "Green Day", "Sum 41"]);
	});

	it("leaves a button naming no queue alone", () => {
		const [artist] = withArtistHeader(
			"UC_blink_182",
			{ ...header, play_button: { endpoint: { payload: { videoId: "song_1" } } }, start_radio_button: undefined },
			[],
			(url) => url
		);
		expect(artist).toMatchObject({ shuffle: undefined, radio: undefined });
	});
});

describe("listener counts", () => {
	const listeners = (nodes: unknown[]) =>
		extractEntities({ contents: nodes }, (url) => url)
			.filter(isArtist)
			.map((artist) => artist.listeners);

	it("reads the count out of a row and a card, and states none for a channel", () => {
		expect(
			listeners([
				// A search row leads its subtitle with the kind, a card states the count alone, and a
				// channel row states a handle instead: only a segment opening with a digit is a count.
				{ id: "UC_a", item_type: "artist", title: "Caparezza", subtitle: { text: "Artist • 806K monthly listeners" } },
				{ id: "UC_b", item_type: "artist", title: "Frankie hi-nrg mc", subtitle: { text: "7.71K subscribers" } },
				{ id: "UC_c", item_type: "artist", title: "Fan page", subtitle: { text: "Profile • @fanpage" } },
			])
		).toEqual(["806K monthly listeners", "7.71K subscribers", undefined]);
	});

	it("reads the artist page's own count off the raw header the parse drops", () => {
		const data = {
			header: {
				musicImmersiveHeaderRenderer: {
					title: { runs: [{ text: "Caparezza" }] },
					monthlyListenerCount: { runs: [{ text: "806K monthly listeners" }] },
				},
			},
		};
		expect(monthlyListeners(data)).toBe("806K monthly listeners");
		expect(monthlyListeners({ header: {} })).toBeUndefined();
	});
});

describe("top song lengths", () => {
	/** An artist page: one list shelf pointing at the playlist of the same songs, then carousels. */
	const artistPage = {
		sections: [
			{
				type: "MusicShelf",
				title: { text: "Top songs" },
				endpoint: { payload: { browseId: "VLOLAK5uy_top_songs" } },
				contents: [
					{ type: "MusicResponsiveListItem", id: "vBBmyaGiRcs", item_type: "song", title: "American Idiot" },
					{ type: "MusicResponsiveListItem", id: "U0XcqF7rqHk", item_type: "song", title: "21 Guns" },
				],
			},
			{ type: "MusicCarouselShelf", endpoint: { payload: { browseId: "MPREb_american_idiot" } }, contents: [] },
		],
	};
	/** The playlist behind it: the same songs, ranked the same way, longer, each stating a length. */
	const playlist = {
		contents: [
			{
				type: "MusicResponsiveListItem",
				id: "vBBmyaGiRcs",
				item_type: "song",
				title: "American Idiot",
				duration: { text: "2:55", seconds: 175 },
			},
			{
				type: "MusicResponsiveListItem",
				id: "U0XcqF7rqHk",
				item_type: "song",
				title: "21 Guns",
				duration: { text: "5:21", seconds: 321 },
			},
			{
				type: "MusicResponsiveListItem",
				id: "Soa3gO7tL-c",
				item_type: "song",
				title: "Boulevard Of Broken Dreams",
				duration: { text: "4:20", seconds: 260 },
			},
		],
	};
	const items = withTopSongs(
		extractEntities(artistPage, (url) => url),
		extractEntities(playlist, (url) => url)
	);

	it("takes the playlist the songs shelf points at, not an album carousel", () => {
		expect(topSongsPlaylist(artistPage)).toBe("VLOLAK5uy_top_songs");
	});

	it("fills the length in by video id and appends the songs the shelf stopped short of", () => {
		expect(items.filter(isTrack).map((track) => [track.title, track.durationSeconds])).toEqual([
			["American Idiot", 175],
			["21 Guns", 321],
			["Boulevard Of Broken Dreams", 260],
		]);
	});

	it("appends nothing once the shelf already holds the limit", () => {
		const full = withTopSongs(
			extractEntities(artistPage, (url) => url),
			extractEntities(playlist, (url) => url),
			2
		);
		expect(full.filter(isTrack)).toHaveLength(2);
	});
});

describe("artist release shelves", () => {
	it("keeps Albums and Singles apart, each carrying the browse behind its own See all", () => {
		const sections = extractSections(
			{
				sections: [
					{
						type: "MusicShelf",
						title: { text: "Top songs" },
						contents: [
							{ type: "MusicResponsiveListItem", id: "vBBmyaGiRcs", item_type: "song", title: "American Idiot" },
						],
					},
					{
						type: "MusicCarouselShelf",
						header: {
							title: { text: "Albums" },
							more_content: {
								text: "More",
								endpoint: { payload: { browseId: "MPAD_green_day_albums", params: "opaque%3D" } },
							},
						},
						contents: [{ type: "MusicTwoRowItem", id: "MPREb_dookie", item_type: "album", title: "Dookie" }],
					},
					{
						type: "MusicCarouselShelf",
						header: {
							title: { text: "Singles" },
							more_content: { text: "More", endpoint: { payload: { browseId: "MPAD_green_day_singles" } } },
						},
						contents: [{ type: "MusicTwoRowItem", id: "MPREb_dilemma", item_type: "album", title: "Dilemma" }],
					},
				],
			},
			identity
		);
		expect(sections).toMatchObject([
			{ title: "Top songs", items: [{ id: "vBBmyaGiRcs" }] },
			{
				title: "Albums",
				items: [{ id: "MPREb_dookie" }],
				more: { browseId: "MPAD_green_day_albums", params: "opaque%3D" },
			},
			{ title: "Singles", items: [{ id: "MPREb_dilemma" }], more: { browseId: "MPAD_green_day_singles" } },
		]);
	});
});

describe("search top result", () => {
	/** Shaped like the card shelf a search opens with, above the ranked list. */
	const card = (payload: Record<string, unknown>, subtitle: unknown) => ({
		contents: [
			{
				type: "MusicCardShelf",
				title: { text: "Random Access Memories" },
				subtitle,
				thumbnail: { type: "MusicThumbnail", contents: [{ url: "https://example.test/ram.jpg" }] },
				on_tap: { type: "NavigationEndpoint", payload },
			},
			{ type: "MusicResponsiveListItem", id: "MPREb_ram", item_type: "album", title: "Random Access Memories" },
		],
	});
	const browse = (browseId: string, pageType: string) => ({
		browseId,
		browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
	});
	const subtitle = {
		text: "Album • Daft Punk",
		runs: [
			{ text: "Album" },
			{ text: " • " },
			{ text: "Daft Punk", endpoint: { payload: { browseId: "UC_daft_punk" } } },
		],
	};
	const top = (source: unknown) => withSearchTopResult(source, extractEntities(source, identity, true), identity);

	it("rebuilds the card upstream leaves without an id or an item type", () => {
		expect(top(card(browse("MPREb_ram", "MUSIC_PAGE_TYPE_ALBUM"), subtitle))[0]).toEqual({
			id: "MPREb_ram",
			title: "Random Access Memories",
			artists: [{ id: "UC_daft_punk", name: "Daft Punk" }],
			artworkUrl: "https://example.test/ram.jpg",
			explicit: undefined,
		});
	});

	it("keeps the listener count an artist card states beside its kind", () => {
		expect(
			top(card(browse("UC_caparezza", "MUSIC_PAGE_TYPE_ARTIST"), { text: "Artist • 806K monthly listeners" }))[0]
		).toMatchObject({ id: "UC_caparezza", listeners: "806K monthly listeners" });
	});

	it("does not leave the same result in the list twice", () => {
		expect(top(card(browse("MPREb_ram", "MUSIC_PAGE_TYPE_ALBUM"), subtitle))).toHaveLength(1);
	});

	it("keeps a watch card ahead of the different result underneath", () => {
		const items = top(
			card(
				{ videoId: "a5uQMwRMHcs" },
				{
					text: "Song • Daft Punk • 5:40",
					runs: [
						{ text: "Song" },
						{ text: " • " },
						{ text: "Daft Punk", endpoint: { payload: { browseId: "UC_daft_punk" } } },
						{ text: " • " },
						{ text: "5:40" },
					],
				}
			)
		);
		expect(items).toMatchObject([
			{
				id: "a5uQMwRMHcs",
				artists: [{ id: "UC_daft_punk", name: "Daft Punk" }],
				durationSeconds: 340,
			},
			{ id: "MPREb_ram" },
		]);
	});
});

describe("search preview", () => {
	it("uses the rich suggestion rows in YouTube Music's ranking and ignores text suggestions", async () => {
		const getSearchSuggestions = vi.fn().mockResolvedValue([
			{
				contents: [
					{ type: "SearchSuggestion", suggestion: "jodellavita" },
					{ id: "song-result", item_type: "song", title: "Jodellavitanonhocapitouncazzo" },
					{ id: "video-result", item_type: "video", title: "Jodellavita (Live)" },
				],
			},
		]);
		vi.mocked(Innertube.create).mockResolvedValueOnce({ music: { getSearchSuggestions } } as never);
		const adapter = new YouTubeAdapter(
			{ registerArtwork: identity } as never,
			join(tmpdir(), "nixie-cache-missing"),
			() => Promise.resolve("SID=first")
		);

		expect(await adapter.query({ type: "suggestions", query: "jodellavita" })).toMatchObject({
			items: [{ id: "song-result" }, { id: "video-result" }],
		});
		expect(getSearchSuggestions).toHaveBeenCalledWith("jodellavita");
	});
});

describe("session cookies", () => {
	it("builds a new session once the copied cookies rotate", async () => {
		const headers = ["SID=first", "SID=first", "SID=second"];
		const create = vi.mocked(Innertube.create);
		create.mockClear();
		const adapter = new YouTubeAdapter({} as never, join(tmpdir(), "nixie-cache-missing"), () =>
			Promise.resolve(headers.shift() ?? "")
		);
		await adapter.warm();
		await adapter.warm();
		await adapter.warm();
		expect(create).toHaveBeenCalledTimes(2);
		expect(create.mock.calls[1]?.[0]).toMatchObject({ cookie: "SID=second" });
	});
});

describe("account", () => {
	it("reads the selected channel and its largest photo", async () => {
		const accounts = [
			{
				is_selected: false,
				account_name: { text: "Other" },
				account_photo: [{ url: "https://example.test/other.jpg" }],
			},
			{
				is_selected: true,
				account_name: { text: "Listener" },
				account_photo: [{ url: "https://example.test/s88.jpg" }, { url: "https://example.test/s176.jpg" }],
			},
		];
		vi.mocked(Innertube.create).mockResolvedValueOnce({
			account: { getInfo: () => Promise.resolve(accounts) },
		} as never);
		const adapter = new YouTubeAdapter(
			{ registerArtwork: (url: string) => `nixie://app/artwork/${url}` } as never,
			join(tmpdir(), "nixie-cache-missing"),
			() => Promise.resolve("SID=first")
		);
		expect(await adapter.account()).toEqual({
			accountName: "Listener",
			avatarUrl: "nixie://app/artwork/https://example.test/s176.jpg",
		});
	});
});

describe("watch-next extraction", () => {
	/** A radio queue as the parser hands it back: `PlaylistPanelVideo`s, addressed by `video_id`. */
	const panel = {
		type: "PlaylistPanel",
		playlist_id: "RDAMVMzvC6jsZnicY",
		contents: [
			{
				type: "PlaylistPanelVideo",
				video_id: "zvC6jsZnicY",
				title: { text: "Vengo Dalla Luna" },
				duration: { text: "4:15", seconds: 255 },
				album: { id: "MPREb_2OsyiPiMOco", name: "Museica" },
				artists: [{ name: "Caparezza", channel_id: "UCGsv8l1sq32W1Xptp7ywaNA" }],
				thumbnail: [{ url: "https://lh3.googleusercontent.com/cover=w60-h60" }],
				badges: [{ type: "MusicInlineBadge", icon_type: "MUSIC_EXPLICIT_BADGE" }],
			},
			// A row that names its artists in one byline instead of listing them.
			{
				type: "PlaylistPanelVideo",
				video_id: "aaaaaaaaaaa",
				title: { text: "One More Time" },
				author: "Daft Punk",
				duration: { seconds: 320 },
			},
			// The same song again, and the endpoint that points at it: neither is a second row.
			{ type: "PlaylistPanelVideo", video_id: "zvC6jsZnicY", title: { text: "Vengo Dalla Luna" } },
			{ type: "NavigationEndpoint", payload: { videoId: "bbbbbbbbbbb" } },
			// The memo lists a wrapped row's video beside its song, before the wrapper that pairs them.
			{ type: "PlaylistPanelVideo", video_id: "ccccccccccc", title: { text: "Abiura Di Me" } },
			{ type: "PlaylistPanelVideo", video_id: "ddddddddddd", title: { text: "CAPAREZZA - ABIURA DI ME" } },
			{
				type: "PlaylistPanelVideoWrapper",
				primary: { type: "PlaylistPanelVideo", video_id: "ccccccccccc", title: { text: "Abiura Di Me" } },
				counterpart: [
					{ type: "PlaylistPanelVideo", video_id: "ddddddddddd", title: { text: "CAPAREZZA - ABIURA DI ME" } },
				],
			},
		],
	};

	it("reads a radio queue that `extractEntities` cannot see at all", () => {
		// The rows carry no `id` and no `item_type`, which is everything the other walk keys on.
		expect(extractEntities(panel, identity)).toHaveLength(0);

		const tracks = extractQueueTracks(panel, identity);
		expect(tracks).toHaveLength(3);
		expect(tracks[0]).toMatchObject({
			id: "zvC6jsZnicY",
			title: "Vengo Dalla Luna",
			durationSeconds: 255,
			artists: [{ id: "UCGsv8l1sq32W1Xptp7ywaNA", name: "Caparezza" }],
			album: { id: "MPREb_2OsyiPiMOco", title: "Museica" },
			explicit: true,
			artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
		});
		expect(tracks[1]).toMatchObject({ id: "aaaaaaaaaaa", artists: [{ id: "", name: "Daft Punk" }] });
		// The song a wrapper points at, and never the music video it offers to switch to.
		expect(tracks[2]).toMatchObject({ id: "ccccccccccc", title: "Abiura Di Me" });
	});

	/** The raw player overlay, the one node in a watch-next response that states the rating outright. */
	const overlay = (videoId: string, likeStatus: string) => ({
		playerOverlays: {
			playerOverlayRenderer: {
				actions: [
					{ likeButtonRenderer: { target: { videoId }, likeStatus, likesAllowed: true } },
					// The queue row beside it offers a like toggle and no dislike, which is why that is not
					// the source: it could never tell a disliked song from an unrated one.
					{
						toggleMenuServiceItemRenderer: {
							defaultIcon: { iconType: "FAVORITE" },
							defaultServiceEndpoint: { likeEndpoint: { status: "LIKE", target: { videoId } } },
						},
					},
				],
			},
		},
	});

	it("reads all three ratings off the player overlay", () => {
		expect(extractRating(overlay("zvC6jsZnicY", "LIKE"), "zvC6jsZnicY")).toBe("like");
		expect(extractRating(overlay("zvC6jsZnicY", "DISLIKE"), "zvC6jsZnicY")).toBe("dislike");
		expect(extractRating(overlay("zvC6jsZnicY", "INDIFFERENT"), "zvC6jsZnicY")).toBe("indifferent");
	});

	it("states nothing for a video the overlay is not about", () => {
		expect(extractRating(overlay("aaaaaaaaaaa", "LIKE"), "zvC6jsZnicY")).toBeUndefined();
		expect(extractRating({ contents: [] }, "zvC6jsZnicY")).toBeUndefined();
	});
});

describe("YouTube parser cache", () => {
	it("keeps newest files within its byte limit", async () => {
		const path = await mkdtemp(join(tmpdir(), "nixie-cache-"));
		paths.push(path);
		const oldFile = join(path, "old");
		const newFile = join(path, "new");
		await writeFile(oldFile, "old");
		await writeFile(newFile, "new");
		await utimes(oldFile, new Date(0), new Date(0));
		await pruneCache(path, 3);
		await expect(readFile(newFile, "utf8")).resolves.toBe("new");
		await expect(readFile(oldFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("library target", () => {
	it("strips the browse prefix a playlist is addressed by", () => {
		expect(libraryTarget("VLPLabc-123")).toBe("PLabc-123");
		expect(libraryTarget("PLabc-123")).toBe("PLabc-123");
	});

	it("reads an album's audio playlist off its canonical URL", () => {
		expect(libraryTarget("MPREb_album", "https://music.youtube.com/playlist?list=OLAK5uy_abc-123")).toBe(
			"OLAK5uy_abc-123"
		);
	});

	it("refuses an album whose page named no playlist", () => {
		expect(() => libraryTarget("MPREb_album", "https://music.youtube.com/browse/MPREb_album")).toThrow();
	});
});

describe("premium entitlement", () => {
	const format = (itag: number, audioQuality: string) => ({
		itag,
		mimeType: 'audio/mp4; codecs="mp4a.40.2"',
		audioQuality,
	});
	const response = (adaptiveFormats: unknown[]) => ({ streamingData: { adaptiveFormats } });

	it("reads a subscription off the 256 kbps tier a free account is never offered", () => {
		expect(readEntitlement(response([format(140, "AUDIO_QUALITY_MEDIUM"), format(141, "AUDIO_QUALITY_HIGH")]))).toBe(
			true
		);
	});

	it("reads no subscription when the account was offered the mediums and nothing above them", () => {
		expect(readEntitlement(response([format(140, "AUDIO_QUALITY_MEDIUM"), format(251, "AUDIO_QUALITY_MEDIUM")]))).toBe(
			false
		);
	});

	it("answers undefined rather than false whenever it was not really asked, since a caller locks on false", () => {
		// A request that failed, a response with no streaming data, an empty list, and a list holding
		// only the video track are all "no answer" and must never refuse a paying listener.
		expect(readEntitlement(undefined)).toBeUndefined();
		expect(readEntitlement({})).toBeUndefined();
		expect(readEntitlement(response([]))).toBeUndefined();
		expect(readEntitlement(response([{ itag: 137, mimeType: 'video/mp4; codecs="avc1"' }]))).toBeUndefined();
	});
});
