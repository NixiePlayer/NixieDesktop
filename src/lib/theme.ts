import type { Theme } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";

/**
 * The choice is mirrored here on every write, because the state file is only reachable over IPC and
 * the answer arrives a frame or two after the first paint. Anything reading the stored theme before
 * then (the document's own attribute, the selected card on `/settings`) would otherwise render the
 * default first and correct itself in view. The state file stays the owner: `__root` applies what it
 * loads, which is what repairs a mirror that ever falls behind.
 */
const KEY = "nixie.theme";
const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;

function mirrored(): Theme {
	const stored = localStorage.getItem(KEY);
	return stored === "dark" || stored === "light" || stored === "system" ? stored : defaultState().settings.theme;
}

let current: Theme = mirrored();

function paint() {
	const resolved = current === "system" ? (query?.matches ? "dark" : "light") : current;
	document.documentElement.dataset.theme = resolved;
}

/** The stored choice, synchronously. `system` is the choice, not the appearance it resolves to. */
export function storedTheme(): Theme {
	return current;
}

/** Single owner of the `data-theme` attribute. Safe to call before settings have loaded. */
export function applyTheme(theme: Theme) {
	current = theme;
	localStorage.setItem(KEY, theme);
	paint();
}

// Before the first paint: this module is imported from `main.tsx` ahead of the render.
paint();

query?.addEventListener("change", () => {
	if (current === "system") paint();
});
