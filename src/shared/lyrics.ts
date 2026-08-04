import type { LyricsLine, LyricsResult, LyricsSource } from "./contracts";
import { durationsMatch, parseLrc } from "./lrc";

/** One provider's answer, still unparsed, so ranking and parsing stay in one tested place. */
export interface LyricsCandidate {
	source: LyricsSource;
	/** The length upstream gave for its own match. Undefined when it stated none. */
	durationSeconds?: number;
	syncedLyrics?: string;
	plainLyrics?: string;
	instrumental?: boolean;
	attribution?: string;
}

/** Best to worst, the tie-break inside a quality tier. */
const priority: LyricsSource[] = ["LRCLIB", "NetEase", "YouTube Music"];

/** Lower is better. 3 is not worth showing. */
function quality(result: LyricsResult) {
	if (result.lines.length) return 0;
	if (result.instrumental) return 1;
	if (result.plainLyrics) return 2;
	return 3;
}

/**
 * Nothing a later provider could return would beat this, so the caller can stop asking. Synced is
 * the top tier, and an instrumental marking is upstream stating there is no text to find.
 */
export function isBestPossible(result: LyricsResult | undefined) {
	return result !== undefined && quality(result) <= 1;
}

/**
 * The single ranking authority: quality first, then source order. A synced result from any provider
 * beats a plain one from the provider above it, which is the whole point of having more than one.
 */
export function pickBest(candidates: LyricsCandidate[], durationSeconds: number) {
	return candidates
		.filter((candidate) => matchesLength(candidate, durationSeconds))
		.map(toResult)
		.filter((result) => quality(result) < 3)
		.sort((a, b) => quality(a) - quality(b) || priority.indexOf(a.source) - priority.indexOf(b.source))
		.at(0);
}

/**
 * Half the rows in this app carry no duration, and neither does every provider's match, so a missing
 * length on either side means the candidate is taken on the provider's own ranking instead of being
 * filtered out. Comparing against a zero would reject everything.
 */
function matchesLength(candidate: LyricsCandidate, durationSeconds: number) {
	if (!durationSeconds || !candidate.durationSeconds) return true;
	return durationsMatch(durationSeconds, candidate.durationSeconds);
}

function toResult(candidate: LyricsCandidate): LyricsResult {
	const timed = candidate.syncedLyrics ? parseLrc(candidate.syncedLyrics) : [];
	const lines = stripCredits(timed);
	const instrumental = candidate.instrumental === true || isInstrumentalMarker(lines);
	return {
		source: candidate.source,
		instrumental,
		lines: instrumental ? [] : lines,
		// No timestamps anywhere means the "synced" field was really plain text all along. A file that
		// did parse falls back to nothing instead, or a credits-only one comes back as its own raw text.
		plainLyrics: instrumental
			? undefined
			: (candidate.plainLyrics ?? (timed.length ? undefined : candidate.syncedLyrics)),
		attribution: candidate.attribution,
	};
}

/** A short label before a colon, which is how every credit line reads in any language. */
const creditLine = /^[^:：]{1,30}[:：]\s*\S/;

/**
 * NetEase stamps its writing and production credits as real LRC lines at the head of the file, so
 * they would otherwise render as the opening lyrics and hold the active line into the first verse.
 * They are the leading run of labelled lines, and that run reaches past two seconds on some tracks
 * while a real opening line can be timed at 0.1, so it is contiguity that ends it rather than a time
 * window: the first line that reads like a lyric stops it, and the blank separator NetEase puts
 * between the two blocks is carried out with the credits.
 * ponytail: bounded to the first twelve lines, so a genuine opening line holding a colon costs that
 * one line rather than the song. Match on the role words themselves if that ever shows up.
 */
function stripCredits(lines: LyricsLine[]) {
	let end = 0;
	let credits = 0;
	while (end < lines.length && end < 12) {
		const text = lines[end]?.text ?? "";
		if (text && !creditLine.test(text)) break;
		if (text) credits++;
		end++;
	}
	return credits ? lines.slice(end) : lines;
}

/**
 * NetEase answers an instrumental with a stock one-line notice rather than the `nolyric` flag it
 * also has, and showing that notice as the lyrics is worse than showing none.
 */
function isInstrumentalMarker(lines: LyricsLine[]) {
	const written = lines.filter((line) => line.text);
	return written.length === 1 && (written[0]?.text ?? "").startsWith("纯音乐");
}
