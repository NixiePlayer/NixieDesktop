import { Await, createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { playCollection } from "#/components/entity-menu";
import { Artwork, entityRoute, ExplicitBadge, MediaList, MediaShelf, PageTitle } from "#/components/media";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { queryMusic } from "#/lib/api";
import { formatDuration } from "#/lib/format";
import { cn } from "#/lib/utils";
import { usePlayer } from "#/player";
import type { Artist, MusicEntity, Page, QueueContext, Track } from "#/shared/contracts";
import {
	byPopularity,
	entityArtwork,
	entityKind,
	entitySubtitle,
	entityTitle,
	isAlbum,
	isArtist,
	isTrack,
	searchAnchor,
	trackAlbumId,
	toTracks,
} from "#/shared/entities";

type SearchFilter = "all" | "songs" | "albums" | "artists" | "playlists";

const filters: SearchFilter[] = ["all", "songs", "albums", "artists", "playlists"];

export const Route = createFileRoute("/search")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
		filter: filters.includes(String(search.filter) as SearchFilter)
			? (search.filter as SearchFilter)
			: ("all" as const),
	}),
	loaderDeps: ({ search: { q, filter } }) => ({ q, filter }),
	loader: async ({ deps }) => {
		if (!deps.q) return { items: [], artist: undefined };
		const page = await queryMusic({
			type: "search",
			query: deps.q,
			filter: deps.filter === "all" ? undefined : deps.filter,
		});
		// Only the unfiltered search is ranked across kinds, so only it has a result worth anchoring on.
		const { artistId } = searchAnchor(deps.filter === "all" ? page.items[0] : undefined);
		return {
			...page,
			// Unawaited on purpose: the results paint now and this fills the shelves in when it lands.
			// The catch is load-bearing. `Await` is `React.use` on React 19, so a rejection throws
			// during render, and with no error component on this route it would take the whole app
			// shell down to the root boundary over a section nobody asked for.
			artist: artistId
				? queryMusic({ type: "artist", id: artistId }).catch((): Page<MusicEntity> => ({ items: [] }))
				: undefined,
		};
	},
	component: SearchPage,
});

