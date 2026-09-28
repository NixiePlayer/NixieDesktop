import type { LyricsLine } from "./contracts";

// NetEase stamps a credit-only file `[00:00.00-1]`, and a tag it does not parse is a tag that
// survives into the text, which then reads as plain lyrics with the brackets still in it.
const timestamp = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?(?:-\d+)?\]/g;

export function parseLrc(value: string): LyricsLine[] {
	const lines: LyricsLine[] = [];

	for (const row of value.split(/\r?\n/)) {
		const text = row.replace(timestamp, "").trim();
		for (const match of row.matchAll(timestamp)) {
			const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0")}`) : 0;
			lines.push({ timeSeconds: Number(match[1]) * 60 + Number(match[2]) + fraction, text });
		}
	}

	return lines.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

const yrcLine = /^\[(\d+),(\d+)\](.*)$/;
// A word runs to the next timing tag, since a backing vocal opens its first word with a parenthesis.
const yrcWord = /\((\d+),(\d+),\d+\)((?:(?!\(\d+,\d+,\d+\)).)*)/g;

/**
 * NetEase's word-synced format: `[lineStartMs,lineDurationMs]` then `(wordStartMs,wordDurationMs,0)word`
 * for each word, with the space after a word kept in its text. The credit lines at the head come as
 * either the same form or as JSON objects, which are skipped here and left to the credit strip.
 */
export function parseYrc(value: string): LyricsLine[] {
	const lines: LyricsLine[] = [];
	for (const row of value.split(/\r?\n/)) {
		const line = yrcLine.exec(row.trim());
		if (!line) continue;
		const words = [...(line[3] ?? "").matchAll(yrcWord)].map((word) => ({
			text: word[3] ?? "",
			startSeconds: Number(word[1]) / 1000,
			endSeconds: (Number(word[1]) + Number(word[2])) / 1000,
		}));
		const timeSeconds = Number(line[1]) / 1000;
		lines.push({
			timeSeconds,
			endSeconds: timeSeconds + Number(line[2]) / 1000,
			text: words
				.map((word) => word.text)
				.join("")
				.trim(),
			words,
		});
	}
	return lines.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function durationsMatch(expectedSeconds: number, candidateSeconds: number, toleranceSeconds = 3) {
	return Math.abs(expectedSeconds - candidateSeconds) <= toleranceSeconds;
}
