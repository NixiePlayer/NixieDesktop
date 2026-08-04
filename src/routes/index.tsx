import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Artwork,
	BrowseAction,
	CollectionPlayButton,
	entityRoute,
	MediaShelf,
	RailControls,
	TrackLink,
	useHorizontalRail,
} from "#/components/media";
import { Button, buttonVariants } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { heldFeeds, queryMusic } from "#/lib/api";
import { cn } from "#/lib/utils";
import { usePlayer } from "#/player";
import type { FeedFilter, MusicEntity, Page, QueueContext, Track } from "#/shared/contracts";
import {
	appendPage,
	entityArtwork,
	entityKind,
	entitySubtitle,
	entityTitle,
	type GrownFeed,
	homeShelves,
	isAlbum,
	isArtist,
	isPlaylist,
	isPlaylistItem,
	isTrack,
	toTracks,
} from "#/shared/entities";
import { validateMusicQuery } from "#/shared/validation";

/**
 * The chips of the last feed that answered. The router keys a match on its loader deps, so tapping a
 * chip is a whole new match that suspends the page, and a pending component is handed no data to
 * draw the row it was just tapped in. Holding them here is what lets the row survive the fetch.
 */
let lastFilters: FeedFilter[] | undefined;

/** When the feed last came off the wire, and the age worth crossing the wire again for. */
let fetchedAt = 0;
const REFRESH_AFTER_MS = 5 * 60_000;

/**
 * A feed fetched while the reader was on another page, waiting for them to come back to it.
 *
 * Nothing revalidates a page the router already holds (see `router.tsx`), because a loader writes
 * into the live match and the reader watches the shelves change under their pointer. So the refresh
 * lands here instead of in the cache, where it cannot touch anything on screen, and it takes the
 * held page out of the router's hands only once a whole feed is in its own: a refresh that answers
 * with nothing, or does not answer at all, costs the reader neither their feed nor a skeleton.
 *
 * It lives in `#/lib/api` beside the held mixes, so a session rebuilt for another region, another
 * Restricted Mode or another account drops every page the router does not hold in one call.
 */

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>) => {
		// The chip is a token main minted, meaningless anywhere else, so the same validator guards it
		// on both sides of the bridge. A token from a previous run degrades to the unfiltered feed.
		const query = { type: "home" as const, filter: search.chip };
		validateMusicQuery(query);
		return { chip: query.filter };
	},
	loaderDeps: ({ search: { chip } }) => ({ chip }),
	// No route below the root has an error boundary, so a rejection here would take the whole shell
	// down over a feed. An empty page renders the empty state instead.
	loader: async ({ deps }) => {
		// A feed refreshed in the background is taken rather than asked for again, which is what makes
		// coming back both instant and current. Only the unfiltered feed is ever refreshed: it is the
		// one the rail returns to, since its link carries no chip.
		const held = deps.chip ? undefined : heldFeeds.home;
		if (held) heldFeeds.home = undefined;
		const page =
			held ?? (await queryMusic({ type: "home", filter: deps.chip }).catch((): Page<MusicEntity> => ({ items: [] })));
		// Held for the pending state, which is a match of its own and so has no loader data at all.
		if (page.filters?.length) lastFilters = page.filters;
		fetchedAt = Date.now();
		return page;
	},
	// Tapping a chip is a filter, not a navigation: at the global 0ms a cached feed still blinks the
	// shelves under the row out and back before it arrives.
	pendingMs: 150,
	pendingComponent: HomePending,
	component: HomePage,
});

/**
 * One tile of the lead shelf. A tile opens what it names, exactly as a card or a row does: a song goes
 * to the release it came from and only the play button starts it, since a shelf mixes songs, albums
 * and playlists and a tile that plays on click while its neighbour navigates is two controls wearing
 * one shape. The line under the title states which of them it is, for the same reason a mixed row does.
 */
