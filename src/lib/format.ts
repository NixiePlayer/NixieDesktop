export function plural(count: number, singular: string, many = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : many}`;
}

/**
 * A size on disk, in the unit that keeps it readable. Megabytes up to a gigabyte and gigabytes above,
 * since a downloads folder crosses that line and "3.100 MB" reads as a number rather than a size.
 */
export function formatBytes(bytes: number): string {
	const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
	const gigabytes = safe >= 1e9;
	return new Intl.NumberFormat(undefined, {
		style: "unit",
		unit: gigabytes ? "gigabyte" : "megabyte",
		maximumFractionDigits: gigabytes ? 1 : 0,
	}).format(safe / (gigabytes ? 1e9 : 1e6));
}

/** A whole release runs to hours, where a track's `m:ss` stops reading as a length. */
export function formatTotalDuration(seconds: number): string {
	const minutes = Math.round(Math.max(seconds, 0) / 60);
	const hours = Math.floor(minutes / 60);
	return hours ? `${hours} hr ${minutes % 60} min` : `${minutes} min`;
}

const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

/**
 * A play count restated in full. Upstream only ever states it abbreviated ("96M plays"), and the
 * exact figure is nowhere in the response, so the suffix is multiplied back out and the digits are
 * grouped with dots: "96.000.000". Upstream's own wording is dropped, since the column above the
 * number names it.
 *
 * Undefined when the count is not one this can read, which leaves the cell empty rather than a
 * thousandfold short: the wording is localised, and a magnitude stated as a word of its own
 * ("96 Mln", "96 Mio.") is a multiplier, not the "plays" it sits where.
 */
export function expandPlays(plays: string): string | undefined {
	const [count = "", ...rest] = plays.trim().split(/\s+/);
	const [, digits, attached] = /^([\d.,]+)([KMB])?$/i.exec(count) ?? [];
	if (!digits) return;
	const detached = !attached && /^[KMB]$/i.test(rest[0] ?? "") ? rest.shift() : undefined;
	if (rest.some((word) => /^[KMB]/i.test(word))) return;
	const suffix = attached ?? detached;
	const value = suffix
		? Number(digits.replace(",", ".")) * (SCALE[suffix.toUpperCase()] ?? Number.NaN)
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
