import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createAudioEngine, type AudioEngine, type EngineState } from "#/lib/audio-engine";
import { artistNames } from "#/shared/entities";

export type PlayerContextValue = AudioEngine;

// A module-level singleton, because `createMediaElementSource` may be called only once per
// element for the lifetime of the process and StrictMode mounts effects twice.
let singleton: AudioEngine | undefined;
const getEngine = () => (singleton ??= createAudioEngine());

const PlayerContext = createContext<AudioEngine | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
	const engine = getEngine();

	useEffect(() => {
		void engine.start();
	}, [engine]);

	useEffect(() => {
		if (!window.noctune) return;
		return window.noctune.player.onMediaCommand((command) => {
			void engine.start().then(() => {
				if (command.type === "play") void engine.play();
				if (command.type === "pause") engine.pause();
				if (command.type === "toggle") engine.toggle();
				if (command.type === "next") engine.next();
				if (command.type === "previous") engine.previous();
				if (command.type === "seek" && command.positionSeconds !== undefined) engine.seek(command.positionSeconds);
			});
		});
	}, [engine]);

	useEffect(() => {
		if (!("mediaSession" in navigator)) return;
		navigator.mediaSession.setActionHandler("play", () => void engine.play());
		navigator.mediaSession.setActionHandler("pause", () => engine.pause());
		navigator.mediaSession.setActionHandler("nexttrack", () => engine.next());
		navigator.mediaSession.setActionHandler("previoustrack", () => engine.previous());
	}, [engine]);

	return <PlayerContext.Provider value={engine}>{children}</PlayerContext.Provider>;
}

/** Stable engine reference. Consuming it alone never causes a re-render. */
export function usePlayer(): AudioEngine {
	const engine = useContext(PlayerContext);
	if (!engine) throw new Error("usePlayer must be used inside PlayerProvider");
	return engine;
}

export function usePlayback(): EngineState {
	const engine = usePlayer();
	return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}

/**
 * Position updates land about four times a second, so they get their own channel and only
 * the seek row, the clock, and the lyrics highlight subscribe to them.
 */
export function usePlaybackPosition(): number {
	const engine = usePlayer();
	return useSyncExternalStore(engine.subscribePosition, engine.getPosition);
}

/**
 * Chromium downloads Now Playing artwork itself rather than reusing the page's copy, and it does not
 * resolve the `noctune:` scheme, so the cover goes over as a data URL. The size is measured rather than
 * claimed: an entry stating none scores as sizeless and can lose the selection to nothing at all.
 */
async function artworkImage(url: string): Promise<MediaImage> {
	const blob = await (await fetch(url)).blob();
	const bitmap = await createImageBitmap(blob);
	const sizes = `${bitmap.width}x${bitmap.height}`;
	bitmap.close();
	const src = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
		reader.addEventListener("error", () => reject(reader.error), { once: true });
		reader.readAsDataURL(blob);
	});
	return { src, sizes, type: blob.type };
}

/** The last cover fetched, so replaying the write on a status change costs no round trip. */
let lastArtwork: { url: string; image: MediaImage } | undefined;

/** Keeps the macOS Now Playing widget in step with the app. */
export function useSystemIntegration() {
	const { playback } = usePlayback();
	const track = playback.currentTrack;
	// Chromium builds the Now Playing entry when a deck actually starts playing, and a write that
	// landed before that moment is not what it reads: the widget then names the application instead
	// of the song. `currentTrack` is set while the track is still resolving, and a resume or a
	// restored session never changes it at all, so the write is replayed once playback is live.
	const playing = playback.status === "playing";

	useEffect(() => {
		if (!("mediaSession" in navigator) || !track) return;
		const write = (artwork: MediaImage[]) => {
			navigator.mediaSession.metadata = new MediaMetadata({
				title: track.title,
				artist: artistNames(track.artists),
				album: track.album?.title,
				artwork,
			});
		};
		const url = track.artworkUrl;
		const cached = url && lastArtwork?.url === url ? lastArtwork.image : undefined;
		// The text is written first so the widget names the track on the same tick it starts, and the
		// cover replaces it whenever the fetch lands. A failed one costs the artwork, never the metadata.
		write(cached ? [cached] : []);
		if (!url || cached) return;
		let live = true;
		void artworkImage(url)
			.then((image) => {
				lastArtwork = { url, image };
				if (live) write([image]);
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [track, playing]);
}
