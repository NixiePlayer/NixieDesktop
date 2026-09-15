/** A page a write can have outdated: the library, or one playlist named by either form of its id. */
export type OutdatedPage = { routeId: "/library" } | { routeId: "/playlist/$id"; id: string };

/** A browse id carries a `VL` the playlist's own id does not (`VLLM` and `LM` are one playlist). */
const playlistKey = (id: string) => id.replace(/^VL/, "");

/**
 * Invalidate only the matches a write can have changed. A bare `router.invalidate()` after saving a
 * song dropped Home, Explore, search and every album and artist too, so each of them came back as a
 * skeleton and a refetch for something the save never touched. Session and account changes still
 * invalidate everything, since those outdate every answer rather than one page.
 *
 * The router is imported when a write lands rather than at module scope: `#/router` imports the whole
 * route tree, and a static import of it from a component or a store pulled every code-split route
 * into the entry chunk, more than doubling it.
 */
export async function invalidatePages(...pages: OutdatedPage[]) {
	const { router } = await import("#/router");
	return router.invalidate({
		filter: (match) =>
			pages.some((page) =>
				page.routeId === "/playlist/$id"
					? match.routeId === page.routeId && playlistKey(match.params.id) === playlistKey(page.id)
					: match.routeId === page.routeId
			),
	});
}
