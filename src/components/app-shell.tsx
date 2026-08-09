import { Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import {
	ChevronLeft,
	ChevronRight,
	Compass,
	Home,
	Library,
	LogOut,
	PanelLeft,
	Play,
	Search,
	Settings,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { queryMusic, rememberSearch } from "#/lib/api";
import { usePlaylists } from "#/lib/library";
import { useUpdateState } from "#/lib/updates";
import { cn } from "#/lib/utils";
import { usePlayback, usePlayer, useSystemIntegration } from "#/player";
import type { AuthState, MusicEntity, Track } from "#/shared/contracts";
import {
	autoPlaylist,
	entityArtwork,
	entityKind,
	entitySubtitle,
	entityTitle,
	isArtist,
	isPlaylistItem,
	isTrack,
	trackAlbumId,
} from "#/shared/entities";
import { EntityContextMenu } from "./entity-menu";
import { Artwork, entityRoute, PlayingBars } from "./media";
import { NowPanel, type PanelTab } from "./now-panel";
import { PlayerBar } from "./player-bar";
import { NewPlaylistDialog } from "./playlist-dialog";
import { Button } from "./ui/button";
import { CommandGroup, CommandItem, CommandList } from "./ui/command";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

// Search lives in the top bar, so the rail carries Explore instead, the way YouTube Music does.
const navigation = [
	{ to: "/", label: "Home", icon: Home },
	{ to: "/explore", label: "Explore", icon: Compass },
	{ to: "/library", label: "Library", icon: Library },
] as const;

/**
 * The rail's labels are the only width in the shell worth taking back. The Now panel is anchored to
 * the same edge the page column ends at, so floating it over the page frees nothing a reader can
 * see: it only lets what they were reading hide underneath. The labels cost 160px that is genuinely
 * returned, and only while the panel is open, since a small window on its own has room for both.
 *
 * Collapsing the rail is a step *up* in page width, so the number is chosen to keep that step from
 * landing across one of `/settings`' own container breakpoints, which would un-stack a row or bring
 * a label back as the window gets smaller. The page column is `width - 448 - 48` once the rail is
 * icons, and the narrower of those breakpoints is 512, so anything from 1008px up reverses; 960
 * leaves the step ending at 464 rather than a few pixels short of the edge.
 */
const RAIL_LABELS = "(width >= 960px)";

function useRailLabels() {
	const [wide, setWide] = useState(() => window.matchMedia(RAIL_LABELS).matches);
	useEffect(() => {
		const query = window.matchMedia(RAIL_LABELS);
		const update = () => setWide(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return wide;
}

export function AppShell({ auth, onAuthChange }: { auth: AuthState; onAuthChange: (auth: AuthState) => void }) {
	const [navOpen, setNavOpen] = useState(true);
	const [panel, setPanel] = useState<PanelTab | undefined>();
	const searchRef = useRef<HTMLInputElement>(null);
	const wide = useRailLabels();
	useSystemIntegration();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey && event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
				return;
			}
			const target = event.target as HTMLElement | null;

			// Tab walking the chrome is not how a music app reads, so focus only moves inside a
			// dialog, where the form fields still need it and the focus trap owns the key.
			if (event.key === "Tab" && !target?.closest('[role="dialog"]')) {
				event.preventDefault();
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);

	return (
		<div className="bg-background grid h-full grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[3.5rem_minmax(0,1fr)_4.5rem]">
			<TopBar
				auth={auth}
				onAuthChange={onAuthChange}
				onToggleNav={() => setNavOpen((open) => !open)}
				searchRef={searchRef}
			/>
			<NavRail open={navOpen && (wide || !panel)} />
			<main id="main-scrollable-area" className="overflow-y-auto">
				<div className="w-full px-6 py-6">
					<Outlet />
				</div>
			</main>
			<NowPanel tab={panel} onTabChange={setPanel} onClose={() => setPanel(undefined)} />
			<PlayerBar panel={panel} onPanelChange={setPanel} />
		</div>
	);
}

function TopBar({
	auth,
	onAuthChange,
	onToggleNav,
	searchRef,
}: {
	auth: AuthState;
	onAuthChange: (auth: AuthState) => void;
	onToggleNav: () => void;
	searchRef: React.RefObject<HTMLInputElement | null>;
}) {
	const router = useRouter();

	return (
		<header className="drag-region border-border col-span-3 flex items-center gap-2 border-b px-3">
			{/* pl-20 clears the macOS traffic lights, which overlay the hiddenInset title bar. */}
			<div className="flex flex-1 items-center gap-1 pl-20">
				<Button variant="ghost" size="icon-sm" aria-label="Toggle navigation" onClick={onToggleNav}>
					<PanelLeft />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Go back" onClick={() => router.history.back()}>
					<ChevronLeft />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Go forward" onClick={() => router.history.forward()}>
					<ChevronRight />
				</Button>
			</div>
			<SearchField inputRef={searchRef} />
			<div className="flex flex-1 justify-end">
				<AccountMenu auth={auth} onAuthChange={onAuthChange} />
			</div>
		</header>
	);
}

function AccountMenu({ auth, onAuthChange }: { auth: AuthState; onAuthChange: (auth: AuthState) => void }) {
	const engine = usePlayer();
	const name = auth.accountName ?? "Signed in";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account: ${name}`} />}
			>
				{auth.avatarUrl ? (
					<img src={auth.avatarUrl} alt="" className="size-7 rounded-full object-cover" />
				) : (
					// ponytail: no avatar until the adapter reports one, so the generic icon stands in.
					<span className="bg-muted text-muted-foreground flex size-7 items-center justify-center rounded-full">
						<User className="size-4" />
					</span>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{/* Base UI requires GroupLabel to sit inside a Group. */}
				<DropdownMenuGroup>
					<DropdownMenuLabel>{name}</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						engine.pause();
						void window.neotune?.auth.signOut().then(onAuthChange);
					}}
				>
					<LogOut />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NavRail({ open }: { open: boolean }) {
	// The same list the "Save to playlist" submenu offers, so a playlist created, renamed or deleted
	// anywhere shows here without either side knowing about the other.
	const playlists = usePlaylists();
	// The rail is also what starts the renderer's half of the updater, since it outlives every page.
	const ready = useUpdateState().status === "ready";
	const { playback } = usePlayback();

	const itemClass =
		"flex h-10 items-center gap-4 rounded-lg px-3 text-sm transition-colors hover:bg-accent data-[status=active]:bg-accent data-[status=active]:font-medium";

	return (
		<nav
			className={cn(
				"flex flex-col gap-1 overflow-y-auto border-r border-border bg-sidebar p-2 transition-[width]",
				open ? "w-56" : "w-16"
			)}
		>
			{navigation.map((item) => (
				<Link key={item.to} to={item.to} className={itemClass} title={open ? undefined : item.label}>
					<item.icon className="size-5 shrink-0" />
					{open && <span className="truncate">{item.label}</span>}
				</Link>
			))}

			<hr className="border-border my-2" />

			<div className={cn("flex items-center gap-1", !open && "justify-center")}>
				{open && <span className="text-muted-foreground flex-1 px-3 text-xs font-medium">Playlists</span>}
				<NewPlaylistDialog />
			</div>

			{open &&
				playlists.map((playlist) => (
					<EntityContextMenu
						key={playlist.id}
						item={playlist}
						render={
							<Link
								to="/playlist/$id"
								params={{ id: playlist.id }}
								search={{ find: undefined }}
								className={cn(itemClass, "h-12 gap-3")}
							/>
						}
					>
						<Artwork src={entityArtwork(playlist)} className="size-8 rounded-sm" />
						<span className="flex min-w-0 flex-col">
							<span className="truncate">{playlist.title}</span>
							{/* Whoever made it, or the label for the two nobody did. */}
							<span className="text-muted-foreground truncate text-xs font-normal">
								{playlist.author ?? autoPlaylist(playlist.id)?.author}
							</span>
						</span>
						{/* Which row the queue came from, which is the queue's own context and not the track on it:
						    the same song sits in several playlists, and a radio or an album can be playing a song
						    this playlist also holds, so a track-id test would light the wrong row, or several. The
						    context carries the id `/playlist/$id` was opened with, which is the id this row links
						    with, so there is nothing to normalize between them. The margin is on the wrapper rather
						    than on the bars, since `PlayingBars` takes no class and this is its only caller that
						    needs one. */}
						{playback.context?.type === "playlist" && playback.context.id === playlist.id && playback.currentTrack && (
							<span className="ml-auto shrink-0 pl-2">
								<PlayingBars paused={playback.status !== "playing"} />
							</span>
						)}
					</EntityContextMenu>
				))}

			<Link to="/settings" className={cn(itemClass, "mt-auto")} title={open ? undefined : "Settings"}>
				<span className="relative shrink-0">
					<Settings className="size-5" />
					{ready && (
						<>
							{/* What is left once the toast is dismissed: the About row is where the restart is. */}
							<span className="bg-primary border-sidebar absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2" />
							<span className="sr-only">Update ready</span>
						</>
					)}
				</span>
				{open && <span>Settings</span>}
			</Link>
		</nav>
	);
}

/**
 * Results land in a dropdown under the input rather than behind a dialog, so the page you were
 * on stays visible. cmdk supplies the arrow-key and Enter handling; it must not filter, because
 * the rows are whatever YouTube returned for the query, not a local list.
 */
function SearchField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
	const engine = usePlayer();
	const navigate = useNavigate();
	const [draft, setDraft] = useState("");
	const [open, setOpen] = useState(false);
	const [results, setResults] = useState<MusicEntity[]>([]);

	const query = draft.trim();

	useEffect(() => {
		if (query.length < 2) {
			setResults([]);
			return;
		}
		let current = true;
		const timer = window.setTimeout(() => {
			void queryMusic({ type: "suggestions", query }).then((page) => {
				if (current) setResults(page.items.slice(0, 6));
			});
		}, 180);
		return () => {
			current = false;
			window.clearTimeout(timer);
		};
	}, [query]);

	const seeAll = (value: string) => {
		if (!value) return;
		setOpen(false);
		inputRef.current?.blur();
		void rememberSearch(value);
		void navigate({ to: "/search", search: { q: value, filter: "all" } });
	};

	const openEntity = (item: MusicEntity) => {
		setOpen(false);
		inputRef.current?.blur();
		void rememberSearch(query);
		if (isPlaylistItem(item) || isTrack(item)) {
			const track = isPlaylistItem(item) ? item.track : item;
			const id = trackAlbumId(track);
			if (id) void navigate({ to: "/album/$id", params: { id } });
			return;
		}
		void navigate({ to: entityRoute(item), params: { id: item.id } });
	};

	const play = (track: Track) => void engine.play(track, [track], { type: "search", title: query });

	return (
		// The generated `Command` root paints itself as a popover and clips overflow, so the raw
		// cmdk primitive is the root here and only the panel parts come from the ui module.
		<CommandPrimitive
			shouldFilter={false}
			className="relative max-w-md flex-1"
			onKeyDown={(event) => {
				if (event.key === "Escape") setOpen(false);
			}}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
			}}
		>
			<div className="border-border focus-within:border-ring flex h-9 items-center gap-2 rounded-full border px-4 transition-colors">
				<Search className="text-muted-foreground size-4 shrink-0" />
				<CommandPrimitive.Input
					ref={inputRef}
					value={draft}
					onValueChange={(value) => {
						setDraft(value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					placeholder="Search songs, albums, and artists"
					className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-hidden"
				/>
			</div>

			{open &&
				query.length > 0 && (
					// Preventing the default mousedown keeps focus in the input, so the blur above does
					// not tear the panel down before a click on a row registers.
					<div
						onMouseDown={(event) => event.preventDefault()}
						className="bg-popover text-popover-foreground border-border absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border p-1 shadow-lg"
					>
						<CommandList>
							<CommandItem value="see-all" onSelect={() => seeAll(query)}>
								<Search />
								See all results for &ldquo;{query}&rdquo;
							</CommandItem>
							{results.length > 0 && (
								<CommandGroup heading="Results">
									{results.map((item) => {
										const track = isPlaylistItem(item) ? item.track : isTrack(item) ? item : undefined;
										return (
											<CommandItem
												key={"track" in item ? item.itemId : item.id}
												value={`r:${"track" in item ? item.itemId : item.id}`}
												onSelect={() => openEntity(item)}
											>
												<div className="relative shrink-0">
													<Artwork src={entityArtwork(item)} round={isArtist(item)} className="size-8 rounded-sm" />
													{track && (
														<Button
															size="icon-xs"
															aria-label={`Play ${track.title}`}
															className="absolute inset-0 m-auto rounded-full opacity-0 group-hover/command-item:opacity-100 focus-visible:opacity-100"
															onClick={(event) => {
																event.stopPropagation();
																play(track);
															}}
														>
															<Play fill="currentColor" />
														</Button>
													)}
												</div>
												<span className="flex min-w-0 flex-col">
													<span className="truncate">{entityTitle(item)}</span>
													<span className="text-muted-foreground truncate text-xs">
														{entityKind(item)}
														{entitySubtitle(item) !== entityKind(item) &&
															entitySubtitle(item) &&
															` • ${entitySubtitle(item)}`}
													</span>
												</span>
											</CommandItem>
										);
									})}
								</CommandGroup>
							)}
						</CommandList>
					</div>
				)}
		</CommandPrimitive>
	);
}
