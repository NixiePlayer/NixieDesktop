import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { Link, useRouter } from "@tanstack/react-router";
import {
	Bookmark,
	BookmarkX,
	CircleMinus,
	Disc3,
	Download,
	Link2,
	ListEnd,
	ListPlus,
	ListStart,
	MoreHorizontal,
	Radio,
	Search,
	Shuffle,
	ThumbsDown,
	ThumbsUp,
	Trash2,
	User,
	UserMinus,
	UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { toast } from "#/components/ui/toast";
import { queryMusic } from "#/lib/api";
import type { AudioEngine } from "#/lib/audio-engine";
import { removePlaylist, saveToLibrary, setSubscribed, useHeld, usePlaylists } from "#/lib/library";
import { rate } from "#/lib/rating";
import { usePlayer } from "#/player";
import type { MusicEntity, MusicQuery, Playlist, PlaylistItem, Track } from "#/shared/contracts";
import {
	autoPlaylist,
	entityTitle,
	isAlbum,
	isArtist,
	isPlaylist,
	isPlaylistItem,
	isTrack,
	trackAlbumId,
	toTracks,
} from "#/shared/entities";

/** What a menu acts on. A playlist row wraps its song, and nothing here addresses the wrapper. */
type Subject = Exclude<MusicEntity, PlaylistItem>;
const unwrap = (item: MusicEntity): Subject => (isPlaylistItem(item) ? item.track : item);

/** `playlist-add` takes at most a hundred ids, which is also where `validateMusicCommand` cuts it off. */
const SAVE_LIMIT = 100;

/** Every command here can fail remotely or on disk, so menu actions share one report path. */
async function run(failure: string, work: () => Promise<unknown>, description = "YouTube Music would not do that.") {
	try {
		await work();
	} catch {
		toast.add({ title: failure, description, type: "error" });
	}
}

/**
 * The songs a menu command acts on. A song is its own list; anything that holds songs has to be
 * opened first, because a card or a shelf row carries nothing but the release itself.
 *
 * `pages` caps the walk, and everything that starts playback passes 1. Upstream hands back a hundred
 * rows at a time and a radio keeps handing back more, so the full walk is up to twenty sequential
 * round trips, which is a long time to hold the first note back and no time at all to hold a
 * download back. Only the commands that mean the whole list pay for the whole list.
 */
export async function tracksOf(item: Subject, pages = Number.POSITIVE_INFINITY): Promise<Track[]> {
	if (isTrack(item)) return [item];
	const type = isAlbum(item) ? "album" : isArtist(item) ? "artist" : "playlist";
	// A capped walk reads the held draw of a mix, which is the one on screen. A walk through the whole
	// list draws its own: it is about to follow the continuation, and a held page's token is spent.
	let page = await queryMusic({ type, id: item.id }, pages > 1);
	const tracks = toTracks(page.items);
	for (let fetched = 1; fetched < pages && page.continuation && tracks.length < 2000; fetched++) {
		page = await queryMusic({ type, id: item.id, continuation: page.continuation });
		tracks.push(...toTracks(page.items));
	}
	if (!tracks.length) throw new Error("No tracks");
	return tracks.slice(0, 2000);
}

/**
 * The collection currently being started, and the reason a second press on it does nothing. A
 * collection has to be opened before it can play, so the press and the first note are a round trip
 * apart, and pressing again in that gap used to stack a second open behind the first. Both then
 * landed, seconds apart, on different songs: a radio is a fresh order every time it is asked, so the
 * two opens do not even agree on which song is first, and playback jumped once per press.
 *
 * Held by id rather than as a plain flag, because pressing play on something *else* mid-start is a
 * change of mind and has to win. That race is the engine's, and its generation token already settles it.
 */
let starting: string | undefined;

/**
 * Start a collection playing, from a card, a page header or a shortcut. One page of it: the queue
 * `/album` and `/playlist` build from their own loaders is one page too, so this is what pressing
 * play there already queues, and it is the difference between a button that responds and one that
 * reads as dead.
 */
export async function playCollection(engine: AudioEngine, item: Subject, title = entityTitle(item)) {
	if (starting === item.id) return;
	starting = item.id;
	await run(`Could not play ${title}`, async () => {
		const tracks = await tracksOf(item, 1);
		await engine.play(tracks[0], tracks, {
			type: isAlbum(item) ? "album" : isArtist(item) ? "radio" : "playlist",
			id: item.id,
			title,
		});
	});
	if (starting === item.id) starting = undefined;
}

/**
 * Play a queue upstream built: an artist header's Shuffle or Mix, or the radio around one song. Held
 * by its playlist id for the same reason `playCollection` holds a collection's: upstream draws a
 * fresh order every time it is asked, so a second press while the first is in flight lands seconds
 * later on a different song.
 */
export async function playRadio(
	engine: AudioEngine,
	query: Extract<MusicQuery, { type: "radio" }>,
	context: { id?: string; title: string },
	failure = `Could not play ${context.title}`
) {
	const key = query.playlistId ?? query.id;
	if (starting === key) return;
	starting = key;
	await run(failure, async () => {
		const queue = (await queryMusic(query)).items.filter(isTrack);
		const [first] = queue;
		if (!first) throw new Error("No queue");
		await engine.play(first, queue, { type: "radio", id: context.id, title: context.title });
	});
	if (starting === key) starting = undefined;
}

/** Where the entity lives on the web player. A playlist id is stored with the `VL` browse prefix. */
function shareUrl(item: Subject): string {
	const base = "https://music.youtube.com";
	if (isTrack(item)) return `${base}/watch?v=${item.id}`;
	if (isArtist(item)) return `${base}/channel/${item.id}`;
	if (isAlbum(item)) return `${base}/browse/${item.id}`;
	return `${base}/playlist?list=${item.id.replace(/^VL/, "")}`;
}

/**
 * The menu body, identical whether it was opened from the `⋯` button or by right clicking the row.
 * Base UI's context menu is the same `Menu` underneath, so every part below works under either root.
 *
 * `extra` is for whoever owns the list the row is in: a playlist page adds reordering and removal,
 * which mean nothing anywhere else. `queueIndex` is what tells a row it is *in* the queue, since
 * removing from the queue addresses a position and not a track.
 */
function MenuItems({
	item,
	queueIndex,
	extra,
	downloaded,
}: {
	item: Subject;
	queueIndex?: number;
	extra?: ReactNode;
	downloaded?: boolean;
}) {
	const engine = usePlayer();
	const router = useRouter();
	// Auto-generated playlists are not places to put a song: upstream fills "Liked music" from the
	// thumbs and refuses an add to either of them.
	const playlists = usePlaylists().filter((playlist) => !autoPlaylist(playlist.id));
	// What the library holds, so the item names the state it is about to leave rather than always
	// offering to save something already saved.
	const held = useHeld(item.id);
	const track = isTrack(item) ? item : undefined;
	// A search row knows its release only by id, so the item opens on either.
	const albumId = track && trackAlbumId(track);
	const artist = isArtist(item) ? item : (isTrack(item) || isAlbum(item) ? item.artists : []).find((one) => one.id);
	// Only a release is held in the library. An artist is followed instead, and a song is liked.
	const savable = isAlbum(item) || isPlaylist(item);
	const deletable = isPlaylist(item) && !autoPlaylist(item.id);

	const shuffle = () =>
		run("Could not shuffle this", async () => {
			const tracks = await tracksOf(item);
			if (!engine.getSnapshot().playback.shuffle) engine.toggleShuffle();
			const first = tracks[Math.floor(Math.random() * tracks.length)];
			await engine.play(first, tracks, {
				type: isPlaylist(item) ? "playlist" : "album",
				id: item.id,
				title: entityTitle(item),
			});
		});

	const startRadio = () =>
		run("No radio for this", async () => {
			// One page: the seed is the first row, and the rest of the collection is not the queue here.
			const [seed] = await tracksOf(item, 1);
			if (!seed) throw new Error("No seed");
			await playRadio(engine, { type: "radio", id: seed.id }, { title: entityTitle(item) }, "No radio for this");
		});

	const enqueue = (position: "next" | "end") =>
		run("Not queued", async () => engine.enqueue(await tracksOf(item), position));

	const save = (playlist: Playlist) =>
		run(`Not added to ${playlist.title}`, async () => {
			// A library holds playlists nobody but their owner can edit, and nothing upstream marks which
			// ones those are, so being refused is a normal outcome rather than a fault worth hiding.
			const tracks = await tracksOf(item);
			await window.noctune?.music.command({
				type: "playlist-add",
				playlistId: playlist.id,
				trackIds: tracks.slice(0, SAVE_LIMIT).map((one) => one.id),
			});
			toast.add({ title: "Saved", description: `Added to ${playlist.title}.`, type: "success" });
			// The playlist now holds a song its cached page does not list.
			void router.invalidate();
		});

	// The store owns the state and reports a refusal; the toast here is what a closing menu leaves
	// behind, since the label it flipped is no longer on screen. The library page lists what changed.
	const toggleLibrary = async () => {
		if (await saveToLibrary(item.id, !held)) {
			toast.add({ title: held ? "Removed from library" : "Saved to library", type: "success" });
			void router.invalidate();
		}
	};

	const toggleSubscription = async () => {
		if (await setSubscribed(item.id, !held)) {
			toast.add({ title: held ? "Unsubscribed" : "Subscribed", type: "success" });
			void router.invalidate();
		}
	};

	const copyLink = () =>
		run("Could not copy the link", async () => {
			await navigator.clipboard.writeText(shareUrl(item));
			toast.add({ title: "Link copied", type: "success" });
		});

	const download = () =>
		run(
			"Not downloaded",
			async () => {
				const tracks = await tracksOf(item);
				const result = await window.noctune?.local.download({ tracks });
				if (result) {
					toast.add({
						title: result.saved === 1 ? "Saved for offline listening" : `${result.saved} tracks saved offline`,
						type: "success",
					});
					void router.invalidate();
				}
			},
			"The audio could not be stored for offline listening."
		);

	const removeDownload = () =>
		run(
			"Download not removed",
			async () => {
				await window.noctune?.local.removeDownload(item.id);
				toast.add({ title: "Removed from downloads", type: "success" });
				void router.invalidate();
			},
			"The offline copy could not be removed."
		);

	const deletePlaylist = () => {
		if (!deletable || !window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
		void run("Playlist not deleted", async () => {
			await window.noctune?.music.command({ type: "playlist-delete", playlistId: item.id });
			removePlaylist(item.id);
			toast.add({ title: "Playlist deleted", type: "success" });
			// Deleted from its own page, there is no page left to stand on.
			if (router.state.location.pathname === `/playlist/${item.id}`) void router.navigate({ to: "/library" });
			void router.invalidate();
		});
	};

	return (
		<DropdownMenuContent align="start" side="inline-end" alignOffset={0} sideOffset={0} className="w-56">
			<DropdownMenuGroup>
				{!track && !isArtist(item) && (
					<DropdownMenuItem onClick={() => void shuffle()}>
						<Shuffle />
						Shuffle play
					</DropdownMenuItem>
				)}
				{isPlaylist(item) && (
					<DropdownMenuItem render={<Link to="/playlist/$id" params={{ id: item.id }} search={{ find: true }} />}>
						<Search />
						Find in playlist
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onClick={() => void startRadio()}>
					<Radio />
					Start radio
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => void enqueue("next")}>
					<ListStart />
					Play next
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => void enqueue("end")}>
					<ListEnd />
					Add to queue
				</DropdownMenuItem>
				{queueIndex !== undefined && (
					<DropdownMenuItem onClick={() => engine.dequeue(queueIndex)}>
						<CircleMinus />
						Remove from queue
					</DropdownMenuItem>
				)}
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				{downloaded && track ? (
					<DropdownMenuItem variant="destructive" onClick={() => void removeDownload()}>
						<Trash2 />
						Remove download
					</DropdownMenuItem>
				) : !isArtist(item) ? (
					<DropdownMenuItem onClick={() => void download()}>
						<Download />
						Download
					</DropdownMenuItem>
				) : null}
				{/* The thumbs stay stateless: reading a rating costs a request per row, so only the player
				    bar, which shows them, pays for it. Whether the library holds something is free, since
				    the store already knows what the library pages listed and what this session saved. */}
				{track && (
					<>
						<DropdownMenuItem onClick={() => void rate(track.id, "like")}>
							<ThumbsUp />
							Add to liked songs
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void rate(track.id, "dislike")}>
							<ThumbsDown />
							Dislike
						</DropdownMenuItem>
					</>
				)}
				{savable && (
					<DropdownMenuItem onClick={() => void toggleLibrary()}>
						{held ? <BookmarkX /> : <Bookmark />}
						{held ? "Remove from library" : "Save to library"}
					</DropdownMenuItem>
				)}
				{isArtist(item) && (
					<DropdownMenuItem onClick={() => void toggleSubscription()}>
						{held ? <UserMinus /> : <UserPlus />}
						{held ? "Unsubscribe" : "Subscribe"}
					</DropdownMenuItem>
				)}
				{/* An artist is the one thing with no track list of its own worth saving: the page is releases
				    and a top-songs shelf, and "save the artist to a playlist" means nothing upstream. */}
				{!isArtist(item) && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<ListPlus />
							Save to playlist
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="max-w-64">
							{playlists.length ? (
								playlists.map((playlist) => (
									<DropdownMenuItem key={playlist.id} onClick={() => void save(playlist)}>
										<span className="truncate">{playlist.title}</span>
									</DropdownMenuItem>
								))
							) : (
								<DropdownMenuItem disabled>No playlists</DropdownMenuItem>
							)}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				{/* A link inside a menu item is fine where one inside the row is not: the popup is
				    portaled, so it is nobody's descendant. Both are omitted when upstream named a
				    release or an artist without identifying one, which leaves nowhere to go. */}
				{albumId && (
					<DropdownMenuItem render={<Link to="/album/$id" params={{ id: albumId }} />}>
						<Disc3 />
						Go to album
					</DropdownMenuItem>
				)}
				{artist && !isArtist(item) && (
					<DropdownMenuItem render={<Link to="/artist/$id" params={{ id: artist.id }} />}>
						<User />
						Go to artist
					</DropdownMenuItem>
				)}
				{(!isPlaylist(item) || item.privacy !== "private") && (
					<DropdownMenuItem onClick={() => void copyLink()}>
						<Link2 />
						Copy link
					</DropdownMenuItem>
				)}
			</DropdownMenuGroup>
			{deletable && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem variant="destructive" onClick={deletePlaylist}>
							<Trash2 />
							Delete playlist
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</>
			)}
			{extra && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>{extra}</DropdownMenuGroup>
				</>
			)}
		</DropdownMenuContent>
	);
}

