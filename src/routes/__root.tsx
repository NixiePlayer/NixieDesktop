import { createRootRoute, rootRouteId, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "#/components/app-shell";
import { DiagnosticReport } from "#/components/diagnostic-report";
import { DataAccessView, PremiumRequiredView, SignInView } from "#/components/sign-in";
import { Button } from "#/components/ui/button";
import { Toaster } from "#/components/ui/toast";
import { TooltipProvider } from "#/components/ui/tooltip";
import { dropHeldPages } from "#/lib/api";
import { applyLanguage, useMessages } from "#/lib/i18n";
import { resetLibrary } from "#/lib/library";
import { applyTheme } from "#/lib/theme";
import { PlayerProvider } from "#/player";
import type { AuthState } from "#/shared/contracts";
import "../styles.css";

export const Route = createRootRoute({
	component: RootComponent,
	errorComponent: RootError,
});

function RootError({ error, reset }: { error: Error; reset: () => void }) {
	const m = useMessages();
	return (
		<div className="flex flex-col items-start gap-3 py-12">
			<h1 className="text-2xl font-bold">{m.signin.somethingWentWrong}</h1>
			<p className="text-muted-foreground text-sm">{error.message}</p>
			<Button onClick={reset}>{m.common.tryAgain}</Button>
			<DiagnosticReport />
		</div>
	);
}

function RootComponent() {
	// Undefined until the first auth answer arrives, so the shell never flashes before the gate.
	const [auth, setAuth] = useState<AuthState>();
	// Set when the reader leaves the permission screen for the extension, which needs no permission.
	const [useLink, setUseLink] = useState(false);
	const router = useRouter();

	// Loaders already ran against the signed-out bridge and cached empty pages, so every auth
	// change has to drop that data or the shell renders an empty feed until staleTime expires.
	const changeAuth = useCallback(
		(next: AuthState) => {
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
		},
		[router]
	);

	useEffect(() => {
		const bridge = window.nixie;
		if (!bridge) return setAuth({ status: "signed-out" });
		void bridge.auth.state().then(setAuth, () => setAuth({ status: "signed-out" }));
		void bridge.local.load().then((state) => {
			applyTheme(state.settings.theme);
			applyLanguage(state.settings.language);
		});
	}, []);

	// The extension holding the session reconnects after that first answer, and main pushes what it
	// made of the re-read. A change of status or of account is a change of session: a session confirmed
	// as the one already on screen must not send every page back to its skeleton, while a browser that
	// switched Google accounts while disconnected is another account's library wearing the same status.
	// A new avatar alone is neither.
	const status = auth?.status;
	const accountName = auth?.accountName;
	useEffect(() => {
		return window.nixie?.auth.onAuthState((next) =>
			next.status === status && next.accountName === accountName ? setAuth(next) : changeAuth(next)
		);
	}, [status, accountName, changeAuth]);

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
					) : auth.status === "data-refused" && !useLink ? (
						// Ahead of the sign-in view, whose browser list macOS leaves empty, and in place of a shell
						// that would look signed in and play nothing.
						<DataAccessView onUseLink={() => setUseLink(true)} />
					) : (
						<SignInView onSignedIn={changeAuth} />
					))}
				<Toaster />
			</TooltipProvider>
		</PlayerProvider>
	);
}
