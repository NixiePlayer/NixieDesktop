import type { RepeatMode, Track } from "./contracts";

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

/**
 * `nextQueueIndex`, stepping over rows that will not play. Bounded by the queue's length, so a queue
 * of nothing else stops rather than spins; under shuffle each row it lands on rolls again.
 */
export function nextPlayableIndex(
	queue: Track[],
	index: number,
	repeat: RepeatMode,
	direction: "next" | "previous",
	random: () => number,
	shuffle: boolean,
	playable: (track: Track) => boolean
): QueueMove {
	let result = nextQueueIndex(index, queue.length, repeat, direction, random, shuffle);
	for (let step = 0; step < queue.length && !result.shouldStop; step++) {
		const track = queue[result.index];
		if (!track || playable(track)) return result;
		result = nextQueueIndex(result.index, queue.length, repeat, direction, random, shuffle);
	}
	return { index: result.index, shouldStop: true };
}
