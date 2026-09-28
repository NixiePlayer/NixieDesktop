import type { LyricsLine, LyricsResult, LyricsSource, LyricsWord } from "./contracts";
import { durationsMatch, parseLrc, parseYrc } from "./lrc";

/** One provider's answer, still unparsed, so ranking and parsing stay in one tested place. */
export interface LyricsCandidate {
	source: LyricsSource;
	/** The length upstream gave for its own match. Undefined when it stated none. */
	durationSeconds?: number;
	syncedLyrics?: string;
	/** NetEase's `yrc` word timing. Used over `syncedLyrics` whenever it holds any lyrics. */
	wordSyncedLyrics?: string;
	plainLyrics?: string;
	instrumental?: boolean;
	attribution?: string;
}

/** Best to worst, the tie-break inside a quality tier. */
const priority: LyricsSource[] = ["LRCLIB", "NetEase", "YouTube Music"];

/** Lower is better. 4 is not worth showing. */
function quality(result: LyricsResult) {
	if (result.lines.some((line) => line.words)) return 0;
	if (result.lines.length) return 1;
	if (result.instrumental) return 2;
	if (result.plainLyrics) return 3;
	return 4;
}

/** The best quality each provider can return at all, which is what bounds how far the lookup goes. */
const ceiling: Record<LyricsSource, number> = { "LRCLIB": 1, "NetEase": 0, "YouTube Music": 3 };

/**
 * Nothing a provider still to be asked could return would beat this, so the caller can stop asking.
 * A later provider only wins on strictly better quality, since a tie goes to source order and the
 * providers are asked in that order. An instrumental marking is upstream stating there is no text to
 * find, so it stops the lookup however much better a later provider could have done.
 */
export function isBestPossible(result: LyricsResult | undefined, remaining: LyricsSource[]) {
	if (!result) return false;
	return result.instrumental || remaining.every((source) => quality(result) <= ceiling[source]);
}

/**
 * The single ranking authority: quality first, then source order. A synced result from any provider
 * beats a plain one from the provider above it, which is the whole point of having more than one, and
 * a word-synced one beats a line-synced one the same way.
 */
export function pickBest(candidates: LyricsCandidate[], durationSeconds: number) {
	return candidates
		.filter((candidate) => matchesLength(candidate, durationSeconds))
		.map(toResult)
		.filter((result) => quality(result) < 4)
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
	const worded = candidate.wordSyncedLyrics ? stripCredits(parseYrc(candidate.wordSyncedLyrics)) : [];
	const timed = candidate.syncedLyrics ? parseLrc(candidate.syncedLyrics) : [];
	const lines = worded.some((line) => line.text) ? worded : stripCredits(timed);
	const instrumental = candidate.instrumental === true || isInstrumentalMarker(lines);
	return {
		source: candidate.source,
		instrumental,
		lines: instrumental ? [] : markGaps(lines.map(splitBackground)),
		// No timestamps anywhere means the "synced" field was really plain text all along. A file that
		// did parse falls back to nothing instead, or a credits-only one comes back as its own raw text.
		plainLyrics: instrumental
			? undefined
			: (candidate.plainLyrics ?? (timed.length ? undefined : candidate.syncedLyrics)),
		attribution: candidate.attribution,
	};
}

/** Silence at least this long reads as an instrumental break and gets its dots. */
const GAP_SECONDS = 7;

/**
 * Turns every silence of `GAP_SECONDS` or more into an empty line running to the next sung line, and
 * drops every other empty line. A silence starts at 0 for the intro, where a word-synced line states
 * it stops singing, or at the empty line an LRC file puts after a block. A line-synced file with no
 * such line gets dots for its intro only: without an end time, a long held note and an instrumental
 * break look the same, and this does not guess between them.
 */
function markGaps(lines: LyricsLine[]) {
	const marked: LyricsLine[] = [];
	let silentFrom: number | undefined = 0;
	for (const line of lines) {
		if (!line.text && !line.background) {
			silentFrom ??= line.timeSeconds;
			continue;
		}
		if (silentFrom !== undefined && line.timeSeconds - silentFrom >= GAP_SECONDS) {
			marked.push({ timeSeconds: silentFrom, endSeconds: line.timeSeconds, text: "" });
		}
		marked.push(line);
		silentFrom = line.endSeconds;
	}
	return marked;
}

// NetEase writes its parentheses full width, as tokens of their own in a word-synced file.
const parenthesised = /[(（]([^()（）]*)[)）]/g;

/**
 * Takes a line's parenthesised part out as its backing vocal. An unclosed parenthesis, which is a
 * backing vocal an LRC file carries across two lines, is left in the lead text rather than guessed at.
 * ponytail: a parenthesised aside that is not a backing vocal is drawn small as well.
 */
function splitBackground(line: LyricsLine): LyricsLine {
	if (line.words) return splitWords(line, line.words);
	const background = [...line.text.matchAll(parenthesised)]
		.map((match) => (match[1] ?? "").trim())
		.filter(Boolean)
		.join(" ");
	if (!background) return line;
	return { ...line, text: collapse(line.text.replace(parenthesised, " ")), background };
}

/** The same split on timed words, where a backing vocal usually spans several of them. */
function splitWords(line: LyricsLine, words: LyricsWord[]): LyricsLine {
	const background = new Set<number>();
	let open: number | undefined;
	words.forEach((word, index) => {
		if (/[(（]/.test(word.text)) open = index;
		if (/[)）]/.test(word.text) && open !== undefined) {
			for (let inside = open; inside <= index; inside++) background.add(inside);
			open = undefined;
		}
	});
	if (!background.size) return line;
	const split = words.map((word, index) =>
		background.has(index) ? { ...word, text: word.text.replace(/[()（）]/g, ""), background: true } : word
	);
	const join = (sung: LyricsWord[]) => collapse(sung.map((word) => word.text).join(""));
	return {
		...line,
		text: join(split.filter((word) => !word.background)),
		background: join(split.filter((word) => word.background)) || undefined,
		words: split,
	};
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

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
