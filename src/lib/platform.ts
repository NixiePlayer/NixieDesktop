import type { NixiePlatform } from "#/shared/contracts";

/**
 * The platform on the document before the first render, for the same reason the theme is: the padding
 * that clears the macOS traffic lights, or the space the Windows and Linux window controls occupy in
 * the page, cannot arrive a frame after the top bar is drawn. The bridge is absent under Vitest and
 * `vite preview`, where Linux is the honest default: it is the platform whose chrome the app draws none
 * of, so nothing is reserved.
 */
export const platform: NixiePlatform = window.nixie?.app.platform ?? "linux";
export const isMac = platform === "darwin";

document.documentElement.dataset.platform = platform;
