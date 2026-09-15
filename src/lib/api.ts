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
const mixes = new Map<string, Held>();
const HOLD_LIMIT = 8;

type Held = { page: Promise<Page<MusicEntity>>; fetchedAt: number };

/**
 * An artist page, held briefly because `/search` asks for the top result's artist and opening that
 * artist asks again, which main answers with two browses (the page and its top songs playlist). The
 * router holds the page once `/artist/$id` has loaded, so this only covers the first open after a
 * search and a quick return after the router dropped it. Subscription state is not read off it: the
 * page reads `useHeld` from the library store, so a held page cannot show a stale subscription.
 */
const artists = new Map<string, Held>();
const ARTIST_MAX_AGE_MS = 5 * 60_000;

/**
 * The charts page, held for its region picker, which the settings page reads on every visit and which
 * does not change within a session. Empty or failed answers are not held.
 */
let regionsPage: Promise<Page<MusicEntity>> | undefined;

/**
 * The search dropdown's rows by trimmed query, read and written by `SearchField` in `app-shell.tsx`.
 * Held here so a region, a Restricted Mode or an account change forgets them with everything else,
 * since each of those answers the preview differently.
 */
export const heldSuggestions = new Map<string, { at: number; items: MusicEntity[] }>();

/**
 * The feeds `/` and `/explore` refresh on the way out, held here rather than in the router's cache so
 * the reader's own page cannot change under them. The routes own the mechanism, this module owns the
 * holding, so everything the router does not hold is dropped in one place.
 */
export const heldFeeds: { home?: Page<MusicEntity>; explore?: Page<MusicEntity> } = {};

/**
 * The auth answer every query checks first, asked once rather than per query. `auth:state` is not a
 * lookup: main re-reads the cookies, asks YouTube for the account and probes the entitlement, which is
 * two InnerTube round trips paid ahead of every page, preload, suggestion and scroll. `__root` sends
 * every change of status or account through `dropHeldPages`, which is what forgets it.
 */
let authState: Promise<boolean> | undefined;

/**
 * Everything answered under a session or an account that has since been replaced. `router.invalidate()`
 * reaches the pages the router holds, and these are the pages it does not: a region, a Restricted Mode
 * or a linked account is fixed when the InnerTube session is built, so a feed drawn under the old one
 * would be served to the next reader of a page that was just invalidated.
 */
export function dropHeldPages() {
	mixes.clear();
	artists.clear();
	regionsPage = undefined;
	heldSuggestions.clear();
	authState = undefined;
	heldFeeds.home = undefined;
	heldFeeds.explore = undefined;
}

/**
 * Auto-generated, and the browse id a card carries prefixes it again. Nothing else is drawn fresh.
 * `RDPN` is the exception: it is the newest episodes of every saved show, the same list on every ask
 * until a show publishes, so holding it would hide a new episode until the app restarts.
 */
const mixKey = (request: MusicQuery) =>
	request.type === "playlist" && !request.continuation && /^(?:VL)?RD(?!PN$)/.test(request.id) ? request.id : undefined;

/**
 * `fresh` skips that hold, and a walk through every page of a mix passes it: the held page carries
 * the continuation token its own walk spends, so a second walk from it would resume nothing.
 */
export async function queryMusic(request: MusicQuery, fresh = false): Promise<Page<MusicEntity>> {
	const bridge = window.nixie;
	if (!bridge) return { items: [] };
	// Route loaders still run while the sign-in gate is on screen, so an empty page
	// beats an upstream failure that would swap the gate for an error boundary.
	// A failed check is not an answer, so it is asked again by the next query rather than replayed.
	authState ??= bridge.auth.state().then(
		(auth) => auth.status === "authenticated",
		() => {
			authState = undefined;
			return false;
		}
	);
	if (!(await authState)) return { items: [] };
	if (fresh) return bridge.music.query(request);
	const mix = mixKey(request);
	if (mix) return hold(mixes, mix, Infinity, () => bridge.music.query(request));
	if (request.type === "artist" && !request.continuation)
		return hold(artists, request.id, ARTIST_MAX_AGE_MS, () => bridge.music.query(request));
	return bridge.music.query(request);
}

/**
 * The shared shape of every hold: capped at `HOLD_LIMIT` with the oldest out, an entry older than
 * `maxAge` asked for again, and a failed answer dropped rather than replayed at every later reader.
 */
function hold(held: Map<string, Held>, key: string, maxAge: number, fetch: () => Promise<Page<MusicEntity>>) {
	const entry = held.get(key);
	if (entry && Date.now() - entry.fetchedAt < maxAge) return entry.page;
	const page = fetch().catch((error: unknown) => {
		if (held.get(key)?.page === page) held.delete(key);
		throw error;
	});
	// Deleted first so a refetched key moves to the back of the insertion order.
	held.delete(key);
	held.set(key, { page, fetchedAt: Date.now() });
	const oldest = held.keys().next().value;
	if (held.size > HOLD_LIMIT && oldest) held.delete(oldest);
	return page;
}

/** The charts page for its region list, asked once per session and again only after a failed or empty answer. */
export function queryRegions(): Promise<Page<MusicEntity>> {
	const page = (regionsPage ??= queryMusic({ type: "explore", browseId: "FEmusic_charts" }).then(
		(answer) => {
			if (!answer.explore?.regions?.length && regionsPage === page) regionsPage = undefined;
			return answer;
		},
		(error: unknown) => {
			if (regionsPage === page) regionsPage = undefined;
			throw error;
		}
	));
	return page;
}

/** Most recent first, deduplicated, capped where the store caps it anyway. */
export async function rememberSearch(query: string) {
	const bridge = window.nixie;
	if (!query || !bridge) return;
	const stored = await bridge.local.load();
	await bridge.local.save({
		...stored,
		recentSearches: [query, ...stored.recentSearches.filter((item) => item !== query)].slice(0, 8),
	});
}
