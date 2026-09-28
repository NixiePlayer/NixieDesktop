import { describe, expect, it, vi } from "vitest";
import { createAudioEngine, type AudioEngineDeps } from "#/lib/audio-engine";
import type { NixieBridge, PersistedState, Track } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";

// Races under rapid skipping. The fakes follow `audio-engine.test.ts`, with one change that matters
// here: `load()` resets the playhead and pauses the element, as the HTML media load algorithm does,
// so a test can tell a freshly loaded deck from one that still holds an old playhead.

const track = (id: string, durationSeconds = 200): Track => ({
	id,
	title: `Track ${id}`,
	artists: [{ id: "a1", name: "Artist" }],
	durationSeconds,
});

class FakeAudio {
	src = "";
	preload = "";
	crossOrigin = "";
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	played = 0;
	private handlers = new Map<string, Set<() => void>>();

	addEventListener(type: string, handler: () => void) {
		(this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(handler);
	}

	dispatch(type: string) {
		this.handlers.get(type)?.forEach((handler) => handler());
	}

	load() {
		this.currentTime = 0;
		this.paused = true;
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

function harness(options: { resolveDelay?: number } = {}) {
	const audio: [FakeAudio, FakeAudio] = [new FakeAudio(), new FakeAudio()];
	const stored: PersistedState = defaultState();
	let created = 0;

	const resolve = vi.fn(async (trackId: string) => {
		if (options.resolveDelay) await new Promise((done) => setTimeout(done, options.resolveDelay));
		return {
			url: `nixie://app/media/${trackId}`,
			fingerprint: { itag: 251, mimeType: "audio/webm", codec: "opus", bitrate: 128000, durationMs: 200000 },
			integratedLufs: -8,
		};
	});

	const bridge = {
		local: {
			rendererError: vi.fn(async () => {}),
			load: async () => structuredClone(stored),
			save: async () => {},
		},
		player: { resolve, position: vi.fn(), notify: vi.fn(async () => {}) },
		music: { command: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => ({ items: [] })) },
	} as unknown as NixieBridge;

	const gain = () => ({ gain: { value: 1, setValueAtTime() {} }, connect: (target: unknown) => target });
	const deps: AudioEngineDeps = {
		bridge,
		random: () => 0,
		createAudio: () => audio[created++] as unknown as HTMLAudioElement,
		createAudioContext: () =>
			Object.assign(new EventTarget(), {
				currentTime: 0,
				state: "running",
				destination: {},
				createGain: gain,
				createMediaElementSource: () => ({ connect: (target: unknown) => target }),
				resume: async () => {},
				close: async () => {},
			}) as unknown as AudioContext,
	};

	return { engine: createAudioEngine(deps), audio, resolve, stored };
}

/** Lets every pending promise continuation and zero-delay timer run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const current = (engine: ReturnType<typeof createAudioEngine>) => engine.getSnapshot().playback.currentTrack?.id;

describe("audio engine under rapid skipping", () => {
	it("moves past the restored track when next is the first press of a session", async () => {
		const { engine, audio, stored } = harness();
		const queue = [track("t1"), track("t2"), track("t3")];
		stored.playback.currentTrack = queue[0];
		stored.playback.queue = queue;
		stored.playback.queueIndex = 0;
		stored.playback.positionSeconds = 42;
		await engine.start();
		await vi.waitFor(() => expect(audio[0].src).toContain("t1"));
		audio[0].dispatch("loadedmetadata");
		await settle();

		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));

		// The restored preload names the current row, so `move` took it as the decided next track and
		// replayed t1 on its own deck from 42s.
		expect(current(engine)).toBe("t2");
		expect(engine.getSnapshot().playback.queueIndex).toBe(1);
	});

	it("starts the restored track from zero when its row is clicked", async () => {
		const { engine, audio, stored } = harness();
		const queue = [track("t1"), track("t2")];
		stored.playback.currentTrack = queue[0];
		stored.playback.queue = queue;
		stored.playback.positionSeconds = 42;
		await engine.start();
		await vi.waitFor(() => expect(audio[0].src).toContain("t1"));
		audio[0].dispatch("loadedmetadata");
		await settle();

		// An explicit track is a restart: `play` sets the clock to 0, but the fast path starts the
		// element wherever it already is.
		await engine.play(queue[0], queue);

		expect(engine.getPosition()).toBe(0);
		expect(audio[0].currentTime).toBe(0);
	});

	it("advances two tracks for two quick presses of next", async () => {
		const { engine, audio } = harness();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await settle();

		// The second press lands while the first is still awaiting `local.load()`, before `play`
		// clears `preloaded`, so `move` decides t2 again.
		engine.next();
		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		await settle();

		expect(current(engine)).toBe("t3");
	});

	it("follows the clicked row when next is pressed while that row still resolves", async () => {
		const { engine, audio } = harness({ resolveDelay: 20 });
		const queue = [track("t1"), track("t2"), track("t3"), track("t4"), track("t5"), track("t6")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await settle();

		// Row click on t5 takes the slow path; the preload of t2 from t1 is still standing.
		void engine.play(queue[4], queue);
		await settle();
		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		await new Promise((done) => setTimeout(done, 60));

		expect(current(engine)).toBe("t6");
	});

	it("advances instead of replaying mid-track after a pause cancelled a gapless start", async () => {
		const { engine, audio } = harness();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await settle();

		// Next onto the preloaded deck, then Space twice while it is still loading.
		engine.next();
		engine.toggle();
		engine.toggle();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		audio[1].currentTime = 60;
		audio[1].dispatch("timeupdate");

		// `preloaded` still names t2 on the now active deck, so this replays t2 from 60s.
		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		await settle();

		expect(current(engine)).toBe("t3");
		expect(engine.getLivePosition()).toBe(0);
	});

	it("does not resume the previous track's source after a pause cancelled a load", async () => {
		const { engine, audio } = harness({ resolveDelay: 20 });
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		audio[0].currentTime = 120;
		audio[0].dispatch("timeupdate");

		// Row click on t3 (slow path onto deck 0), then Space twice before it resolves.
		void engine.play(queue[2], queue);
		engine.toggle();
		engine.toggle();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		audio[0].dispatch("timeupdate");

		// The resume fast path saw a loaded, reusable deck 0 and played it, but it still holds t1.
		expect(current(engine)).toBe("t3");
		expect(audio[0].src).toContain("t3");
		expect(engine.getPosition()).toBe(0);
	});

	it("does not pause the new deck when a superseded start settles late", async () => {
		const { engine, audio } = harness();
		const queue = [track("t1"), track("t2"), track("t3")];
		await engine.play(queue[0], queue);
		await vi.waitFor(() => expect(audio[1].src).toContain("t2"));
		await settle();
		engine.pause();

		// Resume on deck 0 whose `play()` settles only after the user already moved on. Chromium
		// resolves a play promise whose `playing` notification was queued before the next `pause()`.
		let settleResume: () => void = () => undefined;
		audio[0].play = () => {
			audio[0].paused = false;
			return new Promise<void>((done) => (settleResume = done));
		};
		engine.toggle();
		await settle();
		engine.next();
		await vi.waitFor(() => expect(engine.getSnapshot().playback.status).toBe("playing"));
		expect(audio[1].paused).toBe(false);

		settleResume();
		await settle();

		// The stale continuation runs `elements[active].pause()`, and `active` is deck 1 by now.
		expect(engine.getSnapshot().playback.status).toBe("playing");
		expect(audio[1].paused).toBe(false);
	});

	it("does not carry the restored position onto a different track after a queue edit", async () => {
		const { engine, audio, stored } = harness({ resolveDelay: 20 });
		const queue = [track("t1"), track("t2")];
		stored.playback.currentTrack = queue[0];
		stored.playback.queue = queue;
		stored.playback.queueIndex = 0;
		stored.playback.positionSeconds = 42;
		await engine.start();

		// The restored prepare is still in flight when the current row is removed.
		engine.dequeue(0);
		expect(current(engine)).toBe("t2");
		await new Promise((done) => setTimeout(done, 40));
		// Only an element given a source ever reports metadata.
		if (audio[0].src) audio[0].dispatch("loadedmetadata");

		// The restored prepare was not invalidated, so it loaded t1 into the active deck, and its
		// metadata applied t1's 42s to the clock of t2.
		expect(audio[0].src).toBe("");
		expect(engine.getPosition()).toBe(0);
	});
});
