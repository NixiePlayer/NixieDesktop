import type { LyricsResult, Track } from "../shared/contracts";

/**
 * Main asks the providers and ranks them, so nothing is decided here: putting the ranking on this
 * side would duplicate the rule main already needs to know when to stop asking.
 */
/**
 * Answers already in hand, by track id, so going back to a track draws its lyrics at once instead of
 * a skeleton and three provider requests. `null` is a held "none". A failed request is not held.
 * ponytail: capped, oldest out; lyrics do not change within a session.
 */
export const heldLyrics = new Map<string, LyricsResult | null>();
const LYRICS_LIMIT = 50;

export async function loadLyrics(track: Track): Promise<LyricsResult | undefined> {
	if (!window.nixie) return;
	const held = heldLyrics.get(track.id);
	if (held !== undefined) return held ?? undefined;

	const query = new URLSearchParams({
		id: track.id,
		track: track.title,
		artist: track.artists[0]?.name ?? "",
		album: track.album?.title ?? "",
		duration: String(Math.round(track.durationSeconds)),
	});
	const response = await fetch(`nixie://app/lyrics?${query}`);
	if (!response.ok) return;
	const result = (await response.json()) as LyricsResult | null;
	heldLyrics.set(track.id, result);
	const oldest = heldLyrics.keys().next().value;
	if (heldLyrics.size > LYRICS_LIMIT && oldest) heldLyrics.delete(oldest);
	return result ?? undefined;
}
