import type { NixieBridge, PlaybackSnapshot, QueueContext, Settings, Track } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";
import { isTrack } from "#/shared/entities";
import { dbToLinear, normalizationGainDb, normalizationTargets, volumeGain } from "#/shared/normalization";
import { nextQueueIndex } from "#/shared/queue";

export interface EngineState {
	playback: PlaybackSnapshot;
	gainDb: number;
}

/** Injection points exist so the engine can be exercised in vitest's node environment. */
export interface AudioEngineDeps {
	bridge?: NixieBridge;
	createAudio?: () => HTMLAudioElement;
	createAudioContext?: () => AudioContext;
	random?: () => number;
}

export interface AudioEngine {
	subscribe(listener: () => void): () => void;
	getSnapshot(): EngineState;
	subscribePosition(listener: () => void): () => void;
	getPosition(): number;
	start(): Promise<void>;
	dispose(): void;
	play(track?: Track, queue?: Track[], context?: QueueContext): Promise<void>;
	enqueue(tracks: Track[], at: "next" | "end"): void;
	setQueue(queue: Track[], context?: QueueContext): void;
	dequeue(index: number): void;
	pause(): void;
	toggle(): void;
	next(): void;
	previous(): void;
	seek(seconds: number): void;
	setVolume(volume: number): void;
	toggleShuffle(): void;
	cycleRepeat(): void;
}

/** There are two decks and only ever two, which is what lets either be indexed without a guard. */
type Deck = 0 | 1;

interface Preloaded {
	trackId: string;
	index: number;
	deck: Deck;
	gainDb: number;
	settings: string;
	restored?: boolean;
}

/** A deck is prepared against these two, so a change to either makes the preloaded deck stale. */
const settingsKey = (settings: Settings) => `${settings.quality}:${settings.normalization}`;

const PERSIST_INTERVAL_MS = 5000;
const PREVIOUS_RESTART_SECONDS = 2;
const PLAY_START_TIMEOUT_MS = 15_000;

/**
 * `ended` only fires once the current deck has already drained, and starting a media element takes
 * Chromium a few frames even when it is preloaded and fully buffered, so a switch driven off `ended`
 * always leaves a hole between the two tracks. The handoff is armed ahead of the boundary instead:
 * the preloaded deck is started this far early and the outgoing deck is left to play its own tail
 * out underneath it, so the join is an overlap of at most this long rather than a gap.
 *
 * ponytail: one fixed lead, not a measured start latency. It also has to cover the `local.load()`
 * round trip `play` makes. Overshoot costs a sliver of overlap, undershoot brings back a sliver of
 * gap; measure `play()` to the first `timeupdate` per deck if a transition ever sounds doubled.
 */
const SWITCH_LEAD_MS = 80;
/** Far enough out that a `timeupdate` (roughly every 250ms) always lands inside it. */
const HANDOFF_ARM_SECONDS = 2;

