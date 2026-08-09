import { createRootRoute, rootRouteId, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "#/components/app-shell";
import { PremiumRequiredView, SignInView } from "#/components/sign-in";
import { Button } from "#/components/ui/button";
import { Toaster } from "#/components/ui/toast";
import { TooltipProvider } from "#/components/ui/tooltip";
import { dropHeldPages } from "#/lib/api";
import { resetLibrary } from "#/lib/library";
import { applyTheme } from "#/lib/theme";
import { PlayerProvider } from "#/player";
import type { AuthState } from "#/shared/contracts";
import "../styles.css";

export const Route = createRootRoute({
	component: RootComponent,
	errorComponent: ({ error, reset }) => (
		<div className="flex flex-col items-start gap-3 py-12">
			<h1 className="text-2xl font-bold">Something went wrong</h1>
			<p className="text-muted-foreground text-sm">{error.message}</p>
			<Button onClick={reset}>Try again</Button>
		</div>
	),
});

function RootComponent() {
	// Undefined until the first auth answer arrives, so the shell never flashes before the gate.
	const [auth, setAuth] = useState<AuthState>();
	const router = useRouter();

	// Loaders already ran against the signed-out bridge and cached empty pages, so every auth
	// change has to drop that data or the shell renders an empty feed until staleTime expires.
	const changeAuth = (next: AuthState) => {
		setAuth(next);
		// Another account holds other playlists and other releases, and that store outlives the shell.
		resetLibrary();
		// So do the feeds and mixes held outside the router's cache, which invalidating does not reach.
		dropHeldPages();
		// `forcePending`, not a plain invalidate: the loaders already ran against the signed-out bridge
		// and cached the empty pages they answered with, and a revalidation renders that data while it
		// refetches. So the first thing a reader saw after signing in was "your home feed has nothing to
		// show yet", sitting there for the length of the first browse. Forcing the matches back to
		// pending draws each route's own skeleton instead. The root is left alone: it holds the gate
		// being rendered, and it has no loader to rerun anyway.
		void router.invalidate({ forcePending: true, filter: (match) => match.routeId !== rootRouteId });
	};

	useEffect(() => {
		const bridge = window.noctune;
		if (!bridge) return setAuth({ status: "signed-out" });
		void bridge.auth.state().then(setAuth);
		void bridge.local.load().then((state) => applyTheme(state.settings.theme));
	}, []);

	return (
		<PlayerProvider>
			<TooltipProvider>
				{auth &&
					(auth.status === "authenticated" ? (
						<AppShell auth={auth} onAuthChange={changeAuth} />
					) : auth.status === "unentitled" ? (
						// A real session that holds no subscription. Not the sign-in view: nothing failed there,
						// and there is nothing on it to press that would change the answer.
						<PremiumRequiredView onSignedOut={changeAuth} />
					) : (
						<SignInView onSignedIn={changeAuth} />
					))}
				<Toaster />
			</TooltipProvider>
		</PlayerProvider>
	);
}