function QuickTile({ item, queue, context }: { item: MusicEntity; queue: Track[]; context: QueueContext }) {
	const engine = usePlayer();
	const kind = entityKind(item);
	// An artist is only ever itself, and "Artist • Artist" is what naming it twice reads as.
	const subtitle = entitySubtitle(item);
	const content = (
		<>
			<Artwork
				src={entityArtwork(item)}
				round={isArtist(item)}
				className={cn("size-14", isArtist(item) ? "m-2 size-10" : "rounded-none")}
			/>
			<span className="flex min-w-0 flex-col px-3 text-left">
				<span className="truncate text-sm font-semibold">{entityTitle(item)}</span>
				<span className="text-muted-foreground truncate text-xs">
					{subtitle && subtitle !== kind ? `${kind} • ${subtitle}` : kind}
				</span>
			</span>
		</>
	);
	const className = cn(
		buttonVariants({ variant: "secondary" }),
		"h-14 w-full justify-start gap-0 overflow-hidden p-0 pr-3"
	);
	const playButton =
		"absolute top-3 left-3 size-8 rounded-full opacity-0 shadow-lg transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100";

	// Upstream names no release for some songs, and `TrackLink` renders one of those as plain text
	// rather than as a link to nowhere. The play button still plays it.
	const songTile = (track: Track) => (
		<div className="group/tile relative">
			<TrackLink track={track} className={className}>
				{content}
			</TrackLink>
			<Button
				size="icon"
				aria-label={`Play ${entityTitle(item)}`}
				className={playButton}
				onClick={() => void engine.play(track, queue, context)}
			>
				<Play fill="currentColor" />
			</Button>
		</div>
	);
	if (isPlaylistItem(item)) return songTile(item.track);
	if (isTrack(item)) return songTile(item);

	return (
		<div className="group/tile relative">
			<Link to={entityRoute(item)} params={{ id: item.id }} className={className}>
				{content}
			</Link>
			{(isAlbum(item) || isPlaylist(item)) && <CollectionPlayButton collection={item} className={playButton} />}
		</div>
	);
}

function HomeChips({ filters, selected }: { filters: FeedFilter[]; selected?: string }) {
	const { rail, edges, updateEdges, scroll } = useHorizontalRail(filters.length, selected ?? "");
	if (!filters.length) return null;
	return (
		<div className="flex items-center gap-2">
			<div
				ref={rail}
				onScroll={(event) => updateEdges(event.currentTarget)}
				className="-mx-1 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto px-1 py-1"
			>
				{filters.map((filter) => {
					// The chip a filtered feed already answers has no token of its own, so it is the one
					// that clears back to the unfiltered feed.
					const active = filter.selected || (filter.token !== undefined && filter.token === selected);
					return (
						<Link
							key={filter.label}
							to="/"
							search={{ chip: active ? undefined : filter.token }}
							replace
							// Every chip is a whole feed, so preloading on hover browses upstream once per
							// chip the pointer crosses.
							preload={false}
							aria-current={active ? "true" : undefined}
							className={cn(
								buttonVariants({ variant: active ? "default" : "secondary", size: "sm" }),
								"shrink-0 snap-start rounded-full px-4"
							)}
						>
							{filter.label}
						</Link>
					);
				})}
			</div>
			<RailControls title="filters" edges={edges} onScroll={scroll} />
		</div>
	);
}

function HomeShelfSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-7 w-48" />
			<div className="flex gap-4 overflow-hidden">
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="flex w-[calc((100%_-_5rem)/6)] min-w-40 shrink-0 flex-col gap-3">
						<Skeleton className="aspect-square w-full rounded-lg" />
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Home's own pending state. The global one is a grid, and this page is rails, so it would resolve
 * into a layout nothing about it predicted.
 *
 * The chips row is the one part of it that is not a skeleton: replacing what the reader just tapped
 * with a placeholder of itself reads as the tap having thrown the filter away, and it leaves nowhere
 * to tap next until the feed lands. So the held row is rendered live, already lit on the chip being
 * fetched, which the pending match's own search states. Their `selected` flag is dropped because it
 * belongs to the feed being replaced, and it is what the row falls back to once nothing is being
 * filtered at all. Only the first arrival has no row to hold, and there the chip widths vary because
 * seven identical pills read as a broken progress bar rather than as chips.
 */
function HomePending() {
	const { chip } = Route.useSearch();
	return (
		<div className="flex flex-col gap-10">
			{lastFilters ? (
				<HomeChips filters={lastFilters.map((filter) => ({ ...filter, selected: false }))} selected={chip} />
			) : (
				<div className="flex gap-2">
					{Array.from({ length: 7 }, (_, index) => (
						<Skeleton key={index} className={cn("h-8 rounded-full", index % 3 === 0 ? "w-28" : "w-20")} />
					))}
				</div>
			)}
			<div className="flex flex-col gap-5">
				<div className="flex items-center gap-3">
					<Skeleton className="size-12 rounded-full" />
					<Skeleton className="h-8 w-64" />
				</div>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 6 }, (_, index) => (
						<Skeleton key={index} className="h-14 rounded-md" />
					))}
				</div>
			</div>
			<HomeShelfSkeleton />
			<HomeShelfSkeleton />
		</div>
	);
}

