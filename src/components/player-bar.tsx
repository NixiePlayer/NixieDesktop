import { Link } from "@tanstack/react-router";
import {
	ListMusic,
	Mic2,
	Pause,
	Play,
	Repeat,
	Repeat1,
	Shuffle,
	SkipBack,
	SkipForward,
	ThumbsDown,
	ThumbsUp,
	Volume1,
	Volume2,
	VolumeX,
} from "lucide-react";
import { Fragment, useState } from "react";
import { formatDuration } from "#/lib/format";
import { nextRating, rate, useRating } from "#/lib/rating";
import { usePlayback, usePlaybackPosition, usePlayer } from "#/player";
import type { Track } from "#/shared/contracts";
import { EntityContextMenu, TrackMenu } from "./entity-menu";
import { Artwork, TrackLink } from "./media";
import type { PanelTab } from "./now-panel";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const first = (value: number | readonly number[]) => (Array.isArray(value) ? (value[0] ?? 0) : (value as number));

/**
 * The progress line across the full window width, plus the hover affordances a bare Base UI
 * slider has no notion of: a dot at the pointer and the timestamp the click would land on.
 */
function SeekBar() {
	const engine = usePlayer();
	const { playback } = usePlayback();
	const position = usePlaybackPosition();
	const [hoverRatio, setHoverRatio] = useState<number>();
	// Held only while a drag is in flight, so the thumb tracks the pointer without the engine
	// receiving a seek per pixel. The committed value comes back through `position`.
	const [dragging, setDragging] = useState<number>();

	const track = playback.currentTrack;
	const duration = track?.durationSeconds ?? 0;
	const value = dragging ?? Math.min(position, duration);

	return (
		<div
			// A 2px line is neither a hover nor a click target, so the band around it is the one that
			// gets pointed at. No `items-center`: the slider must stretch to the full band height,
			// and its own Control centres the track inside that.
			className="group/seek absolute inset-x-0 -top-2 z-10 flex h-4 cursor-pointer"
			onPointerMove={(event) => {
				if (!track) return;
				const { left, width } = event.currentTarget.getBoundingClientRect();
				setHoverRatio(Math.min(Math.max((event.clientX - left) / width, 0), 1));
			}}
			onPointerLeave={() => setHoverRatio(undefined)}
		>
			<Slider
				value={[track ? value : 0]}
				max={Math.max(duration, 1)}
				step={1}
				disabled={!track}
				aria-label="Seek"
				aria-valuetext={formatDuration(value)}
				onValueChange={(next) => setDragging(first(next))}
				onValueCommitted={(next) => {
					engine.seek(first(next));
					setDragging(undefined);
				}}
				// Base UI puts the pointer handling on Control, whose box is only as tall as the track,
				// so without stretching it to the band a click one pixel off the line does nothing.
				// Control is the root's only child and carries no data-slot to aim at.
				className="[&_[data-slot=slider-track]]:bg-border [&_[data-slot=slider-thumb]]:bg-primary data-disabled:[&_[data-slot=slider-range]]:hidden [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-none [&_[data-slot=slider-thumb]]:opacity-0 group-hover/seek:[&_[data-slot=slider-thumb]]:opacity-100 [&_[data-slot=slider-track]]:h-0.5 [&_[data-slot=slider-track]]:rounded-none group-hover/seek:[&_[data-slot=slider-track]]:h-1 [&>div]:h-full"
			/>

			{hoverRatio !== undefined && (
				<>
					<span
						aria-hidden
						className="bg-primary pointer-events-none absolute size-3 -translate-x-1/2 rounded-full"
						style={{ left: `${hoverRatio * 100}%` }}
					/>
					<span
						aria-hidden
						className="bg-popover text-popover-foreground border-border pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded border px-1.5 py-0.5 text-xs tabular-nums shadow-md"
						style={{ left: `${hoverRatio * 100}%` }}
					>
						{formatDuration(hoverRatio * duration)}
					</span>
				</>
			)}
		</div>
	);
}

/**
 * The line under the title: every artist, then the album, each one a way back to the page it
 * came from. An entity with no id (some upstream rows carry only a name) stays plain text.
 */
function TrackLinks({ track }: { track: Track }) {
	const linkClass = "hover:text-foreground hover:underline";

	return (
		<span className="text-muted-foreground truncate text-xs">
			{track.artists.map((artist, index) => (
				<Fragment key={artist.id || artist.name}>
					{index > 0 && ", "}
					{artist.id ? (
						<Link to="/artist/$id" params={{ id: artist.id }} className={linkClass}>
							{artist.name}
						</Link>
					) : (
						artist.name
					)}
				</Fragment>
			))}
			{track.album && (
				<>
					{track.artists.length > 0 && " • "}
					<Link to="/album/$id" params={{ id: track.album.id }} search={{ track: track.id }} className={linkClass}>
						{track.album.title}
					</Link>
				</>
			)}
		</span>
	);
}

/**
 * The one place the rating is read rather than only written, because these two buttons are the only
 * thing on screen that states it. Clicking the lit thumb clears the rating.
 */
function Rating({ track }: { track: Track }) {
	const rating = useRating(track.id);
	const thumb = (control: "like" | "dislike", Icon: typeof ThumbsUp, label: string) => (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={label}
						aria-pressed={rating === control}
						className={control === "dislike" ? "aria-pressed:text-foreground" : undefined}
						onClick={() => void rate(track.id, nextRating(control, rating))}
					/>
				}
			>
				<Icon fill={rating === control ? "currentColor" : "none"} />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);

	return (
		<>
			{thumb("like", ThumbsUp, "Add to liked songs")}
			{thumb("dislike", ThumbsDown, "Dislike")}
		</>
	);
}

