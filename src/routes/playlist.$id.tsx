import { createFileRoute, Link } from "@tanstack/react-router";
import { Link2, MoveDown, MoveUp, Play, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EntityMenu } from "#/components/entity-menu";
import { DetailHeader, TrackList } from "#/components/media";
import { EditPlaylistDialog, PrivacyLabel } from "#/components/playlist-dialog";
import { Button } from "#/components/ui/button";
import { DropdownMenuItem } from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { toast } from "#/components/ui/toast";
import { queryMusic } from "#/lib/api";
import { formatTotalDuration, plural } from "#/lib/format";
import { updatePlaylist } from "#/lib/library";
import { usePlayer } from "#/player";
import type { MusicCommand, Playlist, PlaylistItem } from "#/shared/contracts";
import { autoPlaylist, isPlaylist, isPlaylistItem, isTrack } from "#/shared/entities";

export const Route = createFileRoute("/playlist/$id")({
	validateSearch: (search) => ({ find: search.find === true || undefined }),
	loader: ({ params }) => queryMusic({ type: "playlist", id: params.id }),
	component: PlaylistPage,
});

function PlaylistPage() {
	const { id } = Route.useParams();
	const { find } = Route.useSearch();
	const { items: page } = Route.useLoaderData();
	const engine = usePlayer();
	const [filter, setFilter] = useState("");

	// Rows may arrive either already wrapped as playlist items or as bare tracks.
	const rows = useMemo(
		() =>
			page.flatMap((item) => {
				if (isPlaylistItem(item)) return [item];
				if (isTrack(item)) return [{ itemId: item.id, track: item }];
				return [];
			}),
		[page]
	);
	const [items, setItems] = useState<PlaylistItem[]>(rows);
	const [loaded, setLoaded] = useState(rows);
	// The list is edited optimistically here, so it is state and not the loader's rows. It still has to
	// follow a refetch: saving a song to the playlist that is open invalidates this page, and the
	// answer is the list as it now stands, where this copy is the list as it was opened.
	if (loaded !== rows) {
		setLoaded(rows);
		setItems(rows);
	}
	// By id, never "the first playlist on the page": the shelves under a playlist carry related ones.
	const header = page.find((item): item is Playlist => isPlaylist(item) && item.id === id);
	const [title, setTitle] = useState(header?.title ?? "Playlist");
	const [description, setDescription] = useState(header?.description ?? "");
	// Undefined for a playlist the account does not own, which is also the one it cannot edit.
	const [privacy, setPrivacy] = useState(header?.privacy);
	// Liked music and episodes for later: upstream draws no cover for either and names nobody behind them.
	const auto = autoPlaylist(id);

	const tracks = items.map((item) => item.track);
	const visibleTracks =
		find && filter
			? tracks.filter((track) =>
					[track.title, ...track.artists.map((artist) => artist.name)]
						.join(" ")
						.toLowerCase()
						.includes(filter.toLowerCase())
				)
			: tracks;
	const context = { type: "playlist" as const, id, title };
	const totalSeconds = tracks.reduce((total, track) => total + track.durationSeconds, 0);
	// The playlist as everyone else reaches it. A browse id carries a `VL` the public URL does not.
	const shareUrl = `https://music.youtube.com/playlist?list=${id.replace(/^VL/, "")}`;

	const mutate = async (next: PlaylistItem[], command: MusicCommand) => {
		const previous = items;
		setItems(next);
		try {
			await window.neotune?.music.command(command);
			toast.add({ title: "Playlist updated", description: "Your change is now on YouTube Music.", type: "success" });
		} catch {
			setItems(previous);
			toast.add({ title: "Change rolled back", description: "YouTube Music rejected the update.", type: "error" });
		}
	};

	const move = (index: number, offset: -1 | 1) => {
		const target = index + offset;
		if (!items[target]) return;
		const next = [...items];
		const [item] = next.splice(index, 1);
		if (!item) return;
		next.splice(target, 0, item);
		const before = next[target + 1]?.itemId;
		if (!before) return;
		void mutate(next, { type: "playlist-reorder", playlistId: id, itemId: item.itemId, beforeItemId: before });
	};

	return (
		<div>
			<DetailHeader
				kind="Playlist"
				title={title}
				meta={
					<span className="flex items-center gap-2">
						{/* Only a playlist the account owns states one, and it is the whole answer to who else
						    can open the link beside it. */}
						{privacy && <PrivacyLabel privacy={privacy} />}
						<span>
							{[
								header?.author ?? auto?.author,
								description,
								plural(items.length, "track"),
								totalSeconds > 0 && formatTotalDuration(totalSeconds),
							]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</span>
				}
				artworkUrl={auto?.artworkUrl ?? header?.artworkUrl ?? tracks[0]?.artworkUrl}
				actions={
					<>
						<Button disabled={!tracks[0]} onClick={() => tracks[0] && void engine.play(tracks[0], tracks, context)}>
							<Play data-icon="inline-start" fill="currentColor" />
							Play
						</Button>
						{/* A private playlist opens for nobody else, and upstream offers no share for one either. */}
						{privacy !== "private" && (
							<Button
								variant="outline"
								onClick={() =>
									void navigator.clipboard
										.writeText(shareUrl)
										.then(() => toast.add({ title: "Link copied", description: shareUrl, type: "success" }))
										.catch(() => toast.add({ title: "Could not copy the link", type: "error" }))
								}
							>
								<Link2 data-icon="inline-start" />
								Copy link
							</Button>
						)}
						{/* Editable is exactly what the account owns, and the privacy is how upstream says so:
						    it states one only to the owner, and the owner is the only one it accepts an edit
						    from. Offering the dialog for anyone else's playlist promised a change upstream
						    answers with a 400. Auto-generated metadata is nobody's to edit either. */}
						{!auto && privacy && (
							<EditPlaylistDialog
								title={title}
								description={description}
								privacy={privacy}
								onSave={(nextTitle, nextDescription, nextPrivacy) => {
									const previous = { title, description, privacy };
									setTitle(nextTitle);
									setDescription(nextDescription);
									setPrivacy(nextPrivacy);
									// The navigation rail names it too, and reads that name out of the store.
									updatePlaylist(id, { title: nextTitle, description: nextDescription, privacy: nextPrivacy });
									void window.neotune?.music
										.command({
											type: "playlist-update",
											playlistId: id,
											title: nextTitle,
											description: nextDescription,
											privacy: nextPrivacy,
										})
										.catch(() => {
											setTitle(previous.title);
											setDescription(previous.description);
											setPrivacy(previous.privacy);
											updatePlaylist(id, previous);
											toast.add({
												title: "Change rolled back",
												description: "YouTube Music rejected the edit.",
												type: "error",
											});
										});
								}}
							/>
						)}
						{header && <EntityMenu item={{ ...header, title, description, privacy }} />}
					</>
				}
			/>
			{find && (
				<div className="mb-4 flex items-center gap-2">
					<Input
						autoFocus
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Find in playlist"
						aria-label="Find in playlist"
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close playlist search"
						nativeButton={false}
						render={<Link to="/playlist/$id" params={{ id }} search={{ find: undefined }} />}
					>
						<X />
					</Button>
				</div>
			)}
			<TrackList
				tracks={visibleTracks}
				context={context}
				headers
				renderAction={(visibleIndex) => {
					const visibleTrack = visibleTracks[visibleIndex];
					const index = items.findIndex((item) => item.track === visibleTrack);
					return (
						<>
							<DropdownMenuItem disabled={index <= 0} onClick={() => move(index, -1)}>
								<MoveUp />
								Move up
							</DropdownMenuItem>
							<DropdownMenuItem disabled={index === items.length - 1} onClick={() => move(index, 1)}>
								<MoveDown />
								Move down
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									const item = items[index];
									if (!item) return;
									void mutate(
										items.filter((candidate) => candidate.itemId !== item.itemId),
										{ type: "playlist-remove", playlistId: id, itemIds: [item.itemId] }
									);
								}}
							>
								<Trash2 />
								Remove from playlist
							</DropdownMenuItem>
						</>
					);
				}}
			/>
		</div>
	);
}
