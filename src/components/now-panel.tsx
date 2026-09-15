import { Link } from "@tanstack/react-router";
import { Play, X } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "#/lib/format";
import { useMessages } from "#/lib/i18n";
import { heldLyrics, loadLyrics } from "#/lib/lyrics";
import { cn } from "#/lib/utils";
import { usePlayback, usePlaybackPosition, usePlayer } from "#/player";
import type { LyricsResult, QueueContext } from "#/shared/contracts";
import { artistNames } from "#/shared/entities";
import { EntityContextMenu, TrackMenu } from "./entity-menu";
import { Artwork, PlayingBars, TrackLink } from "./media";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export type PanelTab = "lyrics" | "queue";

export function NowPanel({
	tab,
	onTabChange,
	onClose,
}: {
	tab?: PanelTab;
	onTabChange: (tab: PanelTab) => void;
	onClose: () => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const m = useMessages();
	const [lyricsMounted, setLyricsMounted] = useState(tab === "lyrics");

	useEffect(() => {
		if (tab === "lyrics") setLyricsMounted(true);
	}, [tab]);

	return (
		<aside className={cn("border-border bg-sidebar flex w-96 flex-col border-l", !tab && "hidden")}>
			<div className="flex h-14 shrink-0 items-center justify-between px-3">
				<Tabs value={tab ?? "lyrics"} onValueChange={(value) => onTabChange(value as PanelTab)}>
					<TabsList variant="line">
						<TabsTrigger value="lyrics">{m.shell.lyrics}</TabsTrigger>
						<TabsTrigger value="queue">{m.shell.queue}</TabsTrigger>
					</TabsList>
				</Tabs>
				<Button variant="ghost" size="icon-sm" aria-label={m.shell.closePanel} onClick={onClose}>
					<X />
				</Button>
			</div>
			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
				{(lyricsMounted || tab === "lyrics") && (
					<div hidden={tab !== "lyrics"}>
						<LyricsPane active={tab === "lyrics"} scrollRef={scrollRef} />
					</div>
				)}
				{tab === "queue" && <QueuePane />}
			</div>
		</aside>
	);
}

function LyricsPane({ active, scrollRef }: { active: boolean; scrollRef: RefObject<HTMLDivElement | null> }) {
	const engine = usePlayer();
	const { playback } = usePlayback();
	const position = usePlaybackPosition();
	const m = useMessages();
	// undefined while the lookup is in flight, null once it came back empty
	const [lyrics, setLyrics] = useState<LyricsResult | null>();
	const activeRef = useRef<HTMLButtonElement>(null);
	const track = playback.currentTrack;

	const activeLine = useMemo(() => {
		if (!lyrics?.lines.length) return -1;
		return lyrics.lines.reduce((found, line, index) => (line.timeSeconds <= position ? index : found), -1);
	}, [lyrics, position]);

	useEffect(() => {
		// A held answer is drawn on this tick, so a track already looked up never passes through the skeleton.
		setLyrics(track && heldLyrics.get(track.id));
		// No provider holds lyrics for a spoken episode, so asking all three is three requests for nothing.
		if (!track || track.episode || heldLyrics.has(track.id)) return;
		let live = true;
		void loadLyrics(track).then((value) => {
			if (live) setLyrics(value ?? null);
		});
		return () => {
			live = false;
		};
	}, [track]);

	useEffect(() => {
		if (!active) return;
		if (activeLine < 0) scrollRef.current?.scrollTo({ top: 0 });
		else activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [active, activeLine, scrollRef]);

	if (!track) return <Empty title={m.shell.nothingPlaying} body={m.shell.startTrackForLyrics} />;
	if (track.episode) return <Empty title={m.shell.noLyrics} body={m.shell.episodeHasNoLyrics} />;
	if (lyrics === undefined) return <LyricsSkeleton />;
	if (lyrics?.instrumental) return <Empty title={m.shell.instrumental} body={m.shell.trackHasNoLyrics} />;
	if (!lyrics?.lines.length && !lyrics?.plainLyrics) {
		return <Empty title={m.shell.noLyrics} body={m.shell.noSourceHasLyrics} />;
	}

	return (
		<div className="flex flex-col gap-4 py-4">
			{lyrics.lines.length ? (
				lyrics.lines.map((line, index) => (
					<button
						key={`${line.timeSeconds}-${index}`}
						ref={index === activeLine ? activeRef : undefined}
						onClick={() => engine.seek(line.timeSeconds)}
						className={cn(
							"rounded text-left text-2xl leading-tight font-bold tracking-tight transition-colors",
							index === activeLine ? "text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground"
						)}
					>
						{line.text || "♪"}
					</button>
				))
			) : (
				// Only some sources time their lyrics. An untimed one still reads, it just has no line to
				// highlight and nowhere to seek to, so it renders as a block rather than as buttons.
				<p className="text-muted-foreground text-xl leading-relaxed font-semibold tracking-tight whitespace-pre-line">
					{lyrics.plainLyrics}
				</p>
			)}
			<p className="text-muted-foreground pt-4 text-xs">{lyrics.attribution ?? m.shell.lyricsBy(lyrics.source)}</p>
		</div>
	);
}

function LyricsSkeleton() {
	// ponytail: fixed widths, a real measure would need the lines we do not have yet
	return (
		<div className="flex flex-col gap-4 py-4">
			{[11, 9, 12, 8, 10, 7, 11, 9].map((width, index) => (
				<Skeleton key={index} className="h-6" style={{ width: `${width * 8}%` }} />
			))}
		</div>
	);
}

/**
 * The queue names where it came from, and an album or a playlist is the only context with a page of
 * its own: home, explore, library and search name a shelf or a query, and a radio has no page at all.
 */
function ContextLink({ context }: { context: QueueContext }) {
	if (!context.id || (context.type !== "album" && context.type !== "playlist")) return context.title;
	return (
		<Link
			to={context.type === "album" ? "/album/$id" : "/playlist/$id"}
			params={{ id: context.id }}
			// The queue's source, not a row in it: neither page has a track to mark or a filter to open.
			search={{ track: undefined, find: undefined }}
			className="text-foreground hover:underline"
		>
			{context.title}
		</Link>
	);
}

function QueuePane() {
	const engine = usePlayer();
	const { playback } = usePlayback();
	const m = useMessages();

	if (!playback.queue.length) return <Empty title={m.shell.queueEmpty} body={m.shell.queueEmptyBody} />;

	return (
		<div className="flex flex-col gap-1 py-2">
			{/* One line, so the list under it starts at the same place whatever the context is called and
			    whatever the language: "In riproduzione da" is half again the width of "Playing from", and a
			    wrapped caption pushes the whole queue down a line. */}
			{playback.context && (
				<p className="text-muted-foreground truncate px-2 pb-2 text-xs">
					{m.shell.playingFrom} <ContextLink context={playback.context} />
				</p>
			)}
			{playback.queue.map((track, index) => {
				const current = index === playback.queueIndex;
				return (
					<EntityContextMenu
						key={`${track.id}-${index}`}
						item={track}
						queueIndex={index}
						render={<div className="relative" />}
					>
						<div className="hover:bg-accent flex w-full items-center gap-3 rounded-lg p-2 pr-10 text-left transition-colors">
							<Button
								variant="ghost"
								size="icon-lg"
								aria-label={m.common.playTitle(track.title)}
								className="group/play relative p-0"
								onClick={() => void engine.play(track, playback.queue, playback.context)}
							>
								<Artwork src={track.artworkUrl} className="size-10" />
								<Play
									fill="currentColor"
									className="absolute opacity-0 drop-shadow group-hover/play:opacity-100 group-focus-visible/play:opacity-100"
								/>
							</Button>
							<span className="flex min-w-0 flex-1 flex-col">
								<TrackLink
									track={track}
									className={cn("truncate text-sm font-medium hover:underline", current && "text-primary")}
								/>
								<span className="text-muted-foreground truncate text-xs">{artistNames(track.artists)}</span>
							</span>
							{/* Fixed, because the two things that sit here are not the same width: three 2px bars where
							    the row is playing, a duration where it is not. Sized by its content, the title beside it
							    gained about 20px the moment the queue advanced onto a row, and re-truncated under the
							    reader. The width holds an episode's `180:00` as readily as a song's `3:45`. */}
							<span className="flex w-12 shrink-0 items-center justify-end">
								{current ? (
									<PlayingBars paused={playback.status !== "playing"} />
								) : (
									<span className="text-muted-foreground text-xs tabular-nums">
										{formatDuration(track.durationSeconds)}
									</span>
								)}
							</span>
						</div>
						<TrackMenu
							track={track}
							queueIndex={index}
							className="text-muted-foreground absolute top-1/2 right-1 -translate-y-1/2"
						/>
					</EntityContextMenu>
				);
			})}
		</div>
	);
}

function Empty({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<p className="text-sm font-medium">{title}</p>
			<p className="text-muted-foreground text-xs">{body}</p>
		</div>
	);
}
