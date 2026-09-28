import { Link } from "@tanstack/react-router";
import { Play, X } from "lucide-react";
import { memo, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AudioEngine } from "#/lib/audio-engine";
import { formatDuration } from "#/lib/format";
import { useMessages } from "#/lib/i18n";
import { heldLyrics, loadLyrics } from "#/lib/lyrics";
import { cn } from "#/lib/utils";
import { usePlayback, usePlaybackPosition, usePlayer } from "#/player";
import type { LyricsLine, LyricsResult, LyricsWord, QueueContext } from "#/shared/contracts";
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
	const m = useMessages();
	// undefined while the lookup is in flight, null once it came back empty
	const [lyrics, setLyrics] = useState<LyricsResult | null>();
	const track = playback.currentTrack;
	const time = useLyricsTime(active && playback.status === "playing" && Boolean(lyrics?.lines.length));
	const activeLine = lyrics?.lines.length
		? lyrics.lines.reduce((found, line, index) => (line.timeSeconds <= time ? index : found), -1)
		: -1;

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
		else scrollRef.current?.querySelector("[data-current]")?.scrollIntoView({ block: "center", behavior: "smooth" });
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
					<Lyric
						key={`${line.timeSeconds}-${index}`}
						line={line}
						current={index === activeLine}
						// Only the current line moves, so every other one gets a constant and skips the frame.
						time={index === activeLine ? time : 0}
						engine={engine}
					/>
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

/**
 * The playhead once a frame while `running`, which is what moves the word highlight and the break
 * dots smoothly, and the ordinary four-a-second position otherwise, so a paused or hidden pane spends
 * no frames. A layout effect, so the first frame after a resume is not drawn at a stale time.
 */
function useLyricsTime(running: boolean) {
	const engine = usePlayer();
	const position = usePlaybackPosition();
	const [time, setTime] = useState(0);

	useLayoutEffect(() => {
		if (!running) return;
		let frame = 0;
		const tick = () => {
			setTime(engine.getLivePosition());
			frame = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(frame);
	}, [running, engine]);

	return running ? time : position;
}

const Lyric = memo(function Lyric({
	line,
	current,
	time,
	engine,
}: {
	line: LyricsLine;
	current: boolean;
	time: number;
	engine: AudioEngine;
}) {
	const tone = current ? "text-foreground" : "text-muted-foreground/60";
	if (!line.text && !line.background) return <Break line={line} current={current} time={time} tone={tone} />;

	// The words are drawn one by one only while they are being sung; any other line is its plain text.
	const words = current ? line.words : undefined;
	return (
		<button
			data-current={current || undefined}
			onClick={() => engine.seek(line.timeSeconds)}
			className={cn(
				"flex flex-col items-start gap-1 rounded text-left transition-colors",
				tone,
				!current && "hover:text-muted-foreground"
			)}
		>
			{line.text && (
				<span className="text-2xl leading-tight font-bold tracking-tight">
					{words ? <Words words={words.filter((word) => !word.background)} time={time} /> : line.text}
				</span>
			)}
			{line.background && (
				<span className="text-base leading-snug font-semibold">
					{words ? <Words words={words.filter((word) => word.background)} time={time} /> : line.background}
				</span>
			)}
		</button>
	);
});

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);

/**
 * Each word fills from the left over the time it is sung. The lit edge is feathered over a fifth of
 * the word, so it starts off the left side and ends exactly at the right one.
 */
function Words({ words, time }: { words: LyricsWord[]; time: number }) {
	return words.map((word, index) => {
		const edge = clamp((time - word.startSeconds) / Math.max(word.endSeconds - word.startSeconds, 0.01)) * 120 - 20;
		return (
			<span
				key={index}
				className="bg-clip-text text-transparent"
				style={{
					backgroundImage: `linear-gradient(to right, var(--foreground) ${edge}%, color-mix(in oklab, var(--muted-foreground) 60%, transparent) ${edge + 20}%)`,
				}}
			>
				{word.text}
			</span>
		);
	});
}

/** An instrumental break: three dots that light one after the other until the next line comes in. */
function Break({ line, current, time, tone }: { line: LyricsLine; current: boolean; time: number; tone: string }) {
	const length = (line.endSeconds ?? line.timeSeconds) - line.timeSeconds;
	const progress = current && length > 0 ? clamp((time - line.timeSeconds) / length) : 0;
	return (
		<div data-current={current || undefined} aria-hidden className={cn("flex gap-2 py-2 transition-colors", tone)}>
			{[0, 1, 2].map((dot) => (
				<span
					key={dot}
					className="size-3 rounded-full bg-current"
					style={{ opacity: current ? 0.3 + 0.7 * clamp(progress * 3 - dot) : 1 }}
				/>
			))}
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
