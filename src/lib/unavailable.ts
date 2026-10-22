import { useSyncExternalStore } from "react";
import type { Track } from "#/shared/contracts";

/**
 * Tracks upstream refused when asked to play them, this session. A list states its own refusals when
 * it is fetched (`Track.unavailable`), but a track that list did not grey out is only found by asking,
 * and from then on every row of it, on any page and in the queue, has to say so.
 *
 * ponytail: kept until the app quits, though a refusal can be regional. Clear it on a region or
 * account change if a track that became playable ever stays greyed.
 */
const refused = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function markUnavailable(trackId: string) {
	if (refused.has(trackId)) return;
	refused.add(trackId);
	listeners.forEach((listener) => listener());
}

export const isUnavailable = (track: Track) => track.unavailable === true || refused.has(track.id);

/** `isUnavailable`, re-rendering the caller whenever another track is refused. A list calls it once. */
export function useIsUnavailable() {
	useSyncExternalStore(subscribe, () => refused.size);
	return isUnavailable;
}
