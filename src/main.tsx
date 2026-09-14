import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
// Imported for its side effect: it paints the mirrored choice before the first render, so the
// window never opens on one appearance and swaps to the other once the state file answers.
import "./lib/theme";
// Also for its side effect: it stamps the platform on the document before the first render, so the top
// bar reserves the right space for the window controls on the first frame rather than a frame later.
import "./lib/platform";
import { router } from "./router";

const rootElement = document.getElementById("app")!;

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(
		<StrictMode>
			<RouterProvider router={router} />
		</StrictMode>
	);
}
