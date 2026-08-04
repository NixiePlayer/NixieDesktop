import { ChevronRight, CircleAlert, Globe } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AuthState, BrowserAccount } from "#/shared/contracts";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Skeleton } from "./ui/skeleton";
import { Textarea } from "./ui/textarea";

// One SVG filter, inlined so the panel needs no asset and no network. It is what keeps the
// gradient from banding on a large dark window.
const GRAIN =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * The app icon's own cabinet, the same paths `build/icon.svg` draws, on lucide's 24x24 grid so it
 * takes `currentColor` and a size utility like every other icon here. The viewBox is cropped to the
 * cabinet's bounding box (x 6..18, y 4..21.6) rather than the grid, since a glyph that fills half
 * its box reads as a smaller badge than the neighbouring lucide ones.
 */
function NoctuneMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="5.4 3.4 13.2 18.8"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden
		>
			<path d="M6 20V10a6 6 0 0 1 12 0v10z" />
			<path d="M7.8 11a4.2 4.2 0 0 1 8.4 0" />
			<circle cx="12" cy="12.6" r="1.3" />
			<path d="M6 14.8h12" />
			<path d="M9 16.2v2.4" />
			<path d="M12 16.2v2.4" />
			<path d="M15 16.2v2.4" />
			<path d="M8.5 20v1.6" />
			<path d="M15.5 20v1.6" />
		</svg>
	);
}

/** Decoration only. There is no session yet, so there is no artwork to draw this from. */
function HeroPanel() {
	return (
		<div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-10 lg:flex">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_15%,color-mix(in_oklab,var(--primary)_45%,transparent),transparent_70%),radial-gradient(60%_50%_at_75%_85%,color-mix(in_oklab,var(--primary)_25%,transparent),transparent_70%)]"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-15 mix-blend-overlay"
				style={{ backgroundImage: GRAIN }}
			/>
			<span className="bg-primary text-primary-foreground relative flex size-11 items-center justify-center rounded-xl">
				<NoctuneMark className="size-6" />
			</span>
			<div className="relative flex flex-col gap-4">
				<p className="max-w-md text-5xl font-bold tracking-tight text-balance">Everything you already listen to.</p>
				<p className="text-muted-foreground max-w-sm">
					Noctune plays your YouTube Music playlists, albums and library in a native window.
				</p>
			</div>
		</div>
	);
}

function AccountRow({
	account,
	disabled,
	onSelect,
}: {
	account: BrowserAccount;
	disabled: boolean;
	onSelect: () => void;
}) {
	const name = account.accountName ?? account.browser;
	// The browser is only in the icon once a profile names itself, so the detail line states it too.
	const detail = [account.accountEmail ?? account.label, name === account.browser ? undefined : account.browser]
		.filter(Boolean)
		.join(" · ");
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			aria-label={detail ? `Continue with ${name}, ${detail}` : `Continue with ${name}`}
			className="border-border bg-card hover:bg-accent flex items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-60"
		>
			<span className="relative shrink-0">
				{account.icon ? (
					<img src={account.icon} alt="" className="size-8" />
				) : (
					<span className="bg-muted flex size-8 items-center justify-center rounded-md">
						<Globe className="text-muted-foreground size-4" />
					</span>
				)}
				{account.avatar && (
					<img
						src={account.avatar}
						alt=""
						className="ring-card absolute -right-1 -bottom-1 size-5 rounded-full ring-2"
					/>
				)}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium">{name}</span>
				{detail && <span className="text-muted-foreground truncate text-xs">{detail}</span>}
			</span>
			<ChevronRight className="text-muted-foreground ml-auto size-4 shrink-0" />
		</button>
	);
}

