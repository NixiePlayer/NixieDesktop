export interface ByteRange {
	start: number;
	end: number;
}

export function parseByteRange(header: string | null, contentLength?: number): ByteRange | undefined {
	if (!header) return;
	const match = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!match || (!match[1] && !match[2])) throw new RangeError("Invalid Range header");

	if (!match[1]) {
		if (!contentLength) throw new RangeError("Unknown content length");
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new RangeError("Invalid suffix range");
		return { start: Math.max(contentLength - suffix, 0), end: contentLength - 1 };
	}

	const start = Number(match[1]);
	const end = match[2] ? Number(match[2]) : contentLength ? contentLength - 1 : start + 1_048_575;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start > end ||
		(contentLength && start >= contentLength)
	) {
		throw new RangeError("Unsatisfiable Range header");
	}
	return { start, end: contentLength ? Math.min(end, contentLength - 1) : end };
}
