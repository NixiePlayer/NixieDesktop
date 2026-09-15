import { en } from "../locales/en";
import { it } from "../locales/it";

/**
 * The languages the app is written in. A dictionary is plain data plus a few functions for the strings
 * that take a count or a name, so the English one is the type every other language has to satisfy:
 * a key missing from a translation is a type error, not a hole a reader finds.
 */
export type Messages = typeof en;
export type Language = "en" | "it";
/** What is stored. `system` follows the device and is what a fresh install starts on. */
export type LanguageSetting = Language | "system";

const dictionaries: Record<Language, Messages> = { en, it };

export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "system" || value === "en" || value === "it";
}

/**
 * The language a setting resolves to. `system` takes the first of the device's preferred languages the
 * app has a dictionary for, so a reader who prefers French and then Italian gets Italian, and anyone
 * else gets English.
 */
export function resolveLanguage(setting: LanguageSetting | undefined, preferred: readonly string[]): Language {
	if (setting && setting !== "system") return setting;
	for (const tag of preferred) {
		const base = tag.toLowerCase().split(/[-_]/)[0];
		if (base === "en" || base === "it") return base;
	}
	return "en";
}

export function messagesFor(language: Language): Messages {
	return dictionaries[language];
}
