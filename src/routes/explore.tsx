import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ChartNoAxesColumnIncreasing, Compass, Disc3, Play, Shapes } from "lucide-react";
import { type ComponentType, type CSSProperties, type ReactNode, useEffect } from "react";
import { playCollection } from "#/components/entity-menu";
import {
	BrowseAction,
	BrowseLink,
	MediaGrid,
	MediaList,
	MediaShelf,
	RailControls,
	SectionHeader,
	ShelfSkeleton,
	useHorizontalRail,
} from "#/components/media";
import { Button, buttonVariants } from "#/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { heldFeeds, queryMusic } from "#/lib/api";
import { cn } from "#/lib/utils";
import { usePlayer } from "#/player";
import type { BrowseTarget, ExploreSection, MusicEntity, MusicSection, Page } from "#/shared/contracts";
import { entityArtwork, isAlbum, isArtist, isPlaylist, isTrack } from "#/shared/entities";
import { validateMusicQuery } from "#/shared/validation";

/**
 * The shortcut grid, keyed on the browse id it leads to rather than on its place in the row: upstream
 * reorders that grid and can add to it, and a positional list then hands charts the new releases
 * icon. Anything unrecognised is still a destination, so it gets the compass.
 */
const shortcutIcons: Record<string, ComponentType<{ className?: string }>> = {
	FEmusic_new_releases: Disc3,
	FEmusic_charts: ChartNoAxesColumnIncreasing,
	FEmusic_moods_and_genres: Shapes,
};

/** When the landing last came off the wire, and the age worth crossing the wire again for. */
let fetchedAt = 0;
const REFRESH_AFTER_MS = 5 * 60_000;

/**
 * The landing fetched while the reader was on another page, waiting for them to come back to it.
 *
 * Nothing revalidates a page the router already holds (see `router.tsx`), so the alternative is the
 * page the reader left standing until it is dropped, and then a skeleton that resolves into a feed
 * they never saw arrive: exactly the swap that rule exists to prevent, only deferred to the next
 * visit. So the refresh runs on the way out and lands here rather than in the cache, where it cannot
 * touch anything on screen, and it takes the held page out of the router's hands only once a whole
 * one is in its own: a refresh that answers with nothing, or does not answer at all, costs the reader
 * neither their page nor a skeleton. Only the landing is warmed, since a destination is a page asked
 * for by name and reached from here.
 *
 * It lives in `#/lib/api` beside the held mixes, so a session rebuilt for another region, another
 * Restricted Mode or another account drops every page the router does not hold in one call.
 */

/** Worth swapping the held landing for. An empty page is a failure that answered. */
const hasContent = (page: Page<MusicEntity>) => Boolean(page.explore?.sections.length || page.items.length);

export const Route = createFileRoute("/explore")({
	validateSearch: (search: Record<string, unknown>) => {
		const query = { type: "explore" as const, browseId: search.browseId, params: search.params };
		validateMusicQuery(query);
		return { browseId: query.browseId, params: query.params };
	},
	loaderDeps: ({ search: { browseId, params } }) => ({ browseId, params }),
	// No route below the root has an error boundary, so a rejection here would take the whole shell
	// down over one browse. An empty page renders the empty state instead.
	loader: async ({ deps }) => {
		if (deps.browseId) {
			return queryMusic({ type: "explore", browseId: deps.browseId, params: deps.params }).catch(
				(): Page<MusicEntity> => ({ items: [] })
			);
		}
		// A landing refreshed in the background is taken rather than asked for again, which is what
		// makes coming back both instant and current.
		const held = heldFeeds.explore;
		if (held) heldFeeds.explore = undefined;
		const page = held ?? (await queryMusic({ type: "explore" }).catch((): Page<MusicEntity> => ({ items: [] })));
		fetchedAt = Date.now();
		return page;
	},
	// No `pendingMs`: following a browse target is a navigation to another page, not a filter over the
	// one already on screen, so there is nothing worth holding still for.
	pendingComponent: ExplorePending,
	component: ExplorePage,
});

/**
 * The wash, the bleed and the title, shared by the real page, its fallback and its pending state, so
 * a degraded Explore is still the same page.
 *
 * The shell pads the outlet, so the wash is bled back out to both edges and the content padded back
 * in: inset to that padding it left a strip of bare background down either side.
 */
function ExploreFrame({
	title,
	wash,
	action,
	children,
}: {
	title: string;
	wash?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
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
				<div className="flex min-w-0 items-center gap-3">
					<h1 className="min-w-0 flex-1 truncate text-3xl font-bold tracking-tight">{title}</h1>
					{action}
				</div>
				{children}
			</div>
		</div>
	);
}

