import { useSyncExternalStore } from "react";
import {
	isLanguageSetting,
	messagesFor,
	resolveLanguage,
	type Language,
	type LanguageSetting,
	type Messages,
} from "#/shared/i18n";

/**
 * The renderer's language, owned here the way `theme.ts` owns the appearance and for the same reason:
 * the state file is an IPC round trip away, so the choice is mirrored into `localStorage` and read at
 * import, ahead of the first render. A window opened in English and redrawn in Italian a frame later
 * is the glitch the mirror exists to prevent. The state file stays the owner: `__root` applies what it
 * loads, which repairs a mirror that ever falls behind. A fresh install has no mirror and no stored
 * setting, which is `system`: the device's own preferred languages decide.
 *
 * Components read it through `useMessages()`, which re-renders them when the language changes. Code
 * outside React (a toast raised from a store, an engine error) reads `messages()` at the moment it
 * speaks, which is always the current language.
 */
const KEY = "nixie.language";

function mirrored(): LanguageSetting {
	try {
		const stored = localStorage.getItem(KEY);
		return isLanguageSetting(stored) ? stored : "system";
	} catch {
		return "system";
	}
}

const preferred = () => (typeof navigator === "undefined" ? [] : navigator.languages);

let setting = mirrored();
let resolved = resolveLanguage(setting, preferred());
const listeners = new Set<() => void>();

function stamp() {
	if (typeof document !== "undefined") document.documentElement.lang = resolved;
}

/** The stored choice, synchronously. `system` is the choice, not the language it resolves to. */
export function storedLanguage(): LanguageSetting {
	return setting;
}

/** The language the app is drawn in right now. */
export function language(): Language {
	return resolved;
}

export function messages(): Messages {
	return messagesFor(resolved);
}

/** Single owner of the renderer's language. Safe to call before settings have loaded. */
export function applyLanguage(next: LanguageSetting | undefined) {
	setting = next ?? "system";
	try {
		localStorage.setItem(KEY, setting);
	} catch {
		// A storage that refuses the write only costs the first frame of the next launch.
	}
	const before = resolved;
	resolved = resolveLanguage(setting, preferred());
	stamp();
	if (resolved !== before) for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useMessages(): Messages {
	return useSyncExternalStore(subscribe, messages);
}

// Before the first paint: this module is imported from `main.tsx` ahead of the render.
stamp();
