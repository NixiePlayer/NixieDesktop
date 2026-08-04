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

export function durationsMatch(expectedSeconds: number, candidateSeconds: number, toleranceSeconds = 3) {
	return Math.abs(expectedSeconds - candidateSeconds) <= toleranceSeconds;
}
