import type { MusicEntity, MusicQuery, Page } from "#/shared/contracts";

/**
 * One draw of a mix, shared by everything that asks for it. A playlist nobody made ("Mix • Pop punk",
 * "Radio • Pop punk", every `RD` id) is generated per request: upstream answers the same id with a
 * different hundred songs every time it is asked. So pressing play on a search result and then
 * opening it listed two unrelated playlists under one name, and neither was wrong. Whoever asks
 * first decides what the mix is, and everyone after reads that same page rather than drawing
 * another one, which also means the second reader pays no round trip at all.
 *
 * Only the auto-generated ones are held. Every other list answers the same rows twice, and one the
 * account can edit has to be refetched after an edit.
 * ponytail: capped rather than expiring. A mix is one list for as long as the app is open, which is
 * the point; give it a clock if a session ever runs long enough for that to read as stale.
 */
const mixes = new Map<string, Promise<Page<MusicEntity>>>();
const MIX_LIMIT = 8;

/**
 * The feeds `/` and `/explore` refresh on the way out, held here rather than in the router's cache so
 * the reader's own page cannot change under them. The routes own the mechanism, this module owns the
 * holding, so everything the router does not hold is dropped in one place.
 */
export const heldFeeds: { home?: Page<MusicEntity>; explore?: Page<MusicEntity> } = {};

/**
 * Everything answered under a session or an account that has since been replaced. `router.invalidate()`
 * reaches the pages the router holds, and these are the pages it does not: a region, a Restricted Mode
 * or a linked account is fixed when the InnerTube session is built, so a feed drawn under the old one
 * would be served to the next reader of a page that was just invalidated.
 */
export function dropHeldPages() {
	mixes.clear();
	heldFeeds.home = undefined;
	heldFeeds.explore = undefined;
}

/** Auto-generated, and the browse id a card carries prefixes it again. Nothing else is drawn fresh. */
const mixKey = (request: MusicQuery) =>
	request.type === "playlist" && !request.continuation && /^(?:VL)?RD/.test(request.id) ? request.id : undefined;

/**
 * `fresh` skips that hold, and a walk through every page of a mix passes it: the held page carries
 * the continuation token its own walk spends, so a second walk from it would resume nothing.
 */
export async function queryMusic(request: MusicQuery, fresh = false): Promise<Page<MusicEntity>> {
	const bridge = window.noctune;
	if (!bridge) return { items: [] };
	// Route loaders still run while the sign-in gate is on screen, so an empty page
	// beats an upstream failure that would swap the gate for an error boundary.
	const auth = await bridge.auth.state();
	if (auth.status !== "authenticated") return { items: [] };
	const key = fresh ? undefined : mixKey(request);
	if (!key) return bridge.music.query(request);
	let held = mixes.get(key);
	if (!held) {
		// A failed draw is not the mix, so it is dropped rather than replayed at every later reader.
		held = bridge.music.query(request).catch((error: unknown) => {
			mixes.delete(key);
			throw error;
		});
		mixes.set(key, held);
		const oldest = mixes.keys().next().value;
		if (mixes.size > MIX_LIMIT && oldest) mixes.delete(oldest);
	}
	return held;
}

/** Most recent first, deduplicated, capped where the store caps it anyway. */
export async function rememberSearch(query: string) {
	const bridge = window.noctune;
	if (!query || !bridge) return;
	const stored = await bridge.local.load();
	await bridge.local.save({
		...stored,
		recentSearches: [query, ...stored.recentSearches.filter((item) => item !== query)].slice(0, 8),
	});
}
