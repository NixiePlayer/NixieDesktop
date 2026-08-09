import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
// Imported for its side effect: it paints the mirrored choice before the first render, so the
// window never opens on one appearance and swaps to the other once the state file answers.
import "./lib/theme";
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
