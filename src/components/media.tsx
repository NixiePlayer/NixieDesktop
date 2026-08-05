import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Music, Play, ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { expandPlays, formatDuration } from "#/lib/format";
import { nextRating, rate, useRating } from "#/lib/rating";
import { cn } from "#/lib/utils";
import { usePlayback, usePlayer } from "#/player";
import type { Album, Artist, BrowseTarget, MusicEntity, Playlist, QueueContext, Track } from "#/shared/contracts";
import {
	entityArtwork,
	entityKind,
	entityRank,
	entitySubtitle,
	entityTitle,
	isAlbum,
	isArtist,
	isPlaylist,
	isPlaylistItem,
	isTrack,
	trackAlbumId,
	toTracks,
} from "#/shared/entities";
import { EntityContextMenu, playCollection, TrackMenu } from "./entity-menu";
import { Button, buttonVariants } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export function Artwork({
	src,
	alt = "",
	round = false,
	className,
}: {
	src?: string;
	alt?: string;
	round?: boolean;
	className?: string;
}) {
	// A queue restored from disk carries artwork ids from a session that is gone, and a signed CDN
	// URL expires on its own, so a failed image falls back to the placeholder instead of the broken
	// icon. Holding the src that failed resets the fallback when the card is reused for another one.
	const [failed, setFailed] = useState<string>();

	return (
		<div
			className={cn(
				"relative flex aspect-square shrink-0 items-center justify-center overflow-hidden bg-muted",
				round ? "rounded-full" : "rounded-lg",
				className
			)}
		>
			{src && failed !== src ? (
				<img src={src} alt={alt} loading="lazy" className="size-full object-cover" onError={() => setFailed(src)} />
			) : (
				<Music className="text-muted-foreground/40 size-1/3" aria-hidden />
			)}
		</div>
	);
}

/** Parental advisory, as the square every other player prints beside the title. */
export function ExplicitBadge() {
	return (
		<span
			className="bg-muted-foreground/20 text-muted-foreground shrink-0 rounded-[3px] px-1 text-[10px] leading-4 font-semibold"
			title="Explicit"
			aria-label="Explicit"
		>
			E
		</span>
	);
}

/** Now-playing indicator. Three bars beat "Playing" text and take a quarter of the room. */
export function PlayingBars({ paused = false }: { paused?: boolean }) {
	return (
		<span className="flex h-3.5 items-end gap-[2px]" role="img" aria-label={paused ? "Paused" : "Now playing"}>
			{[0, 0.3, 0.15].map((delay, index) => (
				<span
					key={index}
					className={cn("w-[2px] bg-primary", !paused && "equalizer-bar")}
					style={{ height: "100%", animationDelay: `${delay}s` }}
				/>
			))}
		</span>
	);
}

/**
 * The artists a row names, each linking to its own page. Upstream leaves the id empty for a name it
 * did not link, and an empty id addresses nothing, so that one stays plain text. The click is stopped
 * because these sit inside rows that play on click.
 */
export function ArtistLinks({ artists }: { artists: Artist[] }) {
	return artists.map((artist, index) => (
		<Fragment key={`${artist.id}-${index}`}>
			{index > 0 && ", "}
			{artist.id ? (
				<Link
					to="/artist/$id"
					params={{ id: artist.id }}
					className="hover:text-foreground hover:underline"
					onClick={(event) => event.stopPropagation()}
				>
					{artist.name}
				</Link>
			) : (
				artist.name
			)}
		</Fragment>
	));
}

export function entityRoute(item: MusicEntity) {
	if (isAlbum(item)) return "/album/$id" as const;
	if (isArtist(item)) return "/artist/$id" as const;
	return "/playlist/$id" as const;
}

/**
 * The artists a card or a row names, when it names any. A song carries its own, and so does a
 * release, which is why the link to that release can never wrap the whole card: an anchor inside an
 * anchor is neither valid nor reachable, and an artist name is a link everywhere else in the app.
 */