function HomePage() {
	const page = Route.useLoaderData();
	const { chip } = Route.useSearch();
	const router = useRouter();
	const key = chip ?? "";
	const [grown, setGrown] = useState<GrownFeed>();
	const [loading, setLoading] = useState(false);
	const inFlight = useRef(false);
	const sentinel = useRef<HTMLDivElement>(null);

	// Derived, not reset in an effect: `/` takes no params, so a chip change never remounts the route,
	// and on a cache hit there is no pending phase either. Without this the pages grown under one chip
	// would render under the next one.
	const feed = grown?.key === key ? grown : undefined;
	const available = [...homeShelves(page, true), ...(feed?.shelves ?? [])];
	const next = feed ? feed.next : page.continuation;
	const first = available[0];
	const promoted = first?.items.slice(0, 6) ?? [];
	const wash = promoted[0] && entityArtwork(promoted[0]);

	// The refresh runs on the way out, which is the only time a new feed can arrive without anything
	// moving on screen. Leaving is told from unmounting for another reason by where the router now is:
	// signing out takes the shell down without going anywhere, and a chip is a search change on a page
	// that stays put.
	useEffect(
		() => () => {
			if (router.state.location.pathname === "/" || Date.now() - fetchedAt < REFRESH_AFTER_MS) return;
			void queryMusic({ type: "home" })
				.then((next) => {
					if (!homeShelves(next, true).length) return;
					heldFeeds.home = next;
					fetchedAt = Date.now();
					// The page the router holds is what it would answer with, so it has to go for the loader
					// to run again and find the warm one. Only cached pages are dropped, never a live match.
					router.clearCache({ filter: (match) => match.routeId === "/" });
				})
				.catch(() => undefined);
		},
		[router]
	);

	useEffect(() => {
		const target = sentinel.current;
		const root = document.getElementById("main-scrollable-area");
		if (!target || !root || !next) return;
		const load = async () => {
			// A ref, not state: the observer can deliver a second crossing before React commits, and
			// the token behind a page is spent by the request that reads it.
			if (inFlight.current) return;
			inFlight.current = true;
			setLoading(true);
			const more = await queryMusic({ type: "home", continuation: next }).catch(() => undefined);
			setGrown((state) => appendPage(state, key, more));
			inFlight.current = false;
			setLoading(false);
		};
		// The scroll container is the shell's main element, not the viewport, which also holds the top
		// bar and the player bar and so measures a margin from the wrong edges.
		const observer = new IntersectionObserver(
			(entries) => entries.some((entry) => entry.isIntersecting) && void load(),
			{
				root,
				rootMargin: "800px 0px",
			}
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [next, key]);

	if (!first)
		return <p className="text-muted-foreground text-sm">Your YouTube Music home feed has nothing to show yet.</p>;

	const firstQueue = toTracks(first.items);
	const firstContext = { type: "home" as const, title: first.title };

	return (
		// The shell pads the outlet, so the wash is bled back out to both edges and the content padded
		// back in: inset to that padding it left a strip of bare background down either side.
		<div className="relative isolate -mx-6 -mt-6 overflow-hidden px-6 pt-6">
			{wash && (
				<img
					src={wash}
					alt=""
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 h-72 w-full [mask-image:linear-gradient(to_bottom,black,transparent)] object-cover opacity-20 blur-3xl"
				/>
			)}
			<div className="relative flex flex-col gap-10">
				{page.filters?.length ? <HomeChips filters={page.filters} selected={chip} /> : null}
				<section className="flex flex-col gap-5">
					<header className="flex min-w-0 items-center gap-3">
						{first.artworkUrl && <Artwork src={first.artworkUrl} round className="size-12" />}
						<div className="min-w-0 flex-1">
							{first.strapline && (
								<p className="text-muted-foreground truncate text-sm font-medium">{first.strapline}</p>
							)}
							<h1 className="truncate text-3xl font-bold tracking-tight">{first.title}</h1>
						</div>
						{/* The first shelf renders without a header of its own, so this is where its More lives. */}
						<BrowseAction target={first.more} />
					</header>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{promoted.map((item, index) => (
							<QuickTile
								key={`${"track" in item ? item.itemId : item.id}-${index}`}
								item={item}
								queue={firstQueue}
								context={firstContext}
							/>
						))}
					</div>
				</section>

				<div className="flex flex-col gap-10">
					{available.map((section, index) => (
						<MediaShelf
							key={`${section.title}-${index}`}
							title={section.title}
							strapline={section.strapline}
							artworkUrl={section.artworkUrl}
							itemsPerColumn={section.itemsPerColumn}
							layout={section.layout}
							items={index === 0 ? section.items.slice(promoted.length) : section.items}
							queue={toTracks(section.items)}
							context={{ type: "home", title: section.title }}
							showHeader={index !== 0}
							headerAction={<BrowseAction target={section.more} />}
						/>
					))}
					{loading && <HomeShelfSkeleton />}
					{next && <div ref={sentinel} aria-hidden className="h-px" />}
				</div>
			</div>
		</div>
	);
}
