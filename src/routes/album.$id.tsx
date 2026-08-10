import { createFileRoute } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { EntityMenu } from "#/components/entity-menu";
import { ArtistLinks, DetailHeader, ExplicitBadge, TrackList } from "#/components/media";
import { Button } from "#/components/ui/button";
import { queryMusic } from "#/lib/api";
import { formatTotalDuration, plural } from "#/lib/format";
import { usePlayer } from "#/player";
import { isAlbum, toTracks } from "#/shared/entities";

export const Route = createFileRoute("/album/$id")({
	// The song a link named on the way in, marked in the list below. It decides nothing the loader
	// fetches, so it is no `loaderDep`.
	validateSearch: (search) => ({ track: typeof search.track === "string" ? search.track : undefined }),
	loader: ({ params }) => queryMusic({ type: "album", id: params.id }),
	component: AlbumPage,
});

function AlbumPage() {
	const { id } = Route.useParams();
	const { track: marked } = Route.useSearch();
	const { items } = Route.useLoaderData();
	const engine = usePlayer();
	const tracks = toTracks(items);
	// The page carries its own header entity when upstream provides one, otherwise the
	// tracks know which album they belong to.
	const album = items.find(isAlbum) ?? tracks[0]?.album;
	const title = album?.title ?? "Album";
	const context = { type: "album" as const, id, title };
	const totalSeconds = tracks.reduce((total, track) => total + track.durationSeconds, 0);

	return (
		<div>
			<DetailHeader
				kind={album?.kind ?? "Album"}
				title={title}
				meta={
					<span className="flex items-center gap-2">
						{album?.explicit && <ExplicitBadge />}
						<span>
							{/* The artists are links here as everywhere else, so they sit outside the joined line. */}
							{album?.artists?.length ? (
								<>
									<ArtistLinks artists={album.artists} />
									{" · "}
								</>
							) : null}
							{[album?.year, plural(tracks.length, "track"), totalSeconds > 0 && formatTotalDuration(totalSeconds)]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</span>
				}
				artworkUrl={album?.artworkUrl ?? tracks[0]?.artworkUrl}
				actions={
					<>
						<Button disabled={!tracks[0]} onClick={() => tracks[0] && void engine.play(tracks[0], tracks, context)}>
							<Play data-icon="inline-start" fill="currentColor" />
							Play
						</Button>
						{album && <EntityMenu item={album} />}
					</>
				}
			/>
			{/* No footer under the rows: YouTube sends no © or ℗ line for a release, only the year the
			    header already carries. */}
			<TrackList tracks={tracks} context={context} showAlbum={false} headers marked={marked} />
		</div>
	);
}
