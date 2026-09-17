import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
// Imported for its side effect: it paints the mirrored choice before the first render, so the
// window never opens on one appearance and swaps to the other once the state file answers.
import "./lib/theme";
// Also for its side effect: it stamps the platform on the document before the first render, so the top
// bar reserves the right space for the window controls on the first frame rather than a frame later.
import "./lib/platform";
// And for its side effect: it resolves the mirrored language before the first render, so the window
// never opens in one language and redraws in the other once the state file answers.
import "./lib/i18n";
import { reportRendererError } from "./lib/diagnostics";
import { router } from "./router";

window.addEventListener("error", (event) => reportRendererError("error", event.error));
window.addEventListener("unhandledrejection", (event) => reportRendererError("unhandledrejection", event.reason));

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement, {
		onCaughtError: (error) => reportRendererError("react", error),
		onUncaughtError: (error) => reportRendererError("react", error),
	});
	root.render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>
	);
}
