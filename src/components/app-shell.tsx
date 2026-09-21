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
import { heldSuggestions, queryMusic, rememberSearch } from "#/lib/api";
import { useMessages } from "#/lib/i18n";
import { usePlaylists } from "#/lib/library";
import { isMac } from "#/lib/platform";
import { swipeAbortDuration, swipeOffset, type SwipeHint, useHistoryEdges, useSwipeNavigation } from "#/lib/swipe-nav";
import { useUpdateState } from "#/lib/updates";
import { cn } from "#/lib/utils";
import { usePlayback, usePlayer, useSystemIntegration } from "#/player";
import type { AuthState, MusicEntity, Track } from "#/shared/contracts";
import {
	autoPlaylist,
	entityArtwork,
	entityKey,
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
	{ to: "/", label: "home", icon: Home },
	{ to: "/explore", label: "explore", icon: Compass },
	{ to: "/library", label: "library", icon: Library },
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
	const swipe = useSwipeNavigation();
	const engine = usePlayer();
	const router = useRouter();
	const navigate = useNavigate();
	useSystemIntegration();

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// The search accelerator is the platform's own and never both: Cmd is not a modifier a Windows
			// or Linux user reaches for, and Ctrl+K deletes to end of line in a macOS text field.
			const accelerator = isMac ? event.metaKey : event.ctrlKey;
			if (accelerator && event.key.toLowerCase() === "k") {
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
				return;
			}
			if (accelerator && event.key === ",") {
				event.preventDefault();
				void navigate({ to: "/settings" });
				return;
			}
			// History follows the platform's browser keys: Cmd+[ and Cmd+] on macOS, Alt+Arrow elsewhere.
			const back = isMac ? event.metaKey && event.key === "[" : event.altKey && event.key === "ArrowLeft";
			const forward = isMac ? event.metaKey && event.key === "]" : event.altKey && event.key === "ArrowRight";
			if (back || forward) {
				event.preventDefault();
				if (back) router.history.back();
				else router.history.forward();
				return;
			}
			const target = event.target as HTMLElement | null;

			// Next and previous are menu accelerators on macOS, and there is no menu off it, so the page
			// owns them there. A text field keeps Ctrl+Arrow, which is word navigation in one. The player
			// bar is in front of whoever pressed the key, so neither announces (the unwatched flag stays
			// false), exactly like the next and previous buttons.
			if (!isMac && event.ctrlKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
				const typing = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
				if (typing) return;
				event.preventDefault();
				if (event.key === "ArrowRight") engine.next();
				else engine.previous();
				return;
			}

			// Tab walking the chrome is not how a music app reads, so focus only moves inside a
			// dialog, where the form fields still need it and the focus trap owns the key.
			if (event.key === "Tab" && !target?.closest('[role="dialog"]')) {
				event.preventDefault();
				return;
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [engine, navigate, router]);

	return (
		<div className="bg-background grid h-full grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[3.5rem_minmax(0,1fr)_4.5rem]">
			<TopBar
				auth={auth}
				onAuthChange={onAuthChange}
				onToggleNav={() => setNavOpen((open) => !open)}
				searchRef={searchRef}
			/>
			<NavRail open={navOpen && (wide || !panel)} />
			{/* Clip the swipe arrow to the page column, excluding the rail and Now panel. */}
			<div className="relative min-h-0">
				<main id="main-scrollable-area" className="h-full overflow-y-auto">
					<div className="w-full px-6 py-6">
						<Outlet />
					</div>
				</main>
				<SwipeArrow hint={swipe} />
			</div>
			<NowPanel tab={panel} onTabChange={setPanel} onClose={() => setPanel(undefined)} />
			<PlayerBar panel={panel} onPanelChange={setPanel} />
		</div>
	);
}

