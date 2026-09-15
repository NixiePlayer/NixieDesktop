import type { Messages } from "#/shared/i18n";

/** A whole release runs to hours, where a track's `m:ss` stops reading as a length. */
export function formatTotalDuration(seconds: number, m: Messages): string {
	const minutes = Math.round(Math.max(seconds, 0) / 60);
	return m.common.totalDuration(Math.floor(minutes / 60), minutes % 60);
}

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, mila: 1e3, mln: 1e6, mld: 1e9 };

/**
 * A play count restated in full. Upstream only ever states it abbreviated ("96M plays", "541 Mln
 * riproduzioni"), and the exact figure is nowhere in the response, so the multiplier is multiplied back
 * out and the digits are grouped with dots: "96.000.000". Upstream's own wording is dropped, since the
 * column above the number names it. The multipliers read are English's attached or detached K, M and B
 * and Italian's detached "mila", "Mln" and "Mld", in any case, since those are the two languages the
 * session is ever answered in.
 *
 * Undefined when the count is not one this can read, which leaves the cell empty rather than a
 * thousandfold short: a magnitude stated as a word this does not know ("96 Mio.") is still a
 * multiplier, not the "plays" it sits where.
 */
export function expandPlays(plays: string): string | undefined {
	const [count = "", ...rest] = plays.trim().split(/\s+/);
	const [, digits, attached] = /^([\d.,]+)([KMB])?$/i.exec(count) ?? [];
	if (!digits) return;
	const detached = !attached && SCALE[rest[0]?.toLowerCase() ?? ""] ? rest.shift() : undefined;
	if (rest.some((word) => /^[KMB]/i.test(word))) return;
	const suffix = attached ?? detached;
	const value = suffix
		? Number(digits.replace(",", ".")) * (SCALE[suffix.toLowerCase()] ?? Number.NaN)
		: /^\d{1,3}([.,]\d{3})*$/.test(digits)
			? Number(digits.replaceAll(/[.,]/g, ""))
			: Number.NaN;
	return Number.isFinite(value) ? Math.round(value).toLocaleString("it-IT") : undefined;
}

export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const total = Math.floor(seconds);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