export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine {
	const random = deps.random ?? Math.random;
	const createAudio = deps.createAudio ?? (() => new Audio());
	const createAudioContext = deps.createAudioContext ?? (() => new AudioContext());
	const getBridge = () => deps.bridge ?? (typeof window === "undefined" ? undefined : window.nixie);

	let state: EngineState = { playback: defaultState().playback, gainDb: 0 };
	let position = 0;
	let active: Deck = 0;
	let preloaded: Preloaded | undefined;
	let generation = 0;
	let ready = false;
	let startPromise: Promise<void> | undefined;
	let audioContext: AudioContext | undefined;
	let master: GainNode | undefined;
	let gains: GainNode[] = [];
	let persistTimer: ReturnType<typeof setInterval> | undefined;
	let handoffTimer: ReturnType<typeof setTimeout> | undefined;
	let loadingTimer: ReturnType<typeof setTimeout> | undefined;
	let handoff = false;
	/** The one extension in flight, shared so the boundary never asks for a second radio. */
	let extending: Promise<boolean> | undefined;
	/** Set by the two callers of `move` nobody pressed, and read by `play` on the same tick. */
	let autoAdvanced = false;
	let restoreTo = 0;

	const listeners = new Set<() => void>();
	const positionListeners = new Set<() => void>();

	const emit = () => listeners.forEach((listener) => listener());
	const emitPosition = () => positionListeners.forEach((listener) => listener());

	function set(patch: Partial<PlaybackSnapshot>, gainDb = state.gainDb) {
		state = { playback: { ...state.playback, ...patch }, gainDb };
		emit();
	}

	function setPosition(value: number) {
		position = value;
		getBridge()?.player.position?.(value);
		emitPosition();
	}

	/**
	 * Tells YouTube Music what was played, which is what personalises the home feed: without it the
	 * recommendations are built from listening that happened somewhere else. Optional the whole way
	 * down and never awaited, because a report is worth strictly less than the playback it reports,
	 * and the engine's own tests run against a bridge with no music surface at all.
	 * ponytail: nothing is reported for a track quit mid-play or paused and never resumed. Reporting
	 * from `pause` would count every pause as the end of a play.
	 */
	function report(trackId: string, positionSeconds: number) {
		void getBridge()
			?.music?.command?.({ type: "history", trackId, positionSeconds })
			?.catch(() => undefined);
	}

	/**
	 * Names the track the queue moved to on its own, which is the one move nobody watched happen.
	 * Optional and never awaited for the same reasons `report` is, and sent only once the deck is
	 * actually playing, so a track that fails to resolve never announces itself. Whether anything is
	 * drawn is main's to decide: the setting lives in the store main already holds.
	 */
	function announce(track: Track) {
		void getBridge()
			?.player?.notify?.(track)
			?.catch(() => undefined);
	}

	const elements: [HTMLAudioElement, HTMLAudioElement] = [createAudio(), createAudio()];
	elements.forEach((element, deck) => {
		element.preload = "auto";
		// `createMediaElementSource` is spec-required to output silence for a tainted element, and in
		// development the page is served from the Vite origin while the stream comes from
		// nixie://app, so without a CORS fetch the graph plays nothing. Packaged builds are
		// same-origin and unaffected either way.
		element.crossOrigin = "anonymous";
		// Pausing queues a final `timeupdate`, and switching tracks reuses the deck it just paused,
		// so without the `paused` guard the old track's position lands back on the clock after
		// `play` reset it, and stays there until the new source loads. The lyrics panel read that
		// as the new song already being minutes in and opened halfway down.
		element.addEventListener("timeupdate", () => {
			if (deck !== active || element.paused) return;
			setPosition(element.currentTime);
			armHandoff(element);
		});
		element.addEventListener("ended", () => {
			if (deck === active) move("next", true);
		});
		element.addEventListener("error", () => {
			if (deck !== active) return;
			// MediaError codes are the only detail the element gives up, and 4 (SRC_NOT_SUPPORTED)
			// is what an upstream rejection looks like from here.
			set({ status: "error", errorMessage: `Audio element failed (media error ${element.error?.code ?? 0})` });
		});
		element.addEventListener("durationchange", () => {
			if (deck === active) syncDuration(element);
		});
		element.addEventListener("loadedmetadata", () => {
			if (deck !== active || restoreTo <= 0) return;
			element.currentTime = restoreTo;
			setPosition(restoreTo);
			restoreTo = 0;
		});
	});

	/**
	 * Upstream states no length for most shelf, radio and search rows, and a track that says 0 leaves
	 * the seek bar pinned at zero with every click landing back at the start. The loaded media is the
	 * only place the real length exists, so it is written back onto the track, and onto its queue row
	 * as the same object: `play` resolves a click to a row by identity first.
	 */
	function syncDuration(element: HTMLAudioElement) {
		const seconds = Math.round(element.duration);
		const current = state.playback.currentTrack;
		if (!current || !Number.isFinite(seconds) || seconds <= 0 || current.durationSeconds === seconds) return;
		const patched = { ...current, durationSeconds: seconds };
		set({
			currentTrack: patched,
			queue: state.playback.queue.map((item) => (item === current ? patched : item)),
		});
	}

	// Created lazily under a user gesture. Building it earlier leaves it suspended by
	// Chromium's autoplay policy, which means silence.
	function ensureGraph() {
		if (audioContext) return;
		const context = createAudioContext();
		const bus = context.createGain();
		bus.gain.value = volumeGain(state.playback.volume);
		bus.connect(context.destination);
		gains = elements.map((element) => {
			const gain = context.createGain();
			context.createMediaElementSource(element).connect(gain).connect(bus);
			return gain;
		});
		audioContext = context;
		master = bus;
	}

	async function persist() {
		const bridge = getBridge();
		if (!bridge || !ready) return;
		const stored = await bridge.local.load();
		await bridge.local.save({
			...stored,
			playback: { ...state.playback, positionSeconds: position },
		});
	}

	/**
	 * Resolves media, writes the source and the fixed gain, and returns the applied gain.
	 * The generation check is what stops a late preload from clobbering a deck that has
	 * since become the active, playing one.
	 */
	async function prepare(track: Track, deck: Deck, token: number, settings: Settings): Promise<number | undefined> {
		const bridge = getBridge();
		if (!bridge) return undefined;
		const media = await bridge.player.resolve(track.id, settings.quality);
		if (token !== generation) return undefined;
		const target = settings.normalization === "off" ? undefined : normalizationTargets[settings.normalization];
		const gainDb = target === undefined ? 0 : normalizationGainDb(media.integratedLufs, target);
		const element = elements[deck];
		element.src = media.url;
		element.load();
		gains[deck]?.gain.setValueAtTime(dbToLinear(gainDb), audioContext?.currentTime ?? 0);
		return gainDb;
	}

	/**
	 * Autoplay: a queue that has run out is grown with the radio YouTube Music builds around its own
	 * last row, so listening does not end at the bottom of an album. The seed is the queue's last
	 * track and not the one playing, because those differ exactly when it matters: the queue is
	 * extended while the last track is still playing, and seeding off the current one would answer
	 * for a song several rows back and repeat what has just been heard.
	 *
	 * The whole page goes in rather than a slice. That is what upstream's own queue does, and
	 * `extractQueueTracks` already caps it, so trimming here would only mean asking again sooner.
	 * Rows already in the queue are dropped: a radio seeded off the last track tends to open on it.
	 *
	 * One in-flight promise is shared, since both the preload and the boundary can reach the end of
	 * the queue, and two radios for one seed are two different hundred-song orders. A failure is
	 * false, never a throw: a radio that will not load costs the extension and nothing else.
	 */
	function extendQueue(): Promise<boolean> {
		return (extending ??= (async () => {
			const { currentTrack, queue } = state.playback;
			const last = queue[queue.length - 1];
			if (!currentTrack || !last) return false;
			const token = generation;
			try {
				// Settings are read fresh here for the same reason `play` reads them: the settings page
				// writes straight to the store and has no way back into the engine.
				const stored = await getBridge()?.local.load();
				if (!stored || stored.settings.autoplay === false || token !== generation) return false;
				// Optional the whole way down like `report`: the engine's own tests run against a bridge
				// with no music surface at all, and playback has to survive one.
				const page = await getBridge()?.music?.query?.({ type: "radio", id: last.id });
				if (!page || token !== generation) return false;
				const held = new Set(state.playback.queue.map((item) => item.id));
				const rows = page.items.filter(isTrack).filter((item) => !held.has(item.id));
				if (!rows.length) return false;
				update({ queue: [...state.playback.queue, ...rows] });
				return true;
			} catch {
				return false;
			}
		})().finally(() => {
			extending = undefined;
		}));
	}

	/**
	 * Prepares whatever `move("next")` will actually play, which is not the row after this one:
	 * repeat "one" replays this track, repeat "all" wraps off the end, and shuffle jumps. Preparing
	 * `queueIndex + 1` regardless meant those three all missed the fast path and resolved a stream
	 * from scratch at the boundary, which is seconds of silence rather than a gap.
	 */
	function preloadNext(token: number, settings: Settings) {
		const { queueIndex, queue, repeat, shuffle } = state.playback;
		const result = nextQueueIndex(queueIndex, queue.length, repeat, "next", random, shuffle);
		if (result.shouldStop) {
			// The extension happens here, a whole track before the queue actually runs out, rather than
			// at the boundary: a radio fetched once the deck has drained is silence for as long as the
			// round trip takes, while one fetched now leaves time to preload its first row and hand off
			// to it gaplessly. Re-entering cannot loop, since appended rows are exactly what stops
			// `nextQueueIndex` reporting `shouldStop` again.
			void extendQueue().then((grew) => {
				if (grew && token === generation) preloadNext(token, settings);
			});
			return;
		}
		const upcoming = queue[result.index];
		if (!upcoming) return;
		const deck = active === 0 ? 1 : 0;
		void prepare(upcoming, deck, token, settings)
			.then((gainDb) => {
				if (gainDb === undefined || token !== generation) return;
				preloaded = { trackId: upcoming.id, index: result.index, deck, gainDb, settings: settingsKey(settings) };
			})
			.catch(() => {
				preloaded = undefined;
			});
	}

	function clearHandoff() {
		clearTimeout(handoffTimer);
		handoffTimer = undefined;
	}

	function clearLoadingTimeout() {
		clearTimeout(loadingTimer);
		loadingTimer = undefined;
	}

	function armLoadingTimeout(token: number) {
		clearLoadingTimeout();
		loadingTimer = setTimeout(() => {
			loadingTimer = undefined;
			if (token !== generation) return;
			generation += 1;
			preloaded = undefined;
			clearDeck();
			set({ status: "error", positionSeconds: 0, errorMessage: "Playback did not start within 15 seconds" });
		}, PLAY_START_TIMEOUT_MS);
	}

	/** Schedules the switch onto the preloaded deck for just before the active one runs out. */
	function armHandoff(element: HTMLAudioElement) {
		if (handoffTimer !== undefined || !preloaded || state.playback.status !== "playing") return;
		const remaining = element.duration - element.currentTime;
		if (!Number.isFinite(remaining) || remaining > HANDOFF_ARM_SECONDS) return;
		handoffTimer = setTimeout(
			() => {
				handoffTimer = undefined;
				// `play` runs synchronously as far as the deck it leaves, so the flag is read there.
				handoff = true;
				move("next", true);
				handoff = false;
			},
			Math.max(0, remaining * 1000 - SWITCH_LEAD_MS)
		);
	}

	async function play(track?: Track, queue?: Track[], context?: QueueContext) {
		ensureGraph();
		// Read on this tick and cleared here, so every other way into `play` is a press and announces
		// nothing. `move` sets it immediately before the call, and nothing awaits in between.
		const unwatched = autoAdvanced;
		autoAdvanced = false;
		// Whatever asked for this track wins over a handoff still waiting on the old one, and this is
		// also what keeps the armed timer from advancing a second time when `ended` beat it there.
		clearHandoff();
		const current = track ?? state.playback.currentTrack;
		if (!current) return;
		const nextQueue = queue ?? state.playback.queue;
		// Identity first, so duplicate tracks in a playlist resolve to the row that was clicked.
		const found = nextQueue.indexOf(current);
		const index =
			found >= 0
				? found
				: Math.max(
						0,
						nextQueue.findIndex((item) => item.id === current.id)
					);

		// Resuming the deck that already holds this track is just a resume. Re-resolving it would
		// tear the source down and reload it, which is what made a pause/play look like a restart.
		// The `src` check is what keeps a restored session out of here: `start()` reinstates the
		// track paused at its position, but no deck was ever loaded, so there is nothing to resume.
		if (
			!track &&
			state.playback.status === "paused" &&
			current.id === state.playback.currentTrack?.id &&
			elements[active]?.src &&
			!preloaded?.restored
		) {
			const token = ++generation;
			set({ status: "loading", errorMessage: undefined });
			armLoadingTimeout(token);
			try {
				await audioContext?.resume();
				if (token !== generation) return;
				await elements[active].play();
				if (token !== generation) return elements[active].pause();
				set({ status: "playing" });
			} catch (error) {
				if (token !== generation) return;
				const reason = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown playback failure";
				set({ status: "error", errorMessage: reason });
			} finally {
				if (token === generation) clearLoadingTimeout();
			}
			return;
		}

		// Whatever the outgoing track reached is its final position, and this is the only place that
		// sees it: `setPosition` below resets the clock, and every departure funnels through here. The
		// gapless handoff arrives about SWITCH_LEAD_MS before the deck drains and never off `ended`.
		const outgoing = state.playback.currentTrack;
		if (outgoing && outgoing.id !== current.id && position > 0) report(outgoing.id, position);

		const token = ++generation;
		const fastPath = preloaded?.trackId === current.id ? preloaded : undefined;
		// A handoff starts the next deck before the current track has finished, so the deck it leaves
		// is left running and plays its own tail out under the new one. Every other switch stops it.
		// Nothing else claims that deck in the meantime: `preloadNext` only reaches it after a resolve,
		// which is a network round trip and so always longer than the lead.
		if (!handoff || !fastPath) elements[active]?.pause();
		active = fastPath?.deck ?? active;
		if (fastPath) gains[active]?.gain.setValueAtTime(dbToLinear(fastPath.gainDb), audioContext?.currentTime ?? 0);
		// Resuming the current track without an explicit argument keeps the restored position.
		restoreTo = !track && current.id === state.playback.currentTrack?.id ? state.playback.positionSeconds : 0;
		setPosition(restoreTo);
		set({
			currentTrack: current,
			context: context ?? state.playback.context,
			queue: nextQueue.length ? nextQueue : [current],
			queueIndex: index,
			status: "loading",
			positionSeconds: restoreTo,
			errorMessage: undefined,
		});
		// A preloaded deck loaded its media, and so fired its `durationchange`, while it was still the
		// idle one and this track was not yet current: becoming active fires nothing more. So the
		// length is read off it here, or every track reached through the gapless handoff keeps the
		// zero upstream gave it, which pins the seek bar at the start for the whole song.
		if (fastPath) syncDuration(elements[active]);
		armLoadingTimeout(token);

		try {
			// Settings are read here, not held in engine state, because the settings page writes them
			// straight to the store and has no other way back into the engine.
			const stored = await getBridge()?.local.load();
			if (token !== generation) return;
			// Without a bridge there is nothing to resolve media against, so this cannot play.
			if (!stored) return set({ status: "error", errorMessage: "No player bridge available" });
			const settings = stored.settings;
			const fresh = fastPath?.settings === settingsKey(settings) ? fastPath : undefined;
			const gainDb = fresh ? fresh.gainDb : await prepare(current, active, token, settings);
			if (token !== generation || gainDb === undefined) return;
			preloaded = undefined;
			await audioContext?.resume();
			if (token !== generation) return;
			await elements[active].play();
			if (token !== generation) return elements[active].pause();
			set({ status: "playing" }, gainDb);
			void persist();
			report(current.id, 0);
			// Repeat "one" advances on its own onto the track already playing, which is not news.
			if (unwatched && current.id !== outgoing?.id) announce(current);
			preloadNext(token, settings);
		} catch (error) {
			// Swallowing this is what made playback failures undiagnosable, so the reason is kept.
			if (token !== generation) return;
			const reason = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown playback failure";
			console.error("[nixie] play failed", error);
			set({ status: "error", errorMessage: reason });
		} finally {
			if (token === generation) clearLoadingTimeout();
		}
	}

	function pause() {
		clearHandoff();
		clearLoadingTimeout();
		if (state.playback.status === "loading") generation += 1;
		elements[active]?.pause();
		set({ status: "paused" });
		void persist();
	}

	function move(direction: "next" | "previous", auto = false) {
		const { queueIndex, queue, repeat, shuffle } = state.playback;
		// The preload already decided what follows, and with shuffle on that decision was a die roll:
		// rolling a second one here would land somewhere else and throw the prepared deck away.
		const decided =
			direction === "next" && preloaded && queue[preloaded.index]?.id === preloaded.trackId
				? preloaded.index
				: undefined;
		const result =
			decided === undefined
				? nextQueueIndex(queueIndex, queue.length, repeat, direction, random, shuffle)
				: { index: decided, shouldStop: false };
		if (result.shouldStop && direction === "next") {
			// Reaching here at all means the extension `preloadNext` fired a track ago has not landed,
			// so the deck has drained with nothing to move to: pausing is the honest state right now,
			// and it is also what a listener who is watching sees stop. The in-flight promise is then
			// awaited rather than a fresh one started, since a second call would be a second radio for
			// one seed, and a settled `false` is an answer already given. `auto` is carried through the
			// re-entry so the track the queue reached on its own still announces itself.
			pause();
			const token = generation;
			void extending?.then((grew) => {
				if (grew && token === generation) move("next", auto);
			});
			return;
		}
		const track = queue[result.index];
		if (!track) return;
		autoAdvanced = auto;
		void play(track, queue);
	}

	/**
	 * Leaves the active deck holding nothing. `play` treats a loaded deck as proof that it holds the
	 * current track and resumes it instead of resolving (see the paused fast path above), so a queue
	 * edit that changes which track is current has to say that the deck no longer does.
	 *
	 * A preload naming this deck is stale for the same reason, and only `start` mints one: it prepares
	 * the restored track on the active deck rather than the idle one. Left standing, replaying that
	 * track after a queue edit takes the fast path onto an element holding nothing at all.
	 */
	function clearDeck() {
		clearHandoff();
		if (preloaded?.deck === active) preloaded = undefined;
		const element = elements[active];
		element?.pause();
		element?.removeAttribute("src");
		element?.load();
		setPosition(0);
	}

	/**
	 * Adds to the queue in place, the one thing `play` cannot do: it replaces the queue and reloads a
	 * deck. Copies go in because `play` resolves a click to a row by identity before it falls back to
	 * the id, so the same object twice over would make the second copy play the first.
	 *
	 * ponytail: with shuffle on, "next" is not honoured. `nextQueueIndex` picks a random offset before
	 * it ever looks at `index + 1`, so an inserted track is only one candidate among the rest. Honouring
	 * it means holding a shuffled order instead of rolling a die on every move.
	 */
	function enqueue(tracks: Track[], at: "next" | "end") {
		const copies = tracks.map((track) => ({ ...track }));
		const [first] = copies;
		if (!first) return;
		const { queue, queueIndex, currentTrack } = state.playback;
		// With nothing playing there is no "next" to insert before, so this is just a play.
		if (!currentTrack) {
			void play(first, copies);
			return;
		}
		const cut = at === "next" ? queueIndex + 1 : queue.length;
		update({ queue: [...queue.slice(0, cut), ...copies, ...queue.slice(cut)] });
	}

	/**
	 * Swaps the queue under the track already playing, the other thing `play` cannot do. A radio
	 * seeded off the current song opens on that song, so handing the result to `play` reloaded the
	 * deck and restarted it under the listener for no change of track at all. Only the rows, the index
	 * into them and the context change here; the deck plays on untouched.
	 *
	 * The prepared deck belongs to the queue being replaced, so it is dropped and the new next row is
	 * prepared in its place, which is what keeps the handoff at the end of this track gapless. Settings
	 * are read fresh for the same reason `play` reads them.
	 */
	function setQueue(queue: Track[], context?: QueueContext) {
		const current = state.playback.currentTrack;
		if (!current || !queue.length) return;
		// A queue that does not hold what is playing would leave the index pointing at someone else's
		// row, so the current track heads it. Every caller so far passes a queue that opens on it.
		const found = queue.findIndex((item) => item.id === current.id);
		const rows = found >= 0 ? queue : [current, ...queue];
		preloaded = undefined;
		update({ queue: rows, queueIndex: Math.max(0, found), context: context ?? state.playback.context });
		const token = generation;
		void getBridge()
			?.local.load()
			.then((stored) => {
				if (stored && token === generation) preloadNext(token, stored.settings);
			})
			.catch(() => undefined);
	}

	/**
	 * Drops one row. Every branch below is about the track that was playing, which is the whole
	 * difficulty: removing any other row is arithmetic, while removing the current one has to decide
	 * what plays next without letting `play`, which always plays, start a paused session.
	 */
	function dequeue(index: number) {
		const { queue, queueIndex, repeat, status } = state.playback;
		if (!queue[index]) return;
		const next = queue.filter((_, position) => position !== index);
		if (index !== queueIndex) {
			update({ queue: next, queueIndex: index < queueIndex ? queueIndex - 1 : queueIndex });
			return;
		}

		// The successor slid into the vacated index, so that is what follows. Removing the last row
		// wraps only if the queue repeats.
		const nextIndex = queueIndex < next.length ? queueIndex : repeat === "all" ? 0 : -1;
		const upcoming = nextIndex >= 0 ? next[nextIndex] : undefined;
		if (!upcoming) {
			clearDeck();
			update({ queue: next, queueIndex: -1, currentTrack: undefined, status: "idle", positionSeconds: 0 });
			return;
		}
		if (status === "playing") {
			void play(upcoming, next);
			return;
		}
		clearDeck();
		update({ queue: next, queueIndex: nextIndex, currentTrack: upcoming, positionSeconds: 0, status: "paused" });
	}

	function seek(seconds: number) {
		// The armed handoff was timed against the old playhead; the next `timeupdate` re-arms it.
		clearHandoff();
		const element = elements[active];
		if (element?.src) element.currentTime = seconds;
		restoreTo = 0;
		setPosition(seconds);
		set({ positionSeconds: seconds });
	}

	function update(patch: Partial<PlaybackSnapshot>) {
		set(patch);
		void persist();
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot: () => state,
		subscribePosition(listener) {
			positionListeners.add(listener);
			return () => positionListeners.delete(listener);
		},
		getPosition: () => position,

		start() {
			// StrictMode and an early shortcut share one startup, and commands await the restored track.
			return (startPromise ??= (async () => {
				const bridge = getBridge();
				const stored = await (bridge?.local.load() ?? Promise.resolve(defaultState()));
				set(
					{
						...stored.playback,
						// Sessions are always restored paused, never mid-playback.
						status: stored.playback.currentTrack ? "paused" : "idle",
					},
					0
				);
				setPosition(stored.playback.positionSeconds);
				restoreTo = stored.playback.positionSeconds;
				ready = true;
				const current = stored.playback.currentTrack;
				if (current) {
					const token = generation;
					void prepare(current, active, token, stored.settings)
						.then((gainDb) => {
							if (gainDb === undefined || token !== generation) return;
							preloaded = {
								trackId: current.id,
								index: stored.playback.queueIndex,
								deck: active,
								gainDb,
								settings: settingsKey(stored.settings),
								restored: true,
							};
						})
						.catch(() => undefined);
				}
				persistTimer = setInterval(() => {
					if (state.playback.status === "playing") void persist();
				}, PERSIST_INTERVAL_MS);
			})());
		},

		dispose() {
			clearInterval(persistTimer);
			clearHandoff();
			clearLoadingTimeout();
			elements.forEach((element) => element.pause());
			void audioContext?.close();
			listeners.clear();
			positionListeners.clear();
			ready = false;
			startPromise = undefined;
		},

		play,
		enqueue,
		setQueue,
		dequeue,
		pause,
		toggle: () => (["playing", "loading"].includes(state.playback.status) ? pause() : void play()),
		next: () => move("next"),
		// Past the grace window, "previous" restarts the loaded track instead of leaving it.
		previous: () => (position > PREVIOUS_RESTART_SECONDS && elements[active]?.src ? seek(0) : move("previous")),

		seek,

		setVolume(volume) {
			master?.gain.setValueAtTime(volumeGain(volume), audioContext?.currentTime ?? 0);
			update({ volume });
		},

		toggleShuffle: () => update({ shuffle: !state.playback.shuffle }),

		cycleRepeat: () =>
			update({
				repeat: state.playback.repeat === "off" ? "all" : state.playback.repeat === "all" ? "one" : "off",
			}),
	};
}