/**
 * The row-level menu, the same one the player bar hangs off its now-playing track. Everything here is
 * either a local queue edit or one command upstream already accepts.
 */
export function TrackMenu({
	track,
	queueIndex,
	extra,
	className,
}: {
	track: Track;
	queueIndex?: number;
	extra?: ReactNode;
	className?: string;
}) {
	return <EntityMenu item={track} queueIndex={queueIndex} extra={extra} className={className} />;
}

/** The button-triggered menu for a complete entity, including page headers. */
export function EntityMenu({
	item,
	queueIndex,
	extra,
	className,
}: {
	item: MusicEntity;
	queueIndex?: number;
	extra?: ReactNode;
	className?: string;
}) {
	const entity = unwrap(item);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						className={className}
						aria-label={`Options for ${entityTitle(entity)}`}
						// The row underneath plays on click, and the menu is not a way of asking for that.
						onClick={(event) => event.stopPropagation()}
					/>
				}
			>
				<MoreHorizontal />
			</DropdownMenuTrigger>
			<MenuItems item={entity} queueIndex={queueIndex} extra={extra} />
		</DropdownMenu>
	);
}

/**
 * The same menu on right click (or a long press), which is where anyone coming from another player
 * reaches for it first. `render` makes the row or card itself the trigger rather than wrapping it in
 * one: a card sizes itself inside a flex shelf and a track row is its own grid, so an extra element
 * between them and their parent changes the layout.
 */
export function EntityContextMenu({
	item,
	queueIndex,
	extra,
	downloaded,
	children,
	...props
}: ContextMenuPrimitive.Trigger.Props & {
	item: MusicEntity;
	queueIndex?: number;
	extra?: ReactNode;
	downloaded?: boolean;
}) {
	const entity = unwrap(item);

	return (
		<ContextMenuPrimitive.Root>
			<ContextMenuPrimitive.Trigger {...props}>{children}</ContextMenuPrimitive.Trigger>
			<MenuItems item={entity} queueIndex={queueIndex} extra={extra} downloaded={downloaded} />
		</ContextMenuPrimitive.Root>
	);
}