/** The whole app is behind this. Nothing renders until an account is linked. */
export function SignInView({ onSignedIn }: { onSignedIn: (auth: AuthState) => void }) {
	const [cookies, setCookies] = useState("");
	const [manual, setManual] = useState(false);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	// Undefined until detection answers, so the empty state never renders over a running scan.
	const [accounts, setAccounts] = useState<BrowserAccount[] | undefined>(undefined);

	const findAccounts = useCallback(() => {
		setAccounts(undefined);
		void window.noctune?.auth
			.browsers()
			.then(setAccounts)
			.catch(() => setAccounts([]));
	}, []);
	useEffect(findAccounts, [findAccounts]);

	const run = (work?: Promise<AuthState>) => {
		if (!work) return setError("Sign-in is only available in the Noctune desktop app.");
		setError("");
		setBusy(true);
		void work
			.then((state) => {
				if (state.status !== "authenticated") return setError("That did not sign you in. Please try again.");
				setCookies("");
				onSignedIn(state);
			})
			.catch((reason: Error) => setError(reason.message))
			.finally(() => setBusy(false));
	};

	return (
		<div className="bg-background relative flex h-full">
			{/* No top bar here, so this strip is what keeps the frameless window draggable. */}
			<div className="drag-region absolute inset-x-0 top-0 z-10 h-14" />
			<HeroPanel />
			<main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-14">
				<div className="flex w-full max-w-sm flex-col gap-6">
					<div className="flex flex-col gap-3">
						<span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl lg:hidden">
							<NoctuneMark className="size-6" />
						</span>
						<h1 className="text-2xl font-bold tracking-tight">Continue with a signed-in browser</h1>
						<p className="text-muted-foreground text-sm">
							Noctune continues the YouTube session you are already signed in to in your browser. Google refuses to sign
							in inside an app window, so it never asks you here.
						</p>
					</div>

					{error && (
						<p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
							{error}
						</p>
					)}

					{accounts === undefined ? (
						<div className="flex flex-col gap-2">
							{[0, 1].map((row) => (
								<div key={row} className="border-border flex items-center gap-3 rounded-xl border p-3">
									<Skeleton className="size-8" />
									<div className="flex flex-col gap-1.5">
										<Skeleton className="h-3.5 w-28" />
										<Skeleton className="h-3 w-40" />
									</div>
								</div>
							))}
						</div>
					) : accounts.length > 0 ? (
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-2">
								{accounts.map((account) => (
									<AccountRow
										key={`${account.browser}-${account.profile}`}
										account={account}
										disabled={busy}
										onSelect={() => run(window.noctune?.auth.importFromBrowser(account))}
									/>
								))}
							</div>
							<p className="text-muted-foreground text-sm">
								Each row states the account signed in to that browser profile. Your system may ask once for permission
								to read the browser's saved cookies. Nothing leaves this device.
							</p>
						</div>
					) : (
						<div className="border-border flex flex-col items-start gap-3 rounded-xl border border-dashed p-4">
							<p className="text-muted-foreground text-sm">
								No signed-in browser found. Sign in at{" "}
								<a
									href="https://music.youtube.com"
									target="_blank"
									rel="noreferrer"
									className="text-foreground underline underline-offset-4"
								>
									music.youtube.com
								</a>{" "}
								in Chrome, Brave, Edge, Vivaldi, or Firefox, then check again.
							</p>
							<Button variant="outline" size="sm" onClick={findAccounts}>
								Check again
							</Button>
						</div>
					)}

					{manual ? (
						<div className="flex flex-col gap-4">
							<Alert>
								<CircleAlert />
								<AlertTitle>If your browser is not listed</AlertTitle>
								<AlertDescription>
									You can connect the account from your browser instead. Treat what you paste like a password. It stays
									on this device.
								</AlertDescription>
							</Alert>
							<Field>
								<FieldLabel htmlFor="cookie-header">Cookie header from music.youtube.com</FieldLabel>
								<Textarea
									id="cookie-header"
									value={cookies}
									autoComplete="off"
									spellCheck={false}
									onChange={(event) => setCookies(event.target.value)}
									placeholder="SAPISID=...; __Secure-3PAPISID=..."
								/>
								<FieldDescription>Noctune clears the field as soon as it connects.</FieldDescription>
							</Field>
							<Button
								variant="outline"
								disabled={busy || !cookies.trim()}
								onClick={() => run(window.noctune?.auth.importCookies(cookies))}
							>
								Connect account
							</Button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setManual(true)}
							className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
						>
							Trouble signing in?
						</button>
					)}
				</div>
			</main>
		</div>
	);
}
