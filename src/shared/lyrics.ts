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

/**
 * Nothing a provider still to be asked could return would beat this, so the caller can stop asking.
 * A later provider only wins on strictly better quality, since a tie goes to source order and the
 * providers are asked in that order. An instrumental marking is upstream stating there is no text to
 * find, so it stops the lookup however much better a later provider could have done. NetEase can
 * only beat a line-synced answer when it is asked for `wordTiming`; without it a line-synced LRCLIB
 * answer ends the lookup, as it did before word timing existed.
 */
export function isBestPossible(result: LyricsResult | undefined, remaining: LyricsSource[], wordTiming: boolean) {
	if (!result) return false;
	// The best quality each provider can return at all, which is what bounds how far the lookup goes.
	const ceiling: Record<LyricsSource, number> = { "LRCLIB": 1, "NetEase": wordTiming ? 0 : 1, "YouTube Music": 3 };
	return result.instrumental || remaining.every((source) => quality(result) <= ceiling[source]);
}

/**
 * The single ranking authority: quality first, then source order. A synced result from any provider
 * beats a plain one from the provider above it, which is the whole point of having more than one, and
 * a word-synced one beats a line-synced one the same way. `title` is the track's own, used only to
 * spot a provider stamping it as the first line.
 */
export function pickBest(candidates: LyricsCandidate[], durationSeconds: number, title = "") {
	return candidates
		.filter((candidate) => matchesLength(candidate, durationSeconds))
		.map((candidate) => toResult(candidate, title))
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

function toResult(candidate: LyricsCandidate, title: string): LyricsResult {
	const worded = candidate.wordSyncedLyrics ? stripCredits(parseYrc(candidate.wordSyncedLyrics)) : [];
	const timed = candidate.syncedLyrics ? parseLrc(candidate.syncedLyrics) : [];
	const lines = worded.some((line) => line.text) ? worded : stripCredits(timed);
	const instrumental = candidate.instrumental === true || isInstrumentalMarker(lines);
	return {
		source: candidate.source,
		instrumental,
		lines: instrumental ? [] : markGaps(unshout(blankTitle(lines, title)).map(blankSectionLabel).map(splitBackground)),
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
 * The tail block only comes from NetEase's own `label : value` form, spaced before the colon, since a
 * closing lyric holding a colon is far more common than an opening one.
 */
const tailCreditLine = /^[^:：]{1,30}\s[:：]\s*\S/;

/**
 * NetEase stamps its writing and production credits as real LRC lines at the head of the file, and on
 * some tracks the mixing and mastering credits at its tail, so they would otherwise render as lyrics
 * and hold the active line into the first verse or past the last one. Each block is the run of
 * labelled lines at that end of the file, and the head one reaches past two seconds on some tracks
 * while a real opening line can be timed at 0.1, so it is contiguity that ends it rather than a time
 * window: the first line that reads like a lyric stops it, and the blank separator NetEase puts
 * between the blocks is carried out with the credits.
 */
function stripCredits(lines: LyricsLine[]) {
	const body = lines.slice(creditRun(lines, creditLine));
	return body.slice(0, body.length - creditRun([...body].reverse(), tailCreditLine));
}

/**
 * How many lines at the start of `lines` belong to a credit block, blank separators included.
 * ponytail: bounded to twelve lines, so a genuine first or last line read as a credit costs that one
 * line rather than the song. Match on the role words themselves if that ever shows up.
 */
function creditRun(lines: LyricsLine[], credit: RegExp) {
	let end = 0;
	let credits = 0;
	while (end < lines.length && end < 12) {
		const text = lines[end]?.text ?? "";
		if (text && !credit.test(text)) break;
		if (text) credits++;
		end++;
	}
	return credits ? end : 0;
}

const section = String.raw`(?:(?:pre|post)-?\s?)?(?:intro|verse|chorus|hook|bridge|refrain|interlude|instrumental|outro|前奏|主歌|导歌|副歌|桥段|间奏|尾奏)(?:\s*\d+)?`;
/** `[Verse 1]`, `【副歌】`, `(Chorus: Artist)` or `Bridge:`, and nothing else on the line. */
const sectionLabel = new RegExp(
	String.raw`^(?:[[【(（]\s*${section}(?:\s*[:：].*)?\s*[\]】)）]|${section}\s*[:：])$`,
	"iu"
);

/**
 * A song-part name is structure, not something sung. The line is kept as an empty one rather than
 * dropped, so a label heading an instrumental part still opens the break it names.
 */
function blankSectionLabel(line: LyricsLine): LyricsLine {
	return sectionLabel.test(line.text) ? { timeSeconds: line.timeSeconds, text: "" } : line;
}

/** Letters and digits only, and without the `(Remastered)` or ` - Live` a streaming title carries. */
const titleKey = (value: string) =>
	value
		.replace(/\s-\s.*$/, "")
		.replace(/[([（【][^)\]）】]*[)\]）】]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * NetEase opens some files with the song's title as a line of its own, timed like the credits before
 * it and followed by the intro. It is blanked rather than dropped, so the intro still gets its dots.
 * The break after it is what tells it from a song that opens by singing its own title.
 */
function blankTitle(lines: LyricsLine[], title: string) {
	const [first, next] = lines.filter((line) => line.text);
	if (!first || !next || !titleKey(title) || titleKey(first.text) !== titleKey(title)) return lines;
	if (next.timeSeconds - first.timeSeconds < GAP_SECONDS) return lines;
	return lines.map((line) => (line === first ? { timeSeconds: line.timeSeconds, text: "" } : line));
}

const word = /[\p{L}\p{N}'’]+/gu;
/** Capitals and no other letters, so a CJK line holding an English acronym is not one. */
const shouted = (text: string) => /\p{Lu}/u.test(text) && !/[\p{Ll}\p{Lo}]/u.test(text);

/**
 * Transcribers write a shouted part in capitals, which reads as a different kind of line rather than
 * as louder. Such a line is re-cased the way the rest of the song writes each word, learned from its
 * mixed-case lines past their first word (which is capitalised for its position), so a name or an
 * acronym keeps its capitals; a word the song never writes otherwise goes lower case, except "I".
 * ponytail: the first spelling seen wins, so a word the song also shouts inside a mixed line keeps
 * its capitals. Count spellings if that shows up.
 */
function unshout(lines: LyricsLine[]) {
	const casing = new Map<string, string>();
	for (const line of lines) {
		if (shouted(line.text)) continue;
		for (const [index, [spelling]] of [...line.text.matchAll(word)].entries()) {
			if (index && !casing.has(spelling.toLowerCase())) casing.set(spelling.toLowerCase(), spelling);
		}
	}
	return lines.map((line) => {
		if (!shouted(line.text)) return line;
		let first = true;
		const recase = (text: string) =>
			text.replace(word, (spelling) => {
				const lower = spelling.toLowerCase();
				const cased = casing.get(lower) ?? (/^i(['’]|$)/.test(lower) ? `I${lower.slice(1)}` : lower);
				if (!first) return cased;
				first = false;
				return cased.charAt(0).toUpperCase() + cased.slice(1);
			});
		const text = recase(line.text);
		first = true;
		const words = line.words?.map((timed) => ({ ...timed, text: recase(timed.text) }));
		return { ...line, text, ...(words ? { words } : {}) };
	});
}

/**
 * NetEase answers an instrumental with a stock one-line notice rather than the `nolyric` flag it
 * also has, and showing that notice as the lyrics is worse than showing none.
 */
function isInstrumentalMarker(lines: LyricsLine[]) {
	const written = lines.filter((line) => line.text);
	return written.length === 1 && (written[0]?.text ?? "").startsWith("纯音乐");
}
