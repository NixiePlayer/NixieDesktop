/**
 * The country codes `gl` takes, recovered from the names a chart's region picker states.
 *
 * That picker is the only list of regions YouTube Music serves that this app already has, and every
 * option in it is a browse rather than a code: upstream names the country and nothing else. So the
 * name is matched back to its ISO 3166 alpha-2 code through `Intl.DisplayNames`, which is the same
 * table the platform already ships. No country list is written here, and nothing goes stale when
 * YouTube adds a region.
 */

const maps = new Map<string, Map<string, string>>();

/** Every alpha-2 code the platform names, keyed by that name folded for comparison. */
function namesFor(locale: string): Map<string, string> {
	const cached = maps.get(locale);
	if (cached) return cached;
	const display = new Intl.DisplayNames([locale], { type: "region" });
	const map = new Map<string, string>();
	for (let first = 65; first <= 90; first++) {
		for (let second = 65; second <= 90; second++) {
			const code = String.fromCharCode(first, second);
			// An unknown code is handed straight back, which is how a real region is told from the rest.
			const name = display.of(code);
			if (name && name !== code) map.set(fold(name), code);
		}
	}
	maps.set(locale, map);
	return map;
}

/** Case, accents and punctuation all vary between upstream's wording and the platform's. */
const fold = (value: string) =>
	value
		.normalize("NFD")
		.replaceAll(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replaceAll(/[^a-z0-9]/g, "");

/**
 * Undefined when no locale names this region, which drops the option rather than sending upstream a
 * code that means somewhere else. The session language is unset, so upstream answers in English
 * unless the account is set otherwise, and the reader's own locale covers that case.
 */
export function regionCode(name: string, locale = "en"): string | undefined {
	const folded = fold(name);
	return namesFor("en").get(folded) ?? namesFor(locale).get(folded);
}
