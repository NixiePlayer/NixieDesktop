import { diagnosticError } from "#/shared/diagnostics";

export function reportRendererError(kind: "error" | "unhandledrejection" | "react" | "playback", error: unknown) {
	// A failed reporting bridge must not recursively report its own rejection.
	void window.nixie?.local.rendererError(kind, diagnosticError(error)).catch(() => undefined);
}
