import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MediaGrid, PageTitle } from "#/components/media";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { queryMusic } from "#/lib/api";
import { markHeld } from "#/lib/library";
import type { MusicEntity } from "#/shared/contracts";
import { isAlbum, isArtist, isPlaylist, isPodcast, isTrack } from "#/shared/entities";

const filters = [
	{ value: "all", label: "All", match: () => true },
	{ value: "playlists", label: "Playlists", match: (item: MusicEntity) => isPlaylist(item) && !isPodcast(item) },
	{ value: "podcasts", label: "Podcasts", match: isPodcast },
	{ value: "albums", label: "Albums", match: isAlbum },
	{ value: "artists", label: "Artists", match: isArtist },
	{ value: "songs", label: "Songs", match: (item: MusicEntity) => isTrack(item) && !item.episode },
] as const;

export const Route = createFileRoute("/library")({
	loader: async () => {
		const library = await queryMusic({ type: "library" }).catch(() => ({ items: [] }));
		// Everything the library page lists is held by definition, and it is the only free read of that:
		// nothing on a shelf, a search result or a page states whether the account already holds it.
		markHeld(library.items);
		return { library };
	},
	pendingComponent: LibraryPending,
	component: LibraryPage,
});

/** The title and the tabs depend on nothing the loader answers, so they are drawn in both states. */
function LibraryHeader({ filter, onFilter }: { filter: string; onFilter?: (value: string) => void }) {
	return (
		<>
			<PageTitle>Library</PageTitle>
			<Tabs value={filter} onValueChange={onFilter} className="pb-6">
				<TabsList variant="line">
					{filters.map((item) => (
						<TabsTrigger key={item.value} value={item.value}>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
		</>
	);
}

// ponytail: the tabs filter in the renderer, so a tap here while loading is not remembered.
function LibraryPending() {
	return (
		<div>
			<LibraryHeader filter="all" />
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
	);
}

function LibraryPage() {
	const { library } = Route.useLoaderData();
	const [filter, setFilter] = useState<string>("all");
	const active = filters.find((item) => item.value === filter) ?? filters[0];
	const visible = library.items.filter(active.match);

	return (
		<div>
			<LibraryHeader filter={filter} onFilter={setFilter} />
			{visible.length ? (
				<MediaGrid items={visible} context={{ type: "library", title: active.label }} />
			) : (
				<p className="text-muted-foreground text-sm">Nothing here yet.</p>
			)}
		</div>
	);
}
