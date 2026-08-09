import { rename, readFile, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PersistedState } from "../src/shared/contracts";
import { defaultState } from "../src/shared/defaults";
import { validateState } from "../src/shared/validation";

export class StateStore {
	readonly #path: string;
	#state = defaultState();
	// Every writer shares one temp path, so two overlapping saves race and the loser's rename
	// fails with ENOENT. Writes queue on this instead.
	#writing: Promise<void> = Promise.resolve();

	constructor(userDataPath: string) {
		this.#path = join(userDataPath, "state.json");
	}

	get snapshot() {
		return structuredClone(this.#state);
	}

	async load() {
		try {
			const value: unknown = JSON.parse(await readFile(this.#path, "utf8"));
			validateState(value);
			// State written while the app still stored downloads carries a list of them. The files are
			// removed on the same startup, in main, which owns that path.
			Reflect.deleteProperty(value, "downloads");
			// State written before loudness moved to YouTube's own numbers carries a dead array.
			Reflect.deleteProperty(value, "loudness");
			// State written while normalization was a switch carries a boolean.
			if (typeof value.settings.normalization === "boolean") {
				Reflect.set(value.settings, "normalization", value.settings.normalization ? "normal" : "off");
			}
			this.#state = value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				await rename(this.#path, `${this.#path}.corrupt-${Date.now()}`).catch(() => undefined);
			}
			this.#state = defaultState();
		}
		return this.snapshot;
	}

	async save(value: PersistedState) {
		validateState(value);
		const bounded: PersistedState = {
			...structuredClone(value),
			// A failure belongs to the session that hit it, so it never survives into the next one.
			playback: {
				...value.playback,
				status: value.playback.currentTrack ? "paused" : "idle",
				errorMessage: undefined,
			},
			recentSearches: value.recentSearches.slice(0, 20),
		};
		// Snapshots represent the latest accepted state, not whichever queued disk write finished last.
		this.#state = bounded;
		// The catch keeps one failed write from poisoning every later one; this caller still sees
		// its own rejection through the await below.
		this.#writing = this.#writing
			.catch(() => undefined)
			.then(async () => {
				await mkdir(dirname(this.#path), { recursive: true });
				await writeFile(`${this.#path}.tmp`, JSON.stringify(bounded), { mode: 0o600 });
				await rename(`${this.#path}.tmp`, this.#path);
			});
		await this.#writing;
	}

	setPlaybackPosition(positionSeconds: number) {
		if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 86_400) return;
		this.#state.playback.positionSeconds = positionSeconds;
	}

	async clear(selection: "session" | "all") {
		if (selection === "all") this.#state = defaultState();
		if (selection === "session") this.#state.playback = defaultState().playback;
		await this.save(this.#state);
	}
}
