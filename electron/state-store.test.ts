import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultState } from "../src/shared/defaults";
import { validateState } from "../src/shared/validation";
import { StateStore } from "./state-store";

const paths: string[] = [];

afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("state recovery", () => {
	it("writes atomically and restores playback paused", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const store = new StateStore(path);
		const state = defaultState();
		state.playback.status = "playing";
		state.playback.currentTrack = {
			id: "track",
			title: "Track",
			artists: [{ id: "artist", name: "Artist" }],
			durationSeconds: 120,
		};
		await store.save(state);
		expect(JSON.parse(await readFile(join(path, "state.json"), "utf8")).playback.status).toBe("paused");
	});

	it("survives overlapping saves", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const store = new StateStore(path);
		// Both writers share one temp path, so unqueued this rejects with ENOENT on the rename.
		await Promise.all(
			[0.1, 0.4, 0.9].map((volume) => {
				const state = defaultState();
				state.settings.volume = volume;
				return store.save(state);
			})
		);
		expect(JSON.parse(await readFile(join(path, "state.json"), "utf8")).settings.volume).toBe(0.9);
	});

	it("keeps the latest playback position in memory for the final close save", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const store = new StateStore(path);
		store.setPlaybackPosition(42.375);

		expect(store.snapshot.playback.positionSeconds).toBe(42.375);
	});

	it("reads a normalization switch written by an older build as a level", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const state = defaultState();
		await writeFile(
			join(path, "state.json"),
			JSON.stringify({ ...state, settings: { ...state.settings, normalization: true } })
		);
		expect((await new StateStore(path).load()).settings.normalization).toBe("normal");
	});

	it("leaves a snapshot written before history reporting existed alone", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const state = defaultState();
		const { reportHistory: _reportHistory, ...settings } = state.settings;
		await writeFile(join(path, "state.json"), JSON.stringify({ ...state, settings }));

		// Nothing backfills it: every reader compares against false, so absent reads as on.
		const loaded = await new StateStore(path).load();
		expect(loaded.settings.reportHistory).toBeUndefined();
		expect(() => validateState(loaded)).not.toThrow();
		expect(() => validateState({ ...loaded, settings: { ...loaded.settings, reportHistory: "yes" } })).toThrow();
	});

	it("drops the download metadata an older snapshot carries", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		const state = {
			...defaultState(),
			downloads: [
				{
					track: { id: "track", title: "Track", artists: [], durationSeconds: 120 },
					fingerprint: { itag: 251, mimeType: "audio/webm", codec: "opus", bitrate: 128_000, durationMs: 120_000 },
				},
			],
		};
		await writeFile(join(path, "state.json"), JSON.stringify(state));
		const store = new StateStore(path);

		expect(await store.load()).not.toHaveProperty("downloads");
		// The files themselves go on the same startup, in main, which owns that path.
		await store.save(store.snapshot);
		expect(JSON.parse(await readFile(join(path, "state.json"), "utf8"))).not.toHaveProperty("downloads");
	});

	it("renames corrupt state and returns safe defaults", async () => {
		const path = await mkdtemp(join(tmpdir(), "neotune-state-"));
		paths.push(path);
		await writeFile(join(path, "state.json"), "{broken");
		const store = new StateStore(path);
		const state = await store.load();
		expect(state.playback.status).toBe("idle");
	});
});