function entityArtists(item: MusicEntity): Artist[] | undefined {
	if (isPlaylistItem(item)) return item.track.artists;
	if (isTrack(item) || isAlbum(item)) return item.artists;
	return undefined;
}

export function TrackLink({
	track,
	className,
	children = track.title,
}: {
	track: Track;
	className?: string;
	children?: React.ReactNode;
}) {
	const id = trackAlbumId(track);
	if (!id) return <span className={className}>{children}</span>;
	return (
		<Link to="/album/$id" params={{ id }} className={className} onClick={(event) => event.stopPropagation()}>
			{children}
		</Link>
	);
}

export function CollectionPlayButton({ collection, className }: { collection: Album | Playlist; className?: string }) {
	const engine = usePlayer();

	return (
		<Button
			size="icon"
			aria-label={`Play ${entityTitle(collection)}`}
			className={className}
			onClick={() => void playCollection(engine, collection)}
		>
			<Play fill="currentColor" />
		</Button>
	);
}

/** Links `children` to the page the entity has, when it has one. */
function EntityLink({
	item,
	className,
	children,
}: {
	item: MusicEntity;
	className?: string;
	children: React.ReactNode;
}) {
	if (isPlaylistItem(item))
		return (
			<TrackLink track={item.track} className={className}>
				{children}
			</TrackLink>
		);
	if (isTrack(item))
		return (
			<TrackLink track={item} className={className}>
				{children}
			</TrackLink>
		);
	return (
		<Link
			to={entityRoute(item)}
			params={{ id: item.id }}
			className={cn("focus-visible:ring-ring/50 rounded-lg focus-visible:ring-3 focus-visible:outline-none", className)}
		>
			{children}
		</Link>
	);
}

export function MediaCard({
	item,
	queue,
	context,
	className,
	downloaded,
}: {
	item: MusicEntity;
	queue?: Track[];
	context?: QueueContext;
	className?: string;
	downloaded?: boolean;
}) {
	const engine = usePlayer();
	const round = isArtist(item);
	const title = entityTitle(item);
	const artists = entityArtists(item);
	const image = (
		<Artwork
			src={entityArtwork(item)}
			round={round}
			className="w-full transition-transform duration-150 group-hover/card:scale-[1.02]"
		/>
	);
	const artwork = (
		<div className="relative">
			{isTrack(item) ? image : <EntityLink item={item}>{image}</EntityLink>}
			{isTrack(item) && (
				<Button
					size="icon"
					aria-label={`Play ${title}`}
					className="absolute right-2 bottom-2 rounded-full opacity-0 shadow-lg transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
					onClick={() => void engine.play(item, queue ?? [item], context)}
				>
					<Play fill="currentColor" />
				</Button>
			)}
			{(isAlbum(item) || isPlaylist(item)) && (
				<CollectionPlayButton
					collection={item}
					className="absolute right-2 bottom-2 rounded-full opacity-0 shadow-lg transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
				/>
			)}
		</div>
	);

	return (
		<EntityContextMenu
			item={item}
			downloaded={downloaded}
			render={<div className={cn("group/card flex flex-col gap-3", className)} />}
		>
			{artwork}
			<div className={cn("flex flex-col gap-0.5", round && "items-center text-center")}>
				<EntityLink item={item} className="hover:underline">
					<span className="line-clamp-2 text-sm font-medium">{title}</span>
				</EntityLink>
				<span className="text-muted-foreground line-clamp-1 text-xs">
					{artists?.length ? <ArtistLinks artists={artists} /> : entitySubtitle(item)}
				</span>
			</div>
		</EntityContextMenu>
	);
}

export interface RailEdges {
	overflow: boolean;
	start: boolean;
	end: boolean;
}

