/** The browsing pages: Home, Explore, search, the library and an artist. */
export const pages = {
	home: {
		empty: "Your YouTube Music home feed has nothing to show yet.",
		/** Completes the rail's scroll buttons' names. */
		filters: "filters",
	},
	explore: {
		title: "Explore",
		shortcuts: "Explore shortcuts",
		chartRegion: "Chart region",
		empty: "YouTube Music has nothing to show here right now.",
		newReleases: "New releases",
		charts: "Charts",
	},
	search: {
		title: "Search",
		resultsFor: (query: string) => `Results for ${query}`,
		all: "All",
		topResult: "Top result",
		fansMightAlsoLike: "Fans might also like",
		moreResults: "More results",
		noResults: "No results. Try fewer words or a different filter.",
		prompt: "Search YouTube Music for anything.",
		/**
		 * The shelf under the top result. `kind` says what the result is, `label` is the kind as the row
		 * names it (upstream's own for a release, "Single" or "EP"), which English reads lowercased.
		 */
		fromThis: (kind: "song" | "episode" | "album" | "artist" | "podcast" | "playlist", label: string) =>
			kind === "album" ? `From this ${label.toLowerCase()}` : `From this ${kind}`,
	},
	library: {
		title: "Library",
		all: "All",
		empty: "Nothing here yet.",
	},
	artist: {
		mix: "Mix",
		subscribe: "Subscribe",
		subscribed: "Subscribed",
		seeMore: "See more",
		seeLess: "See less",
		releases: "Releases",
	},
};
