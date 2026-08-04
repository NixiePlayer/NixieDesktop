import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Radio, Shuffle } from "lucide-react";
import { useState } from "react";
import { EntityMenu, playRadio } from "#/components/entity-menu";
import { BrowseAction, MediaShelf, ShelfSkeleton, TrackList } from "#/components/media";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { queryMusic } from "#/lib/api";
import { setSubscribed, useHeld } from "#/lib/library";
import { cn } from "#/lib/utils";
import { usePlayer } from "#/player";
import type { Artist } from "#/shared/contracts";
import { isAlbum, isArtist, toTracks } from "#/shared/entities";

export const Route = createFileRoute("/artist/$id")({
	loader: ({ params }) => queryMusic({ type: "artist", id: params.id }),
	component: ArtistPage,
	pendingComponent: ArtistPending,
});

/**
 * This page's own pending state, for the reason `/explore` has one: the global skeleton is a grid,
 * and an artist is a banner, a name over it and one list. Every measurement below is the one the
 * real page uses, down to the row height, so the swap moves nothing under the pointer.
 */
function ArtistPending() {
	return (
		<div className="relative -mx-6 -mt-6 overflow-hidden px-6 pt-6">
			<Skeleton className="relative -mx-6 -mt-6 aspect-27/10 rounded-none" />
			<div className="-mt-52 flex flex-col gap-2 pb-8">
				<Skeleton className="h-3 w-12" />
				<Skeleton className="h-10 w-72" />
				<Skeleton className="h-4 w-full max-w-md" />
				<div className="flex items-center gap-2 pt-2">
					<Skeleton className="h-9 w-28 rounded-md" />
					<Skeleton className="h-9 w-20 rounded-md" />
					<Skeleton className="h-9 w-28 rounded-md" />
					<Skeleton className="size-8 rounded-md" />
				</div>
			</div>
			<section className="flex flex-col gap-4 pb-10">
				<Skeleton className="h-7 w-24" />
				<div className="flex flex-col">
					{Array.from({ length: 5 }, (_, index) => (
						<div key={index} className="flex items-center gap-4 px-2 py-1.5">
							<Skeleton className="h-3 w-8" />
							<Skeleton className="size-10 rounded-lg" />
							<div className="flex min-w-0 flex-1 flex-col gap-1.5">
								<Skeleton className="h-4 w-1/3" />
								<Skeleton className="h-3 w-1/5" />
							</div>
							<Skeleton className="h-3 w-16" />
						</div>
					))}
				</div>
				<Skeleton className="h-9 w-full" />
			</section>
			<ShelfSkeleton />
		</div>
	);
}