function SearchPage() {
	const { q, filter } = Route.useSearch();
	const { items, artist } = Route.useLoaderData();
	const navigate = useNavigate({ from: Route.fullPath });
	const context: QueueContext = { type: "search", title: `Results for ${q}` };
	// Only the unfiltered search is ranked across kinds, and `withSearchTopResult` puts the one
	// YouTube Music is most confident about at the head of the page. A filtered tab is a plain list.
	const top = filter === "all" ? items[0] : undefined;
	const { artistId, from } = searchAnchor(top);
	// What the top result points at is promoted above, so it does not read twice on the way down.
	// The rest of the ranking is left exactly as YouTube ordered it, including whatever the artist
	// shelves happen to repeat: those land later, and rewriting the list under the reader flickers.
	const promoted = new Set(from.map((item) => ("id" in item ? item.id : "")));
	const rest = (top ? items.slice(1) : items).filter((item) => !("id" in item) || !promoted.has(item.id));

	// The top bar owns query entry now, so this page is only results and their filter.
	return (
		<div>
			<PageTitle>{q ? `Results for ${q}` : "Search"}</PageTitle>

			<Tabs
				value={filter}
				onValueChange={(value) => void navigate({ search: { q, filter: value as SearchFilter } })}
				className="pb-6"
			>
				<TabsList variant="line">
					{filters.map((value) => (
						<TabsTrigger key={value} value={value}>
							{value[0]?.toUpperCase()}
							{value.slice(1)}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{q && items.length ? (
				<div className="flex flex-col gap-10">
					{/* The card and the artist's top songs read as one block, and split in half rather
					    than each running the full width. Below `lg` the songs wrap under the card. */}
					<div className={cn("grid gap-x-8 gap-y-10", artistId && artist && "lg:grid-cols-2")}>
						{top && <TopResult item={top} queue={toTracks(items)} context={context} details={artist} />}
						{artistId && artist && (
							<Await promise={artist} fallback={<Skeleton className="h-56 w-full rounded-xl" />}>
								{(page) => <ArtistTopSongs items={page.items} artistId={artistId} />}
							</Await>
						)}
					</div>
					{top && <MediaShelf title={`From this ${entityKind(top).toLowerCase()}`} items={from} />}
					{artistId && artist && (
						<Await promise={artist} fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
							{(page) => <ArtistSections items={page.items} artistId={artistId} ranked={items} />}
						</Await>
					)}
					<section className="flex flex-col gap-4">
						{(artistId || from.length > 0) && <h2 className="text-xl font-bold tracking-tight">More results</h2>}
						<MediaList items={rest} context={context} />
					</section>
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					{q ? "No results. Try fewer words or a different filter." : "Search YouTube Music for anything."}
				</p>
			)}
		</div>
	);
}

/** By id, never "the first artist on the page": an artist page carries related artists too. */
function artistContext(items: MusicEntity[], artistId: string): QueueContext {
	const artist = items.find((item): item is Artist => isArtist(item) && item.id === artistId);
	return { type: "radio", id: artistId, title: artist?.name ?? "Artist" };
}

/**
 * The half that sits beside the top result. Five rows, because the block reads as two columns of
 * roughly one height; the rest of the catalogue is a click away on the artist page. No album column:
 * every row here belongs to the same artist, and the length reads at the end of the row instead.
 */
function ArtistTopSongs({ items, artistId }: { items: MusicEntity[]; artistId: string }) {
	const tracks = toTracks(items).slice(0, 5);
	if (!tracks.length) return null;

	return (
		<section className="flex flex-col">
			<h2 className="text-muted-foreground pb-3 text-sm font-medium">Songs</h2>
			<MediaList items={tracks} context={artistContext(items, artistId)} />
		</section>
	);
}

/**
 * The artist the top result belongs to, opened for real rather than guessed at from the ranking:
 * a search returns whichever few releases scored well, an artist page returns the catalogue.
 */
function ArtistSections({
	items,
	artistId,
	ranked,
}: {
	items: MusicEntity[];
	artistId: string;
	ranked: MusicEntity[];
}) {
	return (
		<>
			{/* The artist's own top songs rank harder than the search does, so they go first. */}
			<MediaShelf title="Albums" items={byPopularity(items.filter(isAlbum), [...toTracks(items), ...ranked])} />
			<MediaShelf title="Fans might also like" items={items.filter(isArtist).filter((item) => item.id !== artistId)} />
		</>
	);
}

/**
 * The top result carries no frame of its own: a cover and what the row knows, sitting on the page
 * next to the songs. `details` is the same artist promise the shelves below wait on, and only an
 * artist top result reads anything out of it, since a search row is the only description a song or
 * an album has and it already prints one.
 */
function TopResult({
	item,
	queue,
	context,
	details,
}: {
	item: MusicEntity;
	queue: Track[];
	context: QueueContext;
	details?: Promise<Page<MusicEntity>>;
}) {
	const engine = usePlayer();
	const track = isTrack(item) ? item : undefined;
	// A search never returns a playlist row, which is the one entity with nowhere of its own to go.
	if ("track" in item) return null;

	const title = entityTitle(item);
	const releaseId = track && trackAlbumId(track);
	// A release or an artist carries no songs on a search row, so playing one opens it first.
	const playEntity = () => (track ? engine.play(track, queue, context) : playCollection(engine, item, title));

	// The kind is the line above, so an artist would otherwise read "Artist" twice.
	const subtitle = isArtist(item) ? undefined : entitySubtitle(item);
	const meta = [
		isAlbum(item) ? item.year : undefined,
		isAlbum(item) && item.trackCount ? `${item.trackCount} songs` : undefined,
		track && track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : undefined,
	]
		.filter(Boolean)
		.join(" · ");

	const artwork = (
		<div className="relative shrink-0">
			<Artwork
				src={entityArtwork(item)}
				round={isArtist(item)}
				className="size-44 shadow-lg transition-[transform,box-shadow] duration-200 group-hover/top:scale-[1.02] group-hover/top:shadow-xl"
			/>
			{/* Decorative: whatever owns the cover is already the control, a song's whole block or the
			    button around this one. A second control inside either is neither valid nor reachable. */}
			<span
				aria-hidden
				className="bg-primary text-primary-foreground pointer-events-none absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full opacity-0 shadow-lg transition-opacity group-hover/top:opacity-100"
			>
				<Play fill="currentColor" className="size-5" />
			</span>
		</div>
	);

	const info = (
		<div className="flex min-w-0 flex-col gap-1 text-left">
			<span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{entityKind(item)}</span>
			<span className="truncate text-4xl font-bold tracking-tight group-hover/open:underline">{title}</span>
			{subtitle && <span className="truncate text-sm font-medium">{subtitle}</span>}
			{(meta || (track && track.explicit)) && (
				<span className="text-muted-foreground flex items-center gap-2 text-sm">
					{meta}
					{track?.explicit && <ExplicitBadge />}
				</span>
			)}
			{isArtist(item) &&
				details && (
					// Two lines are held open from the first paint, so the bio does not shove the
					// block down the column when the artist page lands a round-trip later.
					<span className="block min-h-10 pt-1">
						<Await promise={details} fallback={<span aria-hidden />}>
							{(page) => (
								<span className="text-muted-foreground line-clamp-2 text-sm">
									{page.items.find((entry): entry is Artist => isArtist(entry) && entry.id === item.id)?.description}
								</span>
							)}
						</Await>
					</span>
				)}
		</div>
	);

	const linkClass =
		"group/open focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center self-stretch rounded-xl focus-visible:ring-3 focus-visible:outline-none";
	const linkedInfo = track ? (
		releaseId ? (
			<Link to="/album/$id" params={{ id: releaseId }} className={linkClass}>
				{info}
			</Link>
		) : (
			info
		)
	) : (
		<Link to={entityRoute(item)} params={{ id: item.id }} className={linkClass}>
			{info}
		</Link>
	);

	// The block is centred against whatever height the songs beside it take. The cover plays and
	// the text opens the result, including the release behind a song.
	return (
		<section className="flex flex-col">
			<h2 className="text-muted-foreground pb-3 text-sm font-medium">Top result</h2>
			<div className="group/top flex h-full w-full flex-1 items-center gap-6">
				<button
					aria-label={`Play ${title}`}
					className="focus-visible:ring-ring/50 rounded-lg focus-visible:ring-3 focus-visible:outline-none"
					onClick={() => void playEntity()}
				>
					{artwork}
				</button>
				{linkedInfo}
			</div>
		</section>
	);
}