/**
 * The now playing block, and the one part of the bar that is about an entity rather than about
 * transport, so right clicking it opens the same menu its `⋯` does. `render` makes the block itself
 * the trigger rather than wrapping it in one, which would add an element inside the bar's grid
 * column; with nothing playing there is no subject for a menu, so the same block is drawn plain.
 */
function NowPlaying({ track, failure }: { track?: Track; failure?: string }) {
	const className = "flex min-w-0 items-center gap-3";
	const body = (
		<>
			<Artwork src={track?.artworkUrl} className="size-12" />
			<div className="flex min-w-0 flex-col">
				{track ? (
					<TrackLink track={track} className="truncate text-sm font-medium hover:underline" />
				) : (
					<span className="truncate text-sm font-medium">Nothing playing</span>
				)}
				{failure ? (
					<span className="text-destructive truncate text-xs" title={failure}>
						{failure}
					</span>
				) : track ? (
					<TrackLinks track={track} />
				) : (
					<span className="text-muted-foreground truncate text-xs">Pick something to start</span>
				)}
			</div>
			{/* `shrink-0` beside a `min-w-0` title block: the title gives up width first, these never do. */}
			{track && (
				<div className="flex shrink-0 items-center">
					<Rating track={track} />
					<TrackMenu track={track} />
				</div>
			)}
		</>
	);

	return track ? (
		<EntityContextMenu item={track} render={<div className={className} />}>
			{body}
		</EntityContextMenu>
	) : (
		<div className={className}>{body}</div>
	);
}

export function PlayerBar({
	panel,
	onPanelChange,
}: {
	panel?: PanelTab;
	onPanelChange: (tab: PanelTab | undefined) => void;
}) {
	const engine = usePlayer();
	const { playback } = usePlayback();
	const position = usePlaybackPosition();
	const track = playback.currentTrack;
	const duration = track?.durationSeconds ?? 0;
	const playing = playback.status === "playing" || playback.status === "loading";
	const failure = playback.status === "error" ? (playback.errorMessage ?? "Playback failed") : undefined;
	const VolumeIcon = playback.volume === 0 ? VolumeX : playback.volume < 0.5 ? Volume1 : Volume2;

	const togglePanel = (tab: PanelTab) => onPanelChange(panel === tab ? undefined : tab);

	return (
		<footer className="border-border bg-background relative col-span-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 border-t px-4">
			<SeekBar />

			<NowPlaying track={track} failure={failure} />

			<div className="flex items-center gap-2">
				<span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{formatDuration(position)}</span>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Shuffle"
								aria-pressed={playback.shuffle}
								onClick={() => engine.toggleShuffle()}
							/>
						}
					>
						<Shuffle />
					</TooltipTrigger>
					<TooltipContent>Shuffle</TooltipContent>
				</Tooltip>
				<Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={() => engine.previous()}>
					<SkipBack fill="currentColor" />
				</Button>
				<Button
					size="icon-lg"
					className="rounded-full"
					aria-label={playing ? "Pause" : "Play"}
					onClick={() => engine.toggle()}
				>
					{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => engine.next()}>
					<SkipForward fill="currentColor" />
				</Button>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Repeat: ${playback.repeat}`}
								aria-pressed={playback.repeat !== "off"}
								onClick={() => engine.cycleRepeat()}
							/>
						}
					>
						{playback.repeat === "one" ? <Repeat1 /> : <Repeat />}
					</TooltipTrigger>
					<TooltipContent>Repeat {playback.repeat}</TooltipContent>
				</Tooltip>
				<span className="text-muted-foreground w-10 text-xs tabular-nums">{formatDuration(duration)}</span>
			</div>

			<div className="flex items-center justify-end gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Lyrics"
					aria-pressed={panel === "lyrics"}
					onClick={() => togglePanel("lyrics")}
				>
					<Mic2 />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Queue"
					aria-pressed={panel === "queue"}
					onClick={() => togglePanel("queue")}
				>
					<ListMusic />
				</Button>
				<VolumeIcon className="text-muted-foreground ml-2 size-4 shrink-0" />
				{/* Same band as the seek line: a 4px track is neither a hover nor a click target, so the
				    box around it is the one that gets pointed at, and Control stretches to fill it. */}
				<div className="group/volume flex h-4 cursor-pointer">
					<Slider
						// Neutral fill, so the accent stays reserved for playback state.
						className="[&_[data-slot=slider-range]]:bg-foreground [&_[data-slot=slider-thumb]]:bg-foreground cursor-pointer data-horizontal:w-20 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:cursor-pointer [&_[data-slot=slider-thumb]]:border-none [&_[data-slot=slider-thumb]]:opacity-0 group-hover/volume:[&_[data-slot=slider-thumb]]:opacity-100 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:cursor-pointer [&>div]:h-full"
						// Edge alignment (the shadcn default) insets the thumb, which stops the fill half a
						// thumb short of the end at max. Centred, full volume fills the whole bar.
						thumbAlignment="center"
						value={[playback.volume]}
						min={0}
						max={1}
						step={0.01}
						aria-label="Volume"
						onValueChange={(value) => engine.setVolume(first(value))}
					/>
				</div>
			</div>
		</footer>
	);
}
