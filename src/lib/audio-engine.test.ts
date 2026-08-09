import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioEngine, type AudioEngineDeps } from "#/lib/audio-engine";
import type { NoctuneBridge, PersistedState, Track } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";

const track = (id: string, durationSeconds = 200): Track => ({
	id,
	title: `Track ${id}`,
	artists: [{ id: "a1", name: "Artist" }],
	durationSeconds,
});

class FakeAudio {
	src = "";
	preload = "";
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	played = 0;
	loaded = 0;
	private handlers = new Map<string, Set<() => void>>();

	addEventListener(type: string, handler: () => void) {
		(this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(handler);
	}

	dispatch(type: string) {
		this.handlers.get(type)?.forEach((handler) => handler());
	}

	load() {
		this.loaded += 1;
	}

	removeAttribute(name: string) {
		if (name === "src") this.src = "";
	}

	async play() {
		this.played += 1;
		this.paused = false;
	}

	pause() {
		this.paused = true;
	}
}

interface Harness {
	engine: ReturnType<typeof createAudioEngine>;
	audio: [FakeAudio, FakeAudio];
	gains: { value: number }[];
	log: string[];
	resolve: ReturnType<typeof vi.fn>;
	position: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
	command: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	saved: PersistedState[];
	stored: PersistedState;
}

function harness(
	options: { resolveDelay?: number; withoutMusic?: boolean; radio?: Track[]; radioDelay?: number } = {}
): Harness {
	const audio: [FakeAudio, FakeAudio] = [new FakeAudio(), new FakeAudio()];
	const gains: { value: number }[] = [];
	const log: string[] = [];
	const saved: PersistedState[] = [];
	const position = vi.fn();
	const notify = vi.fn(async () => {});
	const stored = defaultState();
	let created = 0;

	const resolve = vi.fn(async (trackId: string) => {
		if (options.resolveDelay) await new Promise((done) => setTimeout(done, options.resolveDelay));
		return {
			url: `noctune://app/media/${trackId}`,
			fingerprint: { itag: 251, mimeType: "audio/webm", codec: "opus", bitrate: 128000, durationMs: 200000 },
			integratedLufs: -8,
		};
	});

	const command = vi.fn(async () => ({ ok: true as const }));
	// Autoplay's radio. Answers nothing by default, so a test that says nothing about autoplay still
	// runs out of queue exactly as it did before it existed.
	const query = vi.fn(async () => {
		if (options.radioDelay) await new Promise((done) => setTimeout(done, options.radioDelay));
		return { items: options.radio ?? [] };
	});
	const bridge = {
		local: {
			load: async () => structuredClone(stored),
			save: async (state: PersistedState) => {
				saved.push(state);
			},
		},
		player: { resolve, position, notify },
		// A bridge with no music surface is the shape this ran against before history reporting, and
		// playback has to survive it: the report is optional the whole way down.
		...(options.withoutMusic ? {} : { music: { command, query } }),
	} as unknown as NoctuneBridge;

	const makeGain = () => {
		const node = {
			value: 1,
			gain: {
				value: 1,
				setValueAtTime(value: number) {
					node.value = value;
					log.push(`gain:${gains.indexOf(node)}=${value.toFixed(4)}`);
				},
			},
			connect: (target: unknown) => target,
		};
		return node;
	};

	const deps: AudioEngineDeps = {
		bridge,
		random: () => 0,
		createAudio: () => audio[created++] as unknown as HTMLAudioElement,
		createAudioContext: () =>
			({
				currentTime: 0,
				destination: {},
				createGain: () => {
					const node = makeGain();
					// The first gain node built is the master bus, the next two are the decks.
					if (gains.length < 3) gains.push(node);
					return node;
				},
				createMediaElementSource: () => ({ connect: (target: unknown) => target }),
				resume: async () => {},
				close: async () => {},
			}) as unknown as AudioContext,
	};

	// Patch play/pause so ordering against gain writes is observable.
	audio.forEach((element, index) => {
		const original = element.play.bind(element);
		element.play = async () => {
			log.push(`play:${index}`);
			await original();
		};
	});

	return {
		engine: createAudioEngine(deps),
		audio,
		gains,
		log,
		resolve,
		position,
		notify,
		command,
		query,
		saved,
		stored,
	};
}

describe("audio engine", () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it("fixes gain on the target deck before playback starts", async () => {
		const { engine, log } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);

		// -14 - (-8) = -6 dB of attenuation for a track YouTube measured at -8 LUFS.
		expect(engine.getSnapshot().gainDb).toBeCloseTo(-6, 5);
		const gainWrite = log.findIndex((entry) => entry.startsWith("gain:1"));
		const playCall = log.indexOf("play:0");
		expect(gainWrite).toBeGreaterThanOrEqual(0);
		expect(gainWrite).toBeLessThan(playCall);
	});

