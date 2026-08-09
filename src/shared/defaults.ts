import type { PersistedState } from "./contracts";

export function defaultState(): PersistedState {
	return {
		version: 1,
		playback: {
			queue: [],
			queueIndex: -1,
			positionSeconds: 0,
			volume: 0.72,
			repeat: "off",
			shuffle: false,
			status: "idle",
		},
		settings: {
			theme: "dark",
			quality: "high",
			normalization: "normal",
			volume: 0.72,
			reportHistory: true,
		},
		recentSearches: [],
	};
}