/**
 * Explore's own pending state. The global one is a grid, and this page is a title, tiles and rails,
 * so it would resolve into a layout nothing about it predicted. Every measurement here is the one
 * the real page uses, down to the card width, so nothing under the pointer moves on the swap.
 *
 * It takes the same fork the page does, off the search the pending match already states: a landing
 * leads with its shortcuts and its mood rail, and a destination has neither, so drawing one shape for
 * both puts three tiles and a rail in front of a reader who asked for a wrapping grid of albums.
 * ponytail: a destination is drawn as a grid even for charts, which resolves into lists. Nothing in
 * the search says which, and a grid is the nearer of the two.
 */
function ExplorePending() {
	const { browseId } = Route.useSearch();
	return (
		<div className="flex flex-col gap-10">
			<Skeleton className="h-9 w-48" />
			{browseId ? (
				<div className="flex flex-col gap-4">
					<Skeleton className="h-7 w-48" />
					<div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-6">
						{Array.from({ length: 12 }, (_, index) => (
							<div key={index} className="flex flex-col gap-3">
								<Skeleton className="aspect-square w-full rounded-lg" />
								<Skeleton className="h-4 w-3/4" />
								<Skeleton className="h-3 w-1/2" />
							</div>
						))}
					</div>
				</div>
			) : (
				<>
					<div className="grid gap-2 sm:grid-cols-3">
						{Array.from({ length: 3 }, (_, index) => (
							<Skeleton key={index} className="h-24 rounded-xl" />
						))}
					</div>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
						{Array.from({ length: 8 }, (_, index) => (
							<Skeleton key={index} className="h-28 rounded-xl" />
						))}
					</div>
					<ShelfSkeleton />
					<ShelfSkeleton />
				</>
			)}
		</div>
	);
}

function Shortcuts({ items }: { items: BrowseTarget[] }) {
	if (!items.length) return null;
	return (
		<nav className="grid gap-2 sm:grid-cols-3" aria-label="Explore shortcuts">
			{items.map((item) => {
				const Icon = shortcutIcons[item.browseId] ?? Compass;
				return (
					<BrowseLink
						key={`${item.browseId}-${item.params ?? ""}`}
						target={item}
						className={cn(
							buttonVariants({ variant: "secondary" }),
							"relative h-24 min-w-0 items-end justify-start overflow-hidden px-5 pb-4 text-base font-semibold transition-transform hover:-translate-y-0.5"
						)}
					>
						{/* The watermark bleeds off the right edge rather than sitting in the line: these are
						    navigation under the h1, not the loudest thing on the page. */}
						<Icon className="text-foreground/10 pointer-events-none absolute -right-3 -bottom-3 size-24" />
						<span className="truncate">{item.label}</span>
					</BrowseLink>
				);
			})}
		</nav>
	);
}

/**
 * Twelve hues far enough apart to be told from each other at one glance, rather than the whole wheel.
 * A hash spread across 360 lands two labels a degree apart about as often as not, and a shelf holding
 * "Classical" and "Rock" in two shades of the same blue reads as a bug rather than as two colours. A
 * palette this size repeats instead, and a repeat reads as a palette.
 */
const tileHues = [15, 45, 80, 110, 145, 175, 200, 225, 255, 285, 315, 345];

function genreHue(label: string) {
	let hash = 0;
	for (const char of label) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
	return tileHues[hash % tileHues.length] ?? tileHues[0];
}

/**
 * A mood or genre chip. Upstream paints its own and that colour never arrives: youtubei.js parses a
 * `MusicNavigationButton` down to its text and its endpoint, so the stripe is gone before the adapter
 * sees the node. The hue is picked off a hash of the label instead, which is also what keeps one genre
 * the same colour on the landing rail as on the moods page: the array index it used to be was a
 * different colour in each list. Lightness and chroma stay in the class rather than the hash, so every tile
 * carries the same weight and white stays legible on all of them, in either theme.
 */
