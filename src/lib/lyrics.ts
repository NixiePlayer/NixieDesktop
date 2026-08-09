import type { LyricsResult, Track } from "../shared/contracts";

/**
 * Main asks the providers and ranks them, so nothing is decided here: putting the ranking on this
 * side would duplicate the rule main already needs to know when to stop asking.
 */
export async function loadLyrics(track: Track): Promise<LyricsResult | undefined> {
	if (!window.neotune) return;

	const query = new URLSearchParams({
		id: track.id,
		track: track.title,
		artist: track.artists[0]?.name ?? "",
		album: track.album?.title ?? "",
		duration: String(Math.round(track.durationSeconds)),
	});
	const response = await fetch(`neotune://app/lyrics?${query}`);
	if (!response.ok) return;
	return ((await response.json()) as LyricsResult | null) ?? undefined;
}
