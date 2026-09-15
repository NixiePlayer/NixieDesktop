import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MediaGrid, PageTitle } from "#/components/media";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { queryMusic } from "#/lib/api";
import { useMessages } from "#/lib/i18n";
import { markHeld } from "#/lib/library";
import type { MusicEntity } from "#/shared/contracts";
import { isAlbum, isArtist, isPlaylist, isPodcast, isTrack } from "#/shared/entities";
import type { Messages } from "#/shared/i18n";

// The labels are functions of the dictionary rather than strings, so a tab follows the language.
const filters = [
	{ value: "all", label: (m: Messages) => m.pages.library.all, match: () => true },
	{
		value: "playlists",
		label: (m: Messages) => m.common.playlists,
		match: (item: MusicEntity) => isPlaylist(item) && !isPodcast(item),
	},
	{ value: "podcasts", label: (m: Messages) => m.common.podcasts, match: isPodcast },
	{ value: "albums", label: (m: Messages) => m.common.albums, match: isAlbum },
	{ value: "artists", label: (m: Messages) => m.common.artists, match: isArtist },
	{
		value: "songs",
		label: (m: Messages) => m.common.songs,
		match: (item: MusicEntity) => isTrack(item) && !item.episode,
	},
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
	const m = useMessages();
	return (
		<>
			<PageTitle>{m.pages.library.title}</PageTitle>
			<Tabs value={filter} onValueChange={onFilter} className="pb-6">
				<TabsList variant="line">
					{filters.map((item) => (
						<TabsTrigger key={item.value} value={item.value}>
							{item.label(m)}
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
	const m = useMessages();
	const [filter, setFilter] = useState<string>("all");
	const active = filters.find((item) => item.value === filter) ?? filters[0];
	const visible = library.items.filter(active.match);

	return (
		<div>
			<LibraryHeader filter={filter} onFilter={setFilter} />
			{visible.length ? (
				<MediaGrid items={visible} context={{ type: "library", title: active.label(m) }} />
			) : (
				<p className="text-muted-foreground text-sm">{m.pages.library.empty}</p>
			)}
		</div>
	);
}
