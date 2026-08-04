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
 * YouTube publishes the integrated loudness it measured for every stream: the same number
 * stats for nerds shows as "content loudness", so no local analysis is needed.
 *
 * Gain is never positive. YouTube does not raise quiet tracks either, and without a true peak
 * measurement a boost can clip, so "Loud" only means less attenuation, not amplification.
 */
export function normalizationGainDb(integratedLufs: number | undefined, targetLufs = normalizationTargets.normal) {
	return Math.min(targetLufs - (integratedLufs ?? assumedIntegratedLufs), 0);
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