function GenreTile({ target, compact = false }: { target: BrowseTarget; compact?: boolean }) {
	const engine = usePlayer();

	return (
		// The hue is set here rather than on the link because a custom property inherits, and this is
		// the element the play button already needs to sit against.
		<div className="group/card relative" style={{ "--tile-hue": genreHue(target.label) } as CSSProperties}>
			<BrowseLink
				target={target}
				className={cn(
					"relative flex items-end overflow-hidden rounded-xl bg-[oklch(0.62_0.15_var(--tile-hue))] p-4 transition-[transform,filter] hover:-translate-y-0.5 hover:brightness-110 dark:bg-[oklch(0.55_0.16_var(--tile-hue))]",
					compact ? "h-20" : "h-28"
				)}
			>
				{/* One darkening pass, so a label stays readable over the lighter hues. */}
				<span aria-hidden className="absolute inset-0 bg-gradient-to-b from-transparent to-black/35" />
				<span
					className={cn(
						"relative line-clamp-2 max-w-[85%] text-left leading-tight font-bold text-white",
						compact ? "text-base" : "text-lg"
					)}
				>
					{target.label}
				</span>
			</BrowseLink>
			{/* Playing it is the one thing the tile does beyond navigating, and only a playlist target can. */}
			{target.destination === "playlist" && (
				<Button
					size="icon"
					aria-label={`Play ${target.title}`}
					className="absolute right-3 bottom-3 rounded-full opacity-0 shadow-lg transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
					onClick={() => void playCollection(engine, { id: target.browseId, title: target.title })}
				>
					<Play fill="currentColor" />
				</Button>
			)}
		</div>
	);
}

function GenreGrid({
	section,
	compact,
}: {
	section: Extract<ExploreSection, { type: "navigation" }>;
	compact: boolean;
}) {
	return (
		<section className="flex flex-col gap-4">
			<SectionHeader title={section.title} action={<BrowseAction target={section.more} />} />
			<div
				className={cn(
					"grid gap-3",
					compact
						? "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
						: "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]"
				)}
			>
				{section.items.map((item, index) => (
					<GenreTile key={`${item.browseId}-${item.params ?? ""}-${index}`} target={item} compact={compact} />
				))}
			</div>
		</section>
	);
}

/** The landing's mood section, the one navigation list short enough to stay a two-row rail. */
function GenreRail({ section }: { section: Extract<ExploreSection, { type: "navigation" }> }) {
	const { rail, edges, updateEdges, scroll } = useHorizontalRail(section.items.length, section.layout);

	return (
		<section className="flex flex-col gap-4">
			<SectionHeader title={section.title} action={<BrowseAction target={section.more} />}>
				<RailControls title={section.title} edges={edges} onScroll={scroll} />
			</SectionHeader>
			<div
				ref={rail}
				onScroll={(event) => updateEdges(event.currentTarget)}
				className="-mx-1 grid snap-x grid-flow-col grid-rows-2 gap-3 overflow-x-auto px-1 pb-2"
				style={{ gridAutoColumns: "minmax(14rem, calc((100% - 3rem) / 4))" }}
			>
				{section.items.map((item, index) => (
					<GenreTile key={`${item.browseId}-${item.params ?? ""}-${index}`} target={item} />
				))}
			</div>
		</section>
	);
}

function LandingSection({ section }: { section: ExploreSection }) {
	if (section.type === "navigation")
		return section.layout === "moods" ? <GenreRail section={section} /> : <GenreGrid section={section} compact />;
	return (
		<MediaShelf
			title={section.title}
			strapline={section.strapline}
			artworkUrl={section.artworkUrl}
			itemsPerColumn={section.itemsPerColumn}
			items={section.items}
			context={{ type: "explore", title: section.title }}
			layout={section.layout}
			headerAction={<BrowseAction target={section.more} />}
		/>
	);
}

/**
 * A destination's whole job is showing the full list it was opened for, so nothing on it is a rail:
 * a page reached by asking for everything under a heading should not hide most of it off an edge.
 */
function DestinationSection({ section, pageTitle }: { section: ExploreSection; pageTitle: string }) {
	if (section.type === "navigation") return <GenreGrid section={section} compact={section.layout === "genres"} />;
	const context = { type: "explore" as const, title: section.title };
	// A destination's lead shelf can carry the page's own name: Charts is a shelf called "Charts"
	// under a header that says "Charts". The h1 above has already said it, so the shelf says it once.
	const heading = section.title === pageTitle ? undefined : section.title;
	return (
		<section className="flex flex-col gap-4">
			{heading ? (
				<SectionHeader
					title={heading}
					strapline={section.strapline}
					artworkUrl={section.artworkUrl}
					action={<BrowseAction target={section.more} />}
				/>
			) : (
				section.more && (
					<div className="flex justify-end">
						<BrowseAction target={section.more} />
					</div>
				)
			)}
			{section.layout === "ranked" ? (
				<MediaList items={section.items} context={context} ranked />
			) : (
				<MediaGrid items={section.items} context={context} />
			)}
		</section>
	);
}

