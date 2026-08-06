import type { NormalizationLevel } from "./contracts";

/**
 * The loudness targets Spotify publishes for its three levels. -14 LUFS is also what YouTube
 * itself normalizes to, so the default reproduces the gain YouTube would have applied.
 */
export const normalizationTargets: Record<Exclude<NormalizationLevel, "off">, number> = {
	quiet: -19,
	normal: -14,
	loud: -11,
};

/**
 * What an unmeasured stream is assumed to be. A response naming no loudness is rare, and the
 * obvious fallback of the target itself is the one that hurts: it resolves to no attenuation at
 * all, so a loud master with no measurement plays several dB over everything around it, which is
 * the ears of whoever had the volume set for the last track. Assuming a loud master instead makes
 * the failure quiet rather than painful, and a track that was actually quiet only plays low.
 */
export const assumedIntegratedLufs = -9;

/**
 * The ceiling on the lift, and the reason there is one: YouTube publishes an integrated loudness
 * and no true peak, so how much headroom sits above a track's samples is unknown. A quiet, dynamic
 * master can already be peaking near full scale, and a lift sized off the loudness alone drives
 * those peaks past 0 dBFS, where the destination clips them. 6 dB is the range that actually
 * occurs: it carries a -19 LUFS master to -14 exactly.
 *
 * ponytail: fixed 6 dB ceiling, chosen because the true peak is unknowable from the response
 * alone. Measuring it off the decoded stream, or putting a limiter on the master bus, would size
 * each lift to its own headroom and let the cap go.
 */
export const maxBoostDb = 6;

/**
 * YouTube publishes the integrated loudness it measured for every stream: the same number
 * stats for nerds shows as "content loudness", so no local analysis is needed.
 *
 * A track over the target is pulled all the way down to it, and a track under it is raised to it,
 * capped at maxBoostDb. Attenuating only is half the job: a quiet master left where it was is the
 * gap the listener reaches for the volume knob to close, which is what normalization exists to
 * spare them.
 */
export function normalizationGainDb(integratedLufs: number | undefined, targetLufs = normalizationTargets.normal) {
	return Math.min(targetLufs - (integratedLufs ?? assumedIntegratedLufs), maxBoostDb);
}

export function dbToLinear(db: number) {
	return 10 ** (db / 20);
}

/**
 * The slider position is not a gain. Written straight onto the bus, half the slider is -6 dB,
 * which the ear reads as about two thirds as loud, so the whole top half of the travel sounds
 * like almost nothing happens. Perceived loudness halves every 10 dB instead, so the position
 * is read as a doubling count: half the slider is -10 dB, a quarter -20 dB, and each step down
 * halves what is heard. A position of 0 is silence, since log2(0) is -Infinity and 10 ** -Infinity
 * is 0.
 */
export function volumeGain(volume: number) {
	return dbToLinear(10 * Math.log2(volume));
}