function ArtistPage() {
	const { id } = Route.useParams();
	const { items, sections } = Route.useLoaderData();
	const engine = usePlayer();
	// The store, not this page's own state: the row menu offers the same subscription, and the two
	// disagreed about it. It reports a refusal and puts itself back, so there is nothing to catch here.
	const subscribed = useHeld(id);
	// Five songs is the shelf YouTube itself renders, the other five are behind the bar under them.
	const [expanded, setExpanded] = useState(false);
	// Which banner has decoded, so the one arriving fades in rather than replacing the reserved slab.
	const [loaded, setLoaded] = useState<string>();

	const tracks = toTracks(items);
	const albums = items.filter(isAlbum);
	// Upstream's own release shelves, kept apart rather than merged into one rail: it draws "Albums"
	// and "Singles" separately and states a "See all" browse for each, so a single merged rail could
	// only carry one of the two targets and would open half of what it offered. A shelf of anything
	// else (the top songs, "Featured on", the related artists) is rendered elsewhere or not at all.
	const releases = sections?.filter((section) => section.items.every(isAlbum)) ?? [];
	// By id, never "the first artist on the page": the shelves below carry related artists too, and
	// picking one of those renders someone else's name and photo over this artist's songs.
	const artist =
		items.find((item): item is Artist => isArtist(item) && item.id === id) ??
		tracks[0]?.artists.find((candidate) => candidate.id === id);
	const title = artist?.name ?? tracks[0]?.artists[0]?.name ?? "Artist";
	const context = { type: "radio" as const, id, title };
	// What the header's own two buttons play, and the reason they are only rendered when it stated them.
	const { shuffle, radio } = artist ?? {};
	// Its wide image, or its photograph standing in blurred. An artist page with neither is a title
	// on bare background, which is what it was before.
	const banner = artist?.bannerUrl ?? artist?.artworkUrl;

	return (
		// The shell pads the outlet, so the banner is bled back out to both edges and the content padded
		// back in, the same way the Home and Explore washes are.
		<div className="relative isolate -mx-6 -mt-6 overflow-hidden px-6 pt-6">
			{banner && (
				// A box of its own shape, never the image's: an image sized by what it turns out to be is
				// nothing until it decodes, and the whole page under it jumps the moment it does. Anchored
				// to the top, since these are photographs of people and the crop is off the bottom.
				// The shape is upstream's own, near enough that a band photographed full length stays
				// whole, and it is the box that holds it rather than the image: a height capped on the
				// image narrows it off the window's edge, since a replaced element keeps its ratio.
				<div aria-hidden className="bg-muted/40 pointer-events-none relative -mx-6 -mt-6 aspect-27/10">
					<img
						src={banner}
						alt=""
						onLoad={() => setLoaded(banner)}
						className={cn(
							"size-full object-cover object-top transition-opacity duration-500",
							// Held by src, not as a flag: the element is reused for the next artist's banner,
							// which would otherwise be shown at once while the old one was still on screen.
							loaded === banner ? "opacity-100" : "opacity-0",
							// No banner of its own: its photograph, blown up and blurred, which is the same
							// wash Home and Explore stand their first shelf on.
							artist?.bannerUrl ? undefined : "scale-110 blur-2xl"
						)}
					/>
					{/* The name and the buttons sit over the bottom of it, where this has reached the page's
					    own background, which is what keeps them legible over any photograph in either theme. */}
					<div className="from-background/10 via-background/60 to-background absolute inset-0 bg-gradient-to-b" />
				</div>
			)}
			<div className="relative">
				<header className={cn("flex flex-col gap-2 pb-8", banner && "-mt-52")}>
					<span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Artist</span>
					<h1 className="text-4xl leading-tight font-bold tracking-tight">{title}</h1>
					{/* Not a count of what the shelves happen to render: an artist page lists a handful of top
					    songs and a handful of releases, so counting those claims a catalogue size that is
					    not this artist's. */}
					{artist?.description && (
						<p className="text-muted-foreground line-clamp-2 max-w-3xl text-sm">{artist.description}</p>
					)}
					<div className="flex flex-wrap items-center gap-2 pt-2">
						{/* Upstream's own mixes, not this page's ten top songs reordered. A header stating
						    neither button leaves the row with the subscription and the menu, which still
						    offers a radio seeded off the first song. */}
						{shuffle && (
							<Button onClick={() => void playRadio(engine, { type: "radio", ...shuffle }, context)}>
								<Shuffle data-icon="inline-start" />
								Shuffle
							</Button>
						)}
						{radio && (
							<Button variant="outline" onClick={() => void playRadio(engine, { type: "radio", ...radio }, context)}>
								<Radio data-icon="inline-start" />
								Mix
							</Button>
						)}
						<Button variant="outline" onClick={() => void setSubscribed(id, !subscribed)}>
							{subscribed ? "Subscribed" : "Subscribe"}
						</Button>
						{artist && <EntityMenu item={artist} />}
					</div>
				</header>
				{tracks.length > 0 && (
					<section className="flex flex-col gap-4 pb-10">
						<h2 className="text-xl font-bold tracking-tight">Songs</h2>
						{/* No album column: these rows carry no release of their own, and every one of them
					    belongs to this artist anyway. Same list, same reason, as the one on `/search`. */}
						<TrackList tracks={tracks.slice(0, expanded ? 10 : 5)} context={context} showAlbum={false} />
						{tracks.length > 5 && (
							<Button
								variant="ghost"
								className="text-muted-foreground w-full"
								onClick={() => setExpanded(!expanded)}
								aria-expanded={expanded}
							>
								{expanded ? "See less" : "See more"}
								{expanded ? <ChevronUp data-icon="inline-end" /> : <ChevronDown data-icon="inline-end" />}
							</Button>
						)}
					</section>
				)}
				{releases.length ? (
					<div className="flex flex-col gap-10">
						{releases.map((section) => (
							<MediaShelf
								key={section.title}
								title={section.title}
								items={section.items}
								headerAction={<BrowseAction target={section.more} />}
							/>
						))}
					</div>
				) : (
					// A response that named no shelf at all still lists what it holds, the way it always did.
					<MediaShelf title="Releases" items={albums} />
				)}
			</div>
		</div>
	);
}