/** The value a region option carries in the picker. Its browse is the whole of what it is. */
const regionKey = (region: BrowseTarget) => `${region.browseId}|${region.params ?? ""}`;

/**
 * A chart is per country, and each option is a browse of its own rather than a parameter of this one,
 * so switching region is a navigation like any other. Upstream states no label worth trusting for the
 * picker, so its accessible name is written here.
 */
function RegionPicker({ regions }: { regions: BrowseTarget[] }) {
	const navigate = useNavigate();
	// The option the page already answers, which upstream flags. A response that flags none is the
	// first one, since that is the region it fell back to.
	const current = regions.find((region) => region.selected) ?? regions[0];
	if (!current) return null;

	return (
		<Select
			value={regionKey(current)}
			onValueChange={(value) => {
				const next = regions.find((region) => regionKey(region) === value);
				if (next) void navigate({ to: "/explore", search: { browseId: next.browseId, params: next.params } });
			}}
		>
			<SelectTrigger size="sm" aria-label="Chart region">
				<SelectValue>{current.label}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{regions.map((region) => (
						<SelectItem key={regionKey(region)} value={regionKey(region)}>
							{region.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function ExplorePage() {
	const { browseId } = Route.useSearch();
	const { items, explore } = Route.useLoaderData();
	const router = useRouter();

	// The refresh runs on the way out, which is the only time a new landing can arrive without anything
	// moving on screen. Leaving is told from unmounting for another reason by where the router now is:
	// following a browse target is a search change on a page that stays put, and signing out takes the
	// shell down without going anywhere.
	useEffect(() => {
		if (browseId) return;
		return () => {
			if (router.state.location.pathname === "/explore" || Date.now() - fetchedAt < REFRESH_AFTER_MS) return;
			void queryMusic({ type: "explore" })
				.then((next) => {
					if (!hasContent(next)) return;
					heldFeeds.explore = next;
					fetchedAt = Date.now();
					// The page the router holds is what it would answer with, so it has to go for the loader
					// to run again and find the warm one. Only the landing is dropped: a destination is
					// cached under a browse id of its own and is not what was refreshed.
					router.clearCache({
						filter: (match) => match.routeId === "/explore" && !("browseId" in match.search && match.search.browseId),
					});
				})
				.catch(() => undefined);
		};
	}, [router, browseId]);

	if (!explore) return <ExploreFallback items={items} destination={Boolean(browseId)} />;

	const destination = Boolean(browseId);
	const sections = explore.sections;
	// The wash is the first cover the page shows, which is the closest thing a browse response has to
	// an identity. A page of nothing but genre tiles has none, and goes without.
	const lead = sections.find((section) => section.type === "media")?.items[0];
	// A destination names itself in the response's own header. A page that states none falls back to
	// its lead section, which then goes unheaded rather than printing the same words twice.
	const title = destination ? (explore.title ?? sections[0]?.title ?? "Explore") : "Explore";

	return (
		<ExploreFrame
			title={title}
			wash={lead && entityArtwork(lead)}
			action={explore.regions?.length ? <RegionPicker regions={explore.regions} /> : undefined}
		>
			{!destination && <Shortcuts items={explore.shortcuts} />}
			{sections.map((section, index) =>
				destination ? (
					<DestinationSection key={`${section.type}-${section.title}-${index}`} section={section} pageTitle={title} />
				) : (
					<LandingSection key={`${section.type}-${section.title}-${index}`} section={section} />
				)
			)}
			{!sections.length && (
				<p className="text-muted-foreground text-sm">YouTube Music has nothing to show here right now.</p>
			)}
		</ExploreFrame>
	);
}

/** What is left when the response carried no structure at all: the flat page, sorted by kind. */
function ExploreFallback({ items, destination }: { items: MusicEntity[]; destination: boolean }) {
	const shelves: MusicSection<MusicEntity>[] = [
		{ title: "New releases", items: items.filter(isAlbum) },
		{ title: "Charts", items: items.filter(isTrack) },
		{ title: "Playlists", items: items.filter(isPlaylist) },
		{ title: "Artists", items: items.filter(isArtist) },
	];
	return (
		<ExploreFrame title="Explore" wash={items[0] && entityArtwork(items[0])}>
			{items.length && !destination ? (
				shelves.map((shelf) => (
					<MediaShelf
						key={shelf.title}
						title={shelf.title}
						items={shelf.items}
						context={{ type: "explore", title: shelf.title }}
					/>
				))
			) : (
				<p className="text-muted-foreground text-sm">YouTube Music has nothing to show here right now.</p>
			)}
		</ExploreFrame>
	);
}