	it("reads the normalization setting fresh on every play", async () => {
		const { engine, stored, log } = harness();
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);
		expect(engine.getSnapshot().gainDb).toBeCloseTo(-6, 5);
		const writes = log.filter((entry) => entry.startsWith("gain:")).length;

		// The settings page writes straight to the store, so nothing notifies the engine. The gain
		// of the deck already playing stays put; the next prepare picks the new setting up.
		stored.settings.normalization = "off";
		expect(log.filter((entry) => entry.startsWith("gain:")).length).toBe(writes);

		await engine.play(queue[0], queue);
		expect(engine.getSnapshot().gainDb).toBe(0);
	});

	it("re-prepares a preloaded deck when the settings changed under it", async () => {
		const { engine, audio, stored, resolve } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await Promise.resolve();
		const resolvedBefore = resolve.mock.calls.length;

		stored.settings.normalization = "off";
		await engine.play(queue[1], queue);

		// Deck 1 holds t2 at the old gain, so the fast path must be discarded.
		expect(resolve.mock.calls.length).toBe(resolvedBefore + 1);
		expect(engine.getSnapshot().gainDb).toBe(0);
	});

	it("reports a confirmed start, and nothing when the start failed", async () => {
		const { engine, command, resolve } = harness();
		await engine.start();
		await engine.play(track("t1"), [track("t1")]);
		expect(command).toHaveBeenCalledExactlyOnceWith({ type: "history", trackId: "t1", positionSeconds: 0 });

		command.mockClear();
		resolve.mockRejectedValueOnce(new Error("no stream"));
		await engine.play(track("t2"), [track("t2")]);
		expect(engine.getSnapshot().playback.status).toBe("error");
		expect(command).not.toHaveBeenCalled();
	});

	it("reports the outgoing track's final position before the next one starts", async () => {
		const { engine, audio, command } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		command.mockClear();

		audio[0].duration = 200;
		audio[0].currentTime = 199.9;
		audio[0].dispatch("timeupdate");
		await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));

		// The end of the outgoing track and the start of the incoming one, in that order. Nothing else
		// sees the final position: the next play resets the clock before anything can read it.
		expect(command.mock.calls.map(([request]) => request)).toEqual([
			{ type: "history", trackId: "t1", positionSeconds: 199.9 },
			{ type: "history", trackId: "t2", positionSeconds: 0 },
		]);
	});

	it("reports nothing for a pause and resume of the track already playing", async () => {
		const { engine, command } = harness();
		await engine.start();
		await engine.play(track("t1"), [track("t1")]);
		command.mockClear();

		engine.toggle();
		engine.toggle();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(command).not.toHaveBeenCalled();
	});

	it("plays against a bridge that offers no music surface at all", async () => {
		const { engine } = harness({ withoutMusic: true });
		await engine.start();
		await engine.play(track("t1"), [track("t1")]);
		expect(engine.getSnapshot().playback.status).toBe("playing");
	});

	it("toggles in place, without re-resolving the track it is already holding", async () => {
		const { engine, audio, resolve } = harness();
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);
		const resolvedBefore = resolve.mock.calls.length;
		const playedBefore = audio[0].played;

		engine.toggle();
		expect(engine.getSnapshot().playback.status).toBe("paused");

		engine.toggle();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		// Resuming must not reload the source: that is what made a pause look like a restart.
		expect(resolve.mock.calls.length).toBe(resolvedBefore);
		expect(audio[0].played).toBe(playedBefore + 1);
	});

	it("cancels an optimistic play when Space is pressed again while media loads", async () => {
		const { engine, audio } = harness({ resolveDelay: 20 });
		await engine.start();
		const playing = engine.play(track("t1"), [track("t1")]);
		expect(engine.getSnapshot().playback.status).toBe("loading");

		engine.toggle();
		expect(engine.getSnapshot().playback.status).toBe("paused");
		await playing;
		expect(engine.getSnapshot().playback.status).toBe("paused");
		expect(audio[0].paused).toBe(true);
	});

	it("bounds a stalled media start and resolves a fresh stream on retry", async () => {
		vi.useFakeTimers();
		const { engine, audio, resolve } = harness();
		await engine.start();
		audio[0].play = vi.fn(() => {
			audio[0].paused = false;
			return new Promise<void>(() => undefined);
		});

		void engine.play(track("t1"), [track("t1")]);
		await vi.advanceTimersByTimeAsync(0);
		expect(audio[0].src).toContain("t1");

		await vi.advanceTimersByTimeAsync(15_000);
		expect(engine.getSnapshot().playback).toMatchObject({
			status: "error",
			positionSeconds: 0,
			errorMessage: "Playback did not start within 15 seconds",
		});
		expect(audio[0].src).toBe("");

		audio[0].play = async () => {
			audio[0].played += 1;
			audio[0].paused = false;
		};
		await engine.play();
		expect(resolve).toHaveBeenCalledTimes(2);
		expect(engine.getSnapshot().playback.status).toBe("playing");
	});

	it("publishes the live playhead without waiting for the disk interval", async () => {
		const { engine, audio, position } = harness();
		await engine.start();
		await engine.play(track("t1"), [track("t1")]);
		position.mockClear();

		audio[0].currentTime = 41.375;
		audio[0].dispatch("timeupdate");

		expect(position).toHaveBeenLastCalledWith(41.375);
	});

	it("plays a preloaded track from the other deck without resolving it again", async () => {
		const { engine, audio, resolve } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await Promise.resolve();
		const resolvedBefore = resolve.mock.calls.length;

		await engine.play(queue[1], queue);

		// Deck 1 already holds t2, and there is nothing after it to preload.
		expect(audio[1].played).toBe(1);
		expect(resolve.mock.calls.length).toBe(resolvedBefore);
		expect(engine.getSnapshot().playback.queueIndex).toBe(1);
	});

	it("starts the preloaded deck before the current track ends and lets its tail play out", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));

		audio[0].duration = 200;
		audio[0].currentTime = 199.9;
		audio[0].dispatch("timeupdate");

		// `ended` never fires: the switch is armed against the boundary instead of reacting to it.
		await vi.waitFor(() => expect(audio[1].played).toBe(1));
		expect(engine.getSnapshot().playback.queueIndex).toBe(1);
		expect(audio[0].paused).toBe(false);
	});

	it("preloads the wrap rather than the row past the end when repeat is all", async () => {
		const { engine, audio } = harness();
		await engine.start();
		engine.cycleRepeat();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[1], queue);

		await vi.waitFor(() => expect(audio[1].src).toContain("t1"));
	});

	it("preloads the track repeat one will replay rather than the row after it", async () => {
		const { engine, audio } = harness();
		await engine.start();
		engine.cycleRepeat();
		engine.cycleRepeat();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);

		await vi.waitFor(() => expect(audio[1].src).toContain("t1"));
	});

	it("discards a preload that lands after a newer play", async () => {
		const { engine, audio, resolve } = harness({ resolveDelay: 20 });
		await engine.start();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);
		// The preload for t2 is in flight on deck 1. Jumping to t3 must not let it land there.
		await engine.play(queue[2], queue);
		const srcAfter = audio.map((element) => element.src);
		await new Promise((done) => setTimeout(done, 60));

		expect(audio.map((element) => element.src)).toEqual(srcAfter);
		expect(resolve).toHaveBeenCalled();
	});

	it("advances on ended from the active deck and ignores the idle deck", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);

		audio[1].dispatch("ended");
		expect(engine.getSnapshot().playback.queueIndex).toBe(0);

		audio[0].dispatch("ended");
		await vi.waitFor(() => expect(engine.getSnapshot().playback.queueIndex).toBe(1));
	});

	it("announces a track the queue reached on its own, and nothing a press reached", async () => {
		const { engine, audio, notify } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);

		audio[0].dispatch("ended");
		await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
		expect(notify.mock.calls[0]?.[0]).toMatchObject({ id: "t2" });

		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.queueIndex).toBe(2));
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("pauses at the end of the queue when repeat is off", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);

		audio[0].dispatch("ended");

		expect(engine.getSnapshot().playback.status).toBe("paused");
	});

	it("extends a queue that has run out with a radio seeded off its last track", async () => {
		const { engine, audio, query } = harness({ radio: [track("r1"), track("r2")] });
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[1], queue);

		// The extension lands while the last track is still playing, which is what leaves time to
		// preload the row it will hand off to.
		await vi.waitFor(() => expect(engine.getSnapshot().playback.queue).toHaveLength(4));
		expect(query).toHaveBeenCalledExactlyOnceWith({ type: "radio", id: "t2" });

		audio[0].dispatch("ended");
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(engine.getSnapshot().playback.currentTrack?.id).toBe("r1");
	});

	it("stops at the end of the queue when autoplay is off, without asking for a radio", async () => {
		const { engine, audio, query, stored } = harness({ radio: [track("r1")] });
		stored.settings.autoplay = false;
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);

		audio[0].dispatch("ended");
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("paused"));
		expect(query).not.toHaveBeenCalled();
		expect(engine.getSnapshot().playback.queue).toHaveLength(1);
	});

	it("drops radio rows the queue already holds", async () => {
		const { engine } = harness({ radio: [track("t1"), track("t2"), track("r1")] });
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[1], queue);

		// A radio seeded off the last track tends to open on it, and on its neighbours.
		await vi.waitFor(() => expect(engine.getSnapshot().playback.queue).toHaveLength(3));
		expect(engine.getSnapshot().playback.queue.map((item) => item.id)).toEqual(["t1", "t2", "r1"]);
	});

	it("pauses rather than erroring when the radio will not load", async () => {
		const { engine, audio, query } = harness();
		query.mockRejectedValue(new Error("no radio"));
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);

		audio[0].dispatch("ended");
		await vi.waitFor(() => expect(query).toHaveBeenCalled());
		expect(engine.getSnapshot().playback.status).toBe("paused");
		expect(engine.getSnapshot().playback.queue).toHaveLength(1);
	});

	it("asks for one radio when the boundary is reached before the extension lands", async () => {
		const { engine, audio, query } = harness({ radio: [track("r1"), track("r2")], radioDelay: 20 });
		await engine.start();
		const queue = [track("t1")];
		await engine.play(queue[0], queue);

		// The deck drains with the fetch still in flight, so this is the race path: it pauses, waits on
		// the promise the preload already started, and resumes onto what it appended.
		audio[0].dispatch("ended");
		expect(engine.getSnapshot().playback.status).toBe("paused");

		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(engine.getSnapshot().playback.currentTrack?.id).toBe("r1");
		// One radio for one seed: `move` waits on the promise `preloadNext` started, never its own.
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("loads the deck on the first play of a restored session", async () => {
		const { engine, audio, resolve, stored } = harness();
		stored.playback.currentTrack = track("t1");
		stored.playback.queue = [track("t1")];
		stored.playback.positionSeconds = 42;
		await engine.start();
		expect(engine.getSnapshot().playback.status).toBe("paused");
		await vi.waitFor(() => expect(audio[0].src).toContain("t1"));
		const resolvedBefore = resolve.mock.calls.length;

		// Startup prepares the restored deck before the gesture, so Space does no network work.
		engine.toggle();
		audio[0].dispatch("loadedmetadata");
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(audio[0].currentTime).toBe(42);
		expect(resolve.mock.calls.length).toBe(resolvedBefore);
	});

	it("takes the length off the loaded media when upstream stated none", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1", 0), track("t2", 0)];
		await engine.play(queue[0], queue);

		audio[0].duration = 183.4;
		audio[0].dispatch("durationchange");
		const { playback } = engine.getSnapshot();
		expect(playback.currentTrack?.durationSeconds).toBe(183);
		// The queue row is the same object, so a later resume still resolves to it by identity.
		expect(playback.queue[0]).toBe(playback.currentTrack);
	});

	it("takes the length off a deck that loaded while it was still the preloaded one", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1", 0), track("t2", 0)];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));

		// The preloaded deck learns its length while it is idle, which is the only durationchange it
		// ever fires: nothing more happens when the handoff makes it the active one.
		audio[1].duration = 183.4;
		audio[1].dispatch("durationchange");

		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		const { playback } = engine.getSnapshot();
		expect(playback.currentTrack?.id).toBe("t2");
		expect(playback.currentTrack?.durationSeconds).toBe(183);
		expect(playback.queue[1]).toBe(playback.currentTrack);
	});

	it("restarts the current track when previous is pressed past the grace window", async () => {
		const { engine, audio, resolve } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[1], queue);
		const resolvedBefore = resolve.mock.calls.length;

		audio[0].currentTime = 5;
		audio[0].dispatch("timeupdate");
		engine.previous();

		// Rewind in place: same queue row, no new resolve.
		expect(engine.getSnapshot().playback.queueIndex).toBe(1);
		expect(engine.getPosition()).toBe(0);
		expect(audio[0].currentTime).toBe(0);
		expect(resolve.mock.calls.length).toBe(resolvedBefore);

		// Inside the grace window it still steps back a track.
		audio[0].currentTime = 1;
		audio[0].dispatch("timeupdate");
		engine.previous();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.queueIndex).toBe(0));
	});

	it("ignores the trailing timeupdate a paused deck fires while the next track loads", async () => {
		const { engine, audio } = harness({ resolveDelay: 5 });
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);

		audio[0].currentTime = 120;
		audio[0].dispatch("timeupdate");
		expect(engine.getPosition()).toBe(120);

		// Same deck, still holding t1 at 120s: its pause must not put that back on the clock.
		const playing = engine.play(queue[1], queue);
		audio[0].dispatch("timeupdate");
		expect(engine.getPosition()).toBe(0);
		await playing;
		expect(engine.getPosition()).toBe(0);
	});

	it("resolves the clicked row when a queue holds duplicate tracks", async () => {
		const { engine } = harness();
		await engine.start();
		const first = track("dup");
		const second = track("dup");
		const queue = [first, second];
		await engine.play(second, queue);

		expect(engine.getSnapshot().playback.queueIndex).toBe(1);
	});

	it("queues a copy after the current track, so the row it came from stays addressable", async () => {
		const { engine, saved } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		const before = saved.length;

		engine.enqueue(queue.slice(1), "next");
		const { playback } = engine.getSnapshot();

		expect(playback.queue.map((item) => item.id)).toEqual(["t1", "t2", "t2"]);
		// The same object twice over would make `play`'s identity lookup resolve the second row to the first.
		expect(playback.queue[1]).not.toBe(playback.queue[2]);
		expect(playback.queueIndex).toBe(0);
		await vi.waitFor(() => expect(saved.length).toBeGreaterThan(before));
	});

	it("swaps the queue under the playing track without restarting it", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const first = track("t1");
		await engine.play(first, [first]);
		audio[0].currentTime = 90;
		audio[0].dispatch("timeupdate");
		const played = audio[0].played;

		// What starting a radio off the current song hands back: the same song, then its queue.
		engine.setQueue([first, track("t2"), track("t3")], { type: "radio", title: "Radio" });
		const { playback } = engine.getSnapshot();

		expect(playback.queue.map((item) => item.id)).toEqual(["t1", "t2", "t3"]);
		expect(playback.queueIndex).toBe(0);
		expect(playback.context?.title).toBe("Radio");
		expect(playback.status).toBe("playing");
		// The deck was neither reloaded nor started again, so the song plays on from where it was.
		expect(audio[0].played).toBe(played);
		expect(engine.getPosition()).toBe(90);
	});

	it("plays straight away when something is queued with nothing playing", async () => {
		const { engine } = harness();
		await engine.start();

		engine.enqueue([track("t1")], "end");

		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(engine.getSnapshot().playback.currentTrack?.id).toBe("t1");
	});

	it("keeps pointing at the same track when an earlier row is removed", async () => {
		const { engine } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[1], queue);

		engine.dequeue(0);
		const { playback } = engine.getSnapshot();

		expect(playback.queueIndex).toBe(0);
		expect(playback.currentTrack?.id).toBe("t2");
		expect(playback.queue.map((item) => item.id)).toEqual(["t2", "t3"]);
	});

	it("swaps the current track without starting playback when the queue is paused", async () => {
		const { engine, audio } = harness();
		await engine.start();
		const queue = [track("t1"), track("t2")];
		await engine.play(queue[0], queue);
		engine.pause();
		const played = audio[0].played + audio[1].played;

		engine.dequeue(0);
		const { playback } = engine.getSnapshot();

		expect(playback.currentTrack?.id).toBe("t2");
		expect(playback.status).toBe("paused");
		expect(audio[0].played + audio[1].played).toBe(played);
		// The deck no longer holds the current track, so it must not look loaded: `play` would resume it.
		expect(audio[0].src).toBe("");
	});

	it("goes idle when the last row is removed", async () => {
		const { engine } = harness();
		await engine.start();
		const only = track("t1");
		await engine.play(only, [only]);

		engine.dequeue(0);
		const { playback } = engine.getSnapshot();

		expect(playback).toMatchObject({ status: "idle", queueIndex: -1, queue: [] });
		expect(playback.currentTrack).toBeUndefined();
	});
});
