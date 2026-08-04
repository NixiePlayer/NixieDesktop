import type { Theme } from "#/shared/contracts";

const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
let current: Theme = "system";

function paint() {
	const resolved = current === "system" ? (query?.matches ? "dark" : "light") : current;
	document.documentElement.dataset.theme = resolved;
}

/** Single owner of the `data-theme` attribute. Safe to call before settings have loaded. */
export function applyTheme(theme: Theme) {
	current = theme;
	paint();
}

query?.addEventListener("change", () => {
	if (current === "system") paint();
});