function SwipeArrow({ hint }: { hint: SwipeHint | undefined }) {
	if (!hint) return null;
	const back = hint.direction === -1;
	const offset = hint.phase === "aborting" ? 0 : swipeOffset(hint.progress);
	const duration = hint.phase === "completing" ? 200 : swipeAbortDuration(hint.progress);
	const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
			<div
				className={cn("absolute top-1/2 size-24", back ? "-left-17" : "-right-17")}
				style={{
					opacity: hint.phase === "completing" ? 0 : 1,
					transform: `translateY(-50%) translateX(${(back ? 1 : -1) * offset}px)`,
					transition: reduceMotion
						? "none"
						: hint.phase === "aborting"
							? `transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
							: hint.phase === "completing"
								? "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)"
								: undefined,
				}}
			>
				<div
					className="bg-primary/30 absolute top-1/2 left-1/2 rounded-full"
					style={{
						width: hint.phase === "completing" ? 96 : 80,
						height: hint.phase === "completing" ? 96 : 80,
						transform: `translate(-50%, -50%) scale(${hint.phase === "aborting" ? 0.5 : 0.5 + Math.min(1, hint.progress) * 0.5})`,
						transition:
							reduceMotion || hint.phase === "tracking"
								? undefined
								: `width ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), height ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`,
					}}
				/>
				<div
					className={cn(
						"absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-[0_2px_8px_rgb(0_0_0/0.3)]",
						hint.armed ? "bg-primary text-primary-foreground" : "bg-background text-primary"
					)}
				>
					{back ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
				</div>
			</div>
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
	const m = useMessages();
	const edges = useHistoryEdges();

	return (
		<header className="drag-region window-controls-inset border-border col-span-3 flex items-center gap-2 border-b">
			{/* macOS overlays its traffic lights on the hiddenInset title bar, outside the page, so they
			    cannot be measured from here and the padding is fixed. Windows and Linux draw the controls
			    into the page, and window-controls-inset clears them from whichever edge they sit on. */}
			<div className="mac:pl-20 flex flex-1 items-center gap-1">
				<Button variant="ghost" size="icon-sm" aria-label={m.shell.toggleNavigation} onClick={onToggleNav}>
					<PanelLeft />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={m.shell.goBack}
					disabled={!edges.back}
					onClick={() => router.history.back()}
				>
					<ChevronLeft />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={m.shell.goForward}
					disabled={!edges.forward}
					onClick={() => router.history.forward()}
				>
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
	const m = useMessages();
	const name = auth.accountName ?? m.shell.signedIn;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="ghost" size="icon" className="rounded-full" aria-label={m.shell.account(name)} />}
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
			{/* Sized here rather than off the trigger, which is a round avatar: the menu would otherwise be
			    the width of that button, and every item in it would wrap at its own length. */}
			<DropdownMenuContent align="end" className="w-56">
				{/* Base UI requires GroupLabel to sit inside a Group. */}
				<DropdownMenuGroup>
					<DropdownMenuLabel>{name}</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						engine.pause();
						void window.nixie?.auth.signOut().then(onAuthChange);
					}}
				>
					<LogOut />
					{m.shell.signOut}
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
	const m = useMessages();

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
				<Link key={item.to} to={item.to} className={itemClass} title={open ? undefined : m.shell[item.label]}>
					<item.icon className="size-5 shrink-0" />
					{open && <span className="truncate">{m.shell[item.label]}</span>}
				</Link>
			))}

			<hr className="border-border my-2" />

			<div className={cn("flex items-center gap-1", !open && "justify-center")}>
				{open && <span className="text-muted-foreground flex-1 px-3 text-xs font-medium">{m.common.playlists}</span>}
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
							<span className="truncate">{entityTitle(playlist, m)}</span>
							{/* Whoever made it, or the label for the two nobody did. */}
							<span className="text-muted-foreground truncate text-xs font-normal">
								{playlist.author ?? autoPlaylist(playlist.id, m)?.author}
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

			<Link to="/settings" className={cn(itemClass, "mt-auto")} title={open ? undefined : m.shell.settings}>
				<span className="relative shrink-0">
					<Settings className="size-5" />
					{ready && (
						<>
							{/* What is left once the toast is dismissed: the About row is where the restart is. */}
							<span className="bg-primary border-sidebar absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2" />
							<span className="sr-only">{m.shell.updateReady}</span>
						</>
					)}
				</span>
				{open && <span className="truncate">{m.shell.settings}</span>}
			</Link>
		</nav>
	);
}

/**
 * Suggestion rows are held by trimmed query (`heldSuggestions`), so backspacing onto a query already
 * typed redraws its rows on the same keystroke instead of blanking to a round trip. Only an answer is
 * held: a rejected request never reaches the `then` that writes it, so the next keystroke asks again.
 * ponytail: a minute of life and fifty entries, no revalidation. Upstream's preview barely moves
 * inside a minute; give it a stale-while-revalidate pass if it ever reads as out of date.
 */
const suggestions = heldSuggestions;
const SUGGESTION_LIMIT = 50;
const SUGGESTION_LIFE_MS = 60_000;

/**
 * Results land in a dropdown under the input rather than behind a dialog, so the page you were
 * on stays visible. cmdk supplies the arrow-key and Enter handling; it must not filter, because
 * the rows are whatever YouTube returned for the query, not a local list.
 */
function SearchField({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
	const engine = usePlayer();
	const navigate = useNavigate();
	const m = useMessages();
	const [draft, setDraft] = useState("");
	const [open, setOpen] = useState(false);
	const [results, setResults] = useState<MusicEntity[]>([]);

	const query = draft.trim();

	useEffect(() => {
		if (query.length < 2) {
			setResults([]);
			return;
		}
		const held = suggestions.get(query);
		if (held && Date.now() - held.at < SUGGESTION_LIFE_MS) {
			setResults(held.items);
			return;
		}
		let current = true;
		const timer = window.setTimeout(() => {
			void queryMusic({ type: "suggestions", query }).then((page) => {
				const items = page.items.slice(0, 6);
				// Re-inserted so the Map's insertion order stays oldest first, which is what the cap evicts.
				suggestions.delete(query);
				suggestions.set(query, { at: Date.now(), items });
				const oldest = suggestions.keys().next().value;
				if (suggestions.size > SUGGESTION_LIMIT && oldest !== undefined) suggestions.delete(oldest);
				if (current) setResults(items);
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
			if (id) void navigate({ to: "/album/$id", params: { id }, search: { track: track.id } });
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
					placeholder={m.shell.searchPlaceholder}
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
								{/* One line whatever the query and whatever the language: the dropdown is the width of the
								    field above it, so a wrapped row is a row of a different height, and every row under it
								    moves. Italian states this in half again as many characters as English does. */}
								<span className="truncate">{m.shell.seeAllResults(query)}</span>
							</CommandItem>
							{results.length > 0 && (
								<CommandGroup heading={m.shell.results}>
									{results.map((item) => {
										const track = isPlaylistItem(item) ? item.track : isTrack(item) ? item : undefined;
										return (
											<CommandItem
												key={entityKey(item)}
												value={`r:${entityKey(item)}`}
												onSelect={() => openEntity(item)}
											>
												<div className="relative shrink-0">
													<Artwork src={entityArtwork(item)} round={isArtist(item)} className="size-8 rounded-sm" />
													{track && (
														<Button
															size="icon-xs"
															aria-label={m.common.playTitle(track.title)}
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
													<span className="truncate">{entityTitle(item, m)}</span>
													<span className="text-muted-foreground truncate text-xs">
														{entityKind(item, m)}
														{entitySubtitle(item, m) !== entityKind(item, m) &&
															entitySubtitle(item, m) &&
															` • ${entitySubtitle(item, m)}`}
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