export function useHorizontalRail(itemCount: number, layoutKey = "") {
	const rail = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState<RailEdges>({ overflow: false, start: true, end: true });
	const updateEdges = useCallback((element: HTMLDivElement) => {
		const next = {
			overflow: element.scrollWidth > element.clientWidth + 1,
			start: element.scrollLeft <= 1,
			end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
		};
		setEdges((current) =>
			current.overflow === next.overflow && current.start === next.start && current.end === next.end ? current : next
		);
	}, []);

	useEffect(() => {
		const element = rail.current;
		if (!element) return;
		updateEdges(element);
		const observer = new ResizeObserver(() => updateEdges(element));
		observer.observe(element);
		return () => observer.disconnect();
	}, [itemCount, layoutKey, updateEdges]);

	return {
		rail,
		edges,
		updateEdges,
		scroll: (direction: -1 | 1) => {
			if (rail.current) rail.current.scrollBy({ left: direction * rail.current.clientWidth * 0.85 });
		},
	};
}

export function RailControls({
	title,
	edges,
	onScroll,
}: {
	title: string;
	edges: RailEdges;
	onScroll: (direction: -1 | 1) => void;
}) {
	if (!edges.overflow) return null;
	return (
		<div className="flex gap-1">
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Scroll ${title} backward`}
				disabled={edges.start}
				onClick={() => onScroll(-1)}
			>
				<ChevronLeft />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={`Scroll ${title} forward`}
				disabled={edges.end}
				onClick={() => onScroll(1)}
			>
				<ChevronRight />
			</Button>
		</div>
	);
}

/**
 * Where a shelf's own "More" leads. A playlist target opens the playlist page, and everything else is
 * a browse id Explore renders, which is the only page that takes an arbitrary one.
 */
export function BrowseLink({
	target,
	className,
	children,
}: {
	target: BrowseTarget;
	className?: string;
	children: ReactNode;
}) {
	if (target.destination === "playlist") {
		return (
			<Link
				to="/playlist/$id"
				params={{ id: target.browseId }}
				search={{ find: undefined }}
				className={className}
				title={target.title}
			>
				{children}
			</Link>
		);
	}
	return (
		<Link
			to="/explore"
			search={{ browseId: target.browseId, params: target.params }}
			className={className}
			title={target.title}
		>
			{children}
		</Link>
	);
}

export function BrowseAction({ target }: { target?: BrowseTarget }) {
	if (!target) return null;
	return (
		<BrowseLink target={target} className={buttonVariants({ variant: "outline", size: "sm" })}>
			{target.label}
		</BrowseLink>
	);
}

/**
 * The line above a shelf, a grid or a list. One component so a page whose sections are grids rather
 * than rails still names them exactly the way a rail does. `children` is the trailing slot, which is
 * where a rail puts its own controls.
 */
export function SectionHeader({
	title,
	strapline,
	artworkUrl,
	action,
	children,
}: {
	title: string;
	strapline?: string;
	artworkUrl?: string;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="flex min-w-0 items-end gap-3">
			{artworkUrl && <Artwork src={artworkUrl} round className="size-10" />}
			<div className="min-w-0 flex-1">
				{strapline && <p className="text-muted-foreground truncate text-xs font-medium">{strapline}</p>}
				<h2 className="truncate text-xl font-bold tracking-tight">{title}</h2>
			</div>
			{action}
			{children}
		</header>
	);
}

/** A rail waiting for its answer, at the measurements `MediaShelf` renders, so nothing moves on the swap. */
export function ShelfSkeleton() {
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

export function MediaShelf({
	title,
	strapline,
	artworkUrl,
	itemsPerColumn,
	items,
	queue,
	context,
	showHeader = true,
	headerAction,
	layout = "cards",
}: {
	title: string;
	strapline?: string;
	artworkUrl?: string;
	itemsPerColumn?: number;
	items: MusicEntity[];
	queue?: Track[];
	context?: QueueContext;
	showHeader?: boolean;
	headerAction?: React.ReactNode;
	layout?: "cards" | "ranked";
}) {
	const rows = Math.min(Math.max(layout === "ranked" ? (itemsPerColumn ?? 4) : (itemsPerColumn ?? 1), 1), 4);
	const asRows = layout === "ranked" || rows > 1;
	const { rail, edges, updateEdges, scroll } = useHorizontalRail(items.length, `${layout}-${rows}`);

	if (!items.length) return null;
	const tracks = queue ?? toTracks(items);
	return (
		<section className="flex flex-col gap-4" aria-label={showHeader ? undefined : title}>
			{showHeader && (
				<SectionHeader title={title} strapline={strapline} artworkUrl={artworkUrl} action={headerAction}>
					<RailControls title={title} edges={edges} onScroll={scroll} />
				</SectionHeader>
			)}
			<div
				ref={rail}
				onScroll={(event) => updateEdges(event.currentTarget)}
				className={cn(
					"-mx-1 -mt-1 snap-x overflow-x-auto px-1 pt-1 pb-2",
					asRows ? "grid grid-flow-col gap-x-4 gap-y-1" : "flex gap-4"
				)}
				style={
					asRows
						? {
								gridAutoColumns: "minmax(17rem, calc((100% - 2rem) / 3))",
								gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
							}
						: undefined
				}
			>
				{items.map((item, index) =>
					asRows ? (
						<MediaRow
							key={`${"track" in item ? item.itemId : item.id}-${index}`}
							item={item}
							queue={tracks}
							context={context}
							// Upstream's own chart position wins: a row dropped on the way here would otherwise
							// renumber everything under it.
							rank={entityRank(item) ?? (layout === "ranked" ? index + 1 : undefined)}
						/>
					) : (
						<MediaCard
							key={`${"track" in item ? item.itemId : item.id}-${index}`}
							item={item}
							queue={tracks}
							context={context}
							className="w-[calc((100%_-_5rem)/6)] min-w-40 shrink-0 snap-start"
						/>
					)
				)}
			</div>
		</section>
	);
}

/**
 * One row of a mixed list. A search answers with songs, albums, artists and playlists ranked
 * against each other, and a grid of equal cards hides that ranking, so results read as a column
 * where each row says what it is, the way YouTube Music lists them.
 */
export function MediaRow({
	item,
	queue,
	context,
	rank,
}: {
	item: MusicEntity;
	queue?: Track[];
	context?: QueueContext;
	rank?: number;
}) {
	const engine = usePlayer();
	const { playback } = usePlayback();
	const track = isTrack(item) ? item : undefined;
	const current = track && playback.currentTrack?.id === track.id;
	const image = <Artwork src={entityArtwork(item)} round={isArtist(item)} className="size-12" />;
	const artwork = (
		<div className="relative shrink-0">
			{track ? (
				image
			) : (
				<EntityLink item={item} className="block shrink-0">
					{image}
				</EntityLink>
			)}
			{track && (
				<Button
					size="icon-sm"
					aria-label={`Play ${entityTitle(item)}`}
					className="absolute inset-0 m-auto rounded-full opacity-0 shadow-lg transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
					onClick={() => void engine.play(track, queue ?? [track], context)}
				>
					<Play fill="currentColor" />
				</Button>
			)}
			{(isAlbum(item) || isPlaylist(item)) && (
				<CollectionPlayButton
					collection={item}
					className="absolute inset-0 m-auto rounded-full opacity-0 shadow-lg transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
				/>
			)}
		</div>
	);

	return (
		<EntityContextMenu
			item={item}
			render={<div className="group/row hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-1.5" />}
		>
			{rank && <span className="text-muted-foreground w-6 shrink-0 text-right text-lg tabular-nums">{rank}</span>}
			{artwork}
			<span className="flex min-w-0 flex-1 flex-col text-left">
				<EntityLink item={item} className="min-w-0 hover:underline">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className={cn("truncate text-sm font-medium", current && "text-primary")}>{entityTitle(item)}</span>
						{"explicit" in item && item.explicit && <ExplicitBadge />}
					</span>
				</EntityLink>
				<span className="text-muted-foreground truncate text-xs">
					<EntityDetail item={item} />
				</span>
			</span>
			{/* A shelf row often arrives without one, and "0:00" states a length rather than omitting it. */}
			{track && track.durationSeconds > 0 && (
				<span className="text-muted-foreground text-sm tabular-nums">{formatDuration(track.durationSeconds)}</span>
			)}
		</EntityContextMenu>
	);
}

/**
 * "Song • Daft Punk • 96M plays", "Album • 2013", "Artist • 806K monthly listeners", the line under a
 * mixed row. The play count reads here rather than beside the length, because upstream leaves it out
 * of as many rows as it leaves out a duration and a column that empty is worse than a longer line.
 */
export function EntityDetail({ item }: { item: MusicEntity }) {
	// Only a song or a release names artists, and only those become links. Everything else keeps the
	// one line upstream gave it.
	const artists = isTrack(item) || isAlbum(item) ? item.artists : undefined;
	const detail = artists?.length ? undefined : entitySubtitle(item);
	// An artist upstream states no count for falls back to its own kind, which the line already opens
	// with: "Artist • Artist" is what printing it anyway reads as.
	const subtitle = detail === entityKind(item) ? undefined : detail;
	// Named here rather than left to a column header, since this is one line and not a table.
	const plays = isTrack(item) && item.plays ? expandPlays(item.plays) : undefined;

	return (
		<>
			{entityKind(item)}
			{artists?.length ? (
				<>
					{" • "}
					<ArtistLinks artists={artists} />
				</>
			) : (
				subtitle && ` • ${subtitle}`
			)}
			{plays && ` • ${plays} plays`}
		</>
	);
}

export function MediaList({
	items,
	context,
	/** A chart, where every row states its place. Elsewhere a list is just a list. */
	ranked = false,
}: {
	items: MusicEntity[];
	context?: QueueContext;
	ranked?: boolean;
}) {
	const tracks = toTracks(items);

	return (
		<div className="flex flex-col">
			{items.map((item, index) => (
				<MediaRow
					key={"track" in item ? item.itemId : item.id}
					item={item}
					queue={tracks}
					context={context}
					// The same rule as a ranked shelf: upstream's own position, since the rows it dropped
					// would otherwise renumber every row under them.
					rank={entityRank(item) ?? (ranked ? index + 1 : undefined)}
				/>
			))}
		</div>
	);
}

export function MediaGrid({
	items,
	context,
	downloaded,
}: {
	items: MusicEntity[];
	context?: QueueContext;
	downloaded?: boolean;
}) {
	const tracks = toTracks(items);

	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-6">
			{items.map((item) => (
				<MediaCard
					key={"track" in item ? item.itemId : item.id}
					item={item}
					queue={tracks}
					context={context}
					downloaded={downloaded}
				/>
			))}
		</div>
	);
}

/** A release: an album or a playlist. An artist page leads with its own banner instead. */
export function DetailHeader({
	kind,
	title,
	meta,
	artworkUrl,
	actions,
}: {
	kind: string;
	title: string;
	meta: React.ReactNode;
	artworkUrl?: string;
	actions?: React.ReactNode;
}) {
	return (
		<header className="flex items-end gap-6 pb-8">
			<Artwork src={artworkUrl} className="size-44 shadow-lg" />
			<div className="flex min-w-0 flex-col gap-2 pb-1">
				<span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{kind}</span>
				<h1 className="text-3xl leading-tight font-bold tracking-tight">{title}</h1>
				<p className="text-muted-foreground line-clamp-2 text-sm">{meta}</p>
				{actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
			</div>
		</header>
	);
}

export function PageTitle({ children }: { children: React.ReactNode }) {
	return <h1 className="pb-6 text-2xl font-bold tracking-tight">{children}</h1>;
}

/**
 * The columns of a track list, shared by its rows and the header above them. Inline rather than a
 * Tailwind class because the template varies with the columns a page has to state, and a class name
 * built at runtime is one the compiler never sees. The count and the trailing cell are fixed widths
 * where the rest flex: every row is a grid of its own, so an `auto` column sizes to that row's own
 * content and would land somewhere different on each one.
 */
function trackColumns(columns: TrackColumns) {
	const template = [
		"2rem",
		columns.album ? "minmax(0,2fr)" : "minmax(0,1fr)",
		columns.album && "minmax(0,1fr)",
		columns.plays && "8rem",
		columns.rating && "4.5rem",
		"7rem",
	];
	return { gridTemplateColumns: template.filter(Boolean).join(" ") };
}

interface TrackColumns {
	album: boolean;
	plays: boolean;
	rating: boolean;
}

/** Named columns, for the one page whose rows are a table rather than a shelf. */
function TrackHeader({ columns }: { columns: TrackColumns }) {
	return (
		<div
			className="text-muted-foreground mb-2 grid items-center gap-4 border-b px-2 pb-2 text-xs font-medium tracking-wide uppercase"
			style={trackColumns(columns)}
		>
			<span className="text-center">#</span>
			<span>Name</span>
			{columns.album && <span>Album</span>}
			{columns.plays && <span className="text-right">Plays</span>}
			{/* Words for the thumbs would be the account's actions, which are longer than the column and
			    not what a heading says. The icons are the headings. */}
			{columns.rating && (
				<span className="flex justify-self-end">
					<span className="flex size-8 items-center justify-center">
						<ThumbsUp role="img" aria-label="Liked" className="size-4" />
					</span>
					<span className="flex size-8 items-center justify-center">
						<ThumbsDown role="img" aria-label="Disliked" className="size-4" />
					</span>
				</span>
			)}
			<span className="flex items-center justify-end gap-1">
				Duration
				{/* Stands in for the row menu, so the word ends where every length under it does. */}
				<span className="size-8" aria-hidden />
			</span>
		</div>
	);
}

/**
 * The account's rating for one row. A component of its own because reading it costs a request per
 * track, so only a list that shows the column pays for it, and `useRating` holds the answer in a
 * store the player bar's thumbs and every row menu write through: rating a track from any of them
 * lights the others.
 *
 * ponytail: that is one `/next` per row, fired together when the page mounts, since nothing upstream
 * states a whole list's ratings at once. If an album's worth of them ever reads slowly or draws a
 * rate limit, the fix is a batched read in main, not a smaller column.
 */
function TrackRating({ track }: { track: Track }) {
	const rating = useRating(track.id);
	const thumb = (control: "like" | "dislike", Icon: typeof ThumbsUp, label: string) => (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			aria-pressed={rating === control}
			// Unrated thumbs stay out of the way until the row is under the pointer or the keyboard,
			// the way the play button in the index column does. A rating that is set always shows.
			className={cn(
				"text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
				rating === control &&
					(control === "like" ? "text-primary opacity-100" : "aria-pressed:text-foreground opacity-100")
			)}
			// The row underneath plays on click, and rating a track is not a way of asking for that.
			onClick={(event) => {
				event.stopPropagation();
				void rate(track.id, nextRating(control, rating));
			}}
		>
			<Icon fill={rating === control ? "currentColor" : "none"} />
		</Button>
	);

	return (
		<span className="flex items-center justify-self-end">
			{thumb("like", ThumbsUp, "Add to liked songs")}
			{thumb("dislike", ThumbsDown, "Dislike")}
		</span>
	);
}

export function TrackRow({
	track,
	index,
	queue,
	context,
	showAlbum = true,
	showPlays = false,
	showRating = false,
	action,
}: {
	track: Track;
	index: number;
	queue: Track[];
	context?: QueueContext;
	showAlbum?: boolean;
	/** Whole-list, not per-row: a column only some rows reserve is a column that lands nowhere. */
	showPlays?: boolean;
	showRating?: boolean;
	/** Menu items only this row's owner can offer, appended to the shared menu below. */
	action?: React.ReactNode;
}) {
	const columns = { album: showAlbum, plays: showPlays, rating: showRating };
	const engine = usePlayer();
	const { playback } = usePlayback();
	const current = playback.currentTrack?.id === track.id;
	// Paused, idle after the queue ran out, or failed: the row offers play back on hover.
	const running = playback.status === "playing" || playback.status === "loading";

	return (
		<EntityContextMenu
			item={track}
			extra={action}
			render={
				<div
					className="group/row hover:bg-accent grid cursor-pointer items-center gap-4 rounded-lg px-2 py-1.5"
					style={trackColumns(columns)}
					// The row plays, like every mixed row in the app. The artist links and the menu inside it
					// stop the click, and the play button in the index column is the keyboard path.
					onClick={() => void engine.play(track, queue, context)}
				/>
			}
		>
			<div className="text-muted-foreground flex h-8 items-center justify-center text-sm">
				{current && running ? (
					<PlayingBars paused={playback.status !== "playing"} />
				) : (
					<>
						<span className="group-hover/row:hidden">{current ? <PlayingBars paused /> : index + 1}</span>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Play ${track.title}`}
							className="hidden group-hover/row:inline-flex"
							// Resuming the current row passes no track, so the engine keeps its position
							// instead of tearing the deck down and starting over, which is also why this
							// click cannot reach the row underneath.
							onClick={(event) => {
								event.stopPropagation();
								void (current ? engine.play() : engine.play(track, queue, context));
							}}
						>
							<Play fill="currentColor" />
						</Button>
					</>
				)}
			</div>
			<div className="flex min-w-0 items-center gap-3">
				<Artwork src={track.artworkUrl} className="size-10" />
				<span className="flex min-w-0 flex-col items-start">
					<span className="flex max-w-full min-w-0 items-center gap-1.5">
						<TrackLink
							track={track}
							className={cn("truncate text-sm font-medium hover:underline", current && "text-primary")}
						/>
						{track.explicit && <ExplicitBadge />}
					</span>
					<span className="text-muted-foreground max-w-full truncate text-xs">
						<ArtistLinks artists={track.artists} />
					</span>
				</span>
			</div>
			{/* Empty when upstream named no release. "Single" was a guess, and it read as one on every row
			    of a page whose rows carry no release at all. */}
			{showAlbum && (
				<TrackLink track={track} className="text-muted-foreground truncate text-sm hover:underline">
					{track.album?.title}
				</TrackLink>
			)}
			{/* Its own column, and only where the whole list has one: upstream states a count for an
			    album's rows and for an artist's top songs, and for very little else. */}
			{showPlays && (
				<span className="text-muted-foreground truncate text-right text-sm tabular-nums">
					{track.plays && expandPlays(track.plays)}
				</span>
			)}
			{showRating && <TrackRating track={track} />}
			<div className="flex items-center justify-end gap-1">
				{/* The cell holds its width whether or not there is a length in it: `auto` collapsed on the
				    rows that state none, and every column before it slid right on those rows alone. */}
				<span className="text-muted-foreground w-11 text-right text-sm tabular-nums">
					{track.durationSeconds > 0 && formatDuration(track.durationSeconds)}
				</span>
				<TrackMenu track={track} extra={action} className="text-muted-foreground" />
			</div>
		</EntityContextMenu>
	);
}

export function TrackList({
	tracks,
	context,
	showAlbum = true,
	headers = false,
	renderAction,
}: {
	tracks: Track[];
	context?: QueueContext;
	showAlbum?: boolean;
	/** A page whose rows are the page. A shelf of five stays a shelf and names no columns. */
	headers?: boolean;
	/** Menu items only this list's owner can offer, by row: a playlist reorders and removes. */
	renderAction?: (index: number) => React.ReactNode;
}) {
	// One count in the list is enough to give every row the column: it is what the header names, and
	// upstream states the count for all of a list's rows or for none of them. The thumbs go with the
	// table for a harder reason: reading a rating costs a request per track, and a shelf of five on a
	// page of shelves is not where that is worth spending.
	const columns = { album: showAlbum, plays: tracks.some((track) => track.plays), rating: headers };

	return (
		<div className="flex flex-col">
			{headers && <TrackHeader columns={columns} />}
			{tracks.map((track, index) => (
				<TrackRow
					key={`${track.id}-${index}`}
					track={track}
					index={index}
					queue={tracks}
					context={context}
					showAlbum={columns.album}
					showPlays={columns.plays}
					showRating={columns.rating}
					action={renderAction?.(index)}
				/>
			))}
		</div>
	);
}
