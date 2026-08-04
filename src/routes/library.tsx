import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MediaGrid, PageTitle } from "#/components/media";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { queryMusic } from "#/lib/api";
import { markHeld } from "#/lib/library";
import { isAlbum, isArtist, isPlaylist, isTrack } from "#/shared/entities";

const filters = [
	{ value: "all", label: "All", match: () => true },
	{ value: "downloads", label: "Downloads", match: () => false },
	{ value: "playlists", label: "Playlists", match: isPlaylist },
	{ value: "albums", label: "Albums", match: isAlbum },
	{ value: "artists", label: "Artists", match: isArtist },
	{ value: "songs", label: "Songs", match: isTrack },
] as const;

export const Route = createFileRoute("/library")({
	loader: async () => {
		const [library, stored] = await Promise.all([
			queryMusic({ type: "library" }).catch(() => ({ items: [] })),
			window.noctune?.local.load(),
		]);
		// Everything the library page lists is held by definition, and it is the only free read of that:
		// nothing on a shelf, a search result or a page states whether the account already holds it.
		markHeld(library.items);
		return { library, downloads: stored?.downloads.map(({ track }) => track) ?? [] };
	},
	component: LibraryPage,
});

function LibraryPage() {
	const { library, downloads } = Route.useLoaderData();
	const [filter, setFilter] = useState<string>("all");
	const active = filters.find((item) => item.value === filter) ?? filters[0];
	const visible = filter === "downloads" ? downloads : library.items.filter(active.match);

	return (
		<div>
			<PageTitle>Library</PageTitle>
			<Tabs value={filter} onValueChange={setFilter} className="pb-6">
				<TabsList variant="line">
					{filters.map((item) => (
						<TabsTrigger key={item.value} value={item.value}>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			{visible.length ? (
				<MediaGrid
					items={visible}
					context={{ type: "library", title: active.label }}
					downloaded={filter === "downloads"}
				/>
			) : (
				<p className="text-muted-foreground text-sm">Nothing here yet.</p>
			)}
		</div>
	);
}
