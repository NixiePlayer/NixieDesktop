import type { RepeatMode } from "./contracts";

interface QueueMove {
	index: number;
	shouldStop: boolean;
}

export function nextQueueIndex(
	index: number,
	length: number,
	repeat: RepeatMode,
	direction: "next" | "previous" = "next",
	random: () => number = Math.random,
	shuffle = false
): QueueMove {
	if (length === 0) return { index: -1, shouldStop: true };
	if (repeat === "one" && direction === "next") return { index, shouldStop: false };
	if (shuffle && length > 1) {
		const offset = 1 + Math.floor(random() * (length - 1));
		return { index: (index + offset) % length, shouldStop: false };
	}

	const next = index + (direction === "next" ? 1 : -1);
	if (next >= 0 && next < length) return { index: next, shouldStop: false };
	if (repeat === "all") return { index: next < 0 ? length - 1 : 0, shouldStop: false };
	return { index: Math.min(Math.max(next, 0), length - 1), shouldStop: true };
}
