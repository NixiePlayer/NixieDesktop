import { ChevronRight, Globe, Puzzle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import markDev from "#/assets/logo-dev.png";
import markProd from "#/assets/logo.png";
import { useMessages } from "#/lib/i18n";
import { platform } from "#/lib/platform";
import type { AuthState, BrowserAccount, ExtensionSource } from "#/shared/contracts";
import { DiagnosticReport } from "./diagnostic-report";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

// One SVG filter, inlined so the panel needs no asset and no network. It is what keeps the
// gradient from banding on a large dark window.
const GRAIN =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * The app icon itself, which is a full-colour mark with a background of its own rather than a glyph
 * taking `currentColor`, so it is drawn as the badge instead of sitting inside one. Development gets
 * the blue mark the dock is showing it under, for the same reason the dock does.
 */
const MARK = import.meta.env.DEV ? markDev : markProd;

/** Decoration only. There is no session yet, so there is no artwork to draw this from. */
function HeroPanel() {
	const m = useMessages();
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
			<img src={MARK} alt="" className="relative size-11 rounded-xl" />
			<div className="relative flex flex-col gap-4">
				<p className="max-w-md text-5xl font-bold tracking-tight text-balance">{m.signin.heroTitle}</p>
				<p className="text-muted-foreground max-w-sm">{m.signin.heroBody}</p>
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
	const m = useMessages();
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
			aria-label={m.signin.continueWith(name, detail)}
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

/**
 * The extension path, primary on Windows where the disk read reaches only Firefox, secondary
 * elsewhere. A connected profile that holds no session is shown and refused rather than hidden, since
 * "nothing happened" reads worse than a row that says why. The account name is not shown because the
 * extension cannot know it: it is filled in from the linked session after, the same rule the disk
 * path follows.
 */
function ExtensionBlock({
	sources,
	disabled,
	onLink,
}: {
	sources: ExtensionSource[];
	disabled: boolean;
	onLink: (installId: string, pairingSecret: string) => void;
}) {
	const m = useMessages();
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-sm font-medium">{m.signin.extensionTitle}</h2>
			{sources.length > 0 ? (
				<div className="flex flex-col gap-2">
					{sources.map((source) =>
						source.signedIn ? (
							<ExtensionPairingRow key={source.installId} source={source} disabled={disabled} onLink={onLink} />
						) : (
							<div
								key={source.installId}
								className="border-border flex items-center gap-3 rounded-xl border p-3 opacity-60"
							>
								<span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
									<Puzzle className="text-muted-foreground size-4" />
								</span>
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-medium">{source.browser}</span>
									<span className="text-muted-foreground truncate text-xs">
										{m.signin.notSignedInTo}{" "}
										<a
											href="https://music.youtube.com"
											target="_blank"
											rel="noreferrer"
											className="text-foreground underline underline-offset-4"
										>
											music.youtube.com
										</a>
									</span>
								</span>
							</div>
						)
					)}
				</div>
			) : (
				<div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-4">
					<p className="text-muted-foreground text-sm">
						{platform === "win32" ? m.signin.extensionWindows : m.signin.extensionFallback}
						{m.signin.installBefore}
						<a
							href="https://github.com/NixiePlayer/nixie-link-extension#install"
							target="_blank"
							rel="noreferrer"
							className="text-foreground underline underline-offset-4"
						>
							{m.signin.installGuide}
						</a>
						{m.signin.installAfter}
					</p>
				</div>
			)}
		</div>
	);
}

function ExtensionPairingRow({
	source,
	disabled,
	onLink,
}: {
	source: ExtensionSource;
	disabled: boolean;
	onLink: (installId: string, pairingSecret: string) => void;
}) {
	const m = useMessages();
	const [pairingSecret, setPairingSecret] = useState("");
	const id = `pairing-${source.installId}`;
	return (
		<form
			className="border-border bg-card flex flex-col gap-3 rounded-xl border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				onLink(source.installId, pairingSecret.trim());
			}}
		>
			<div className="flex items-center gap-3">
				<span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
					<Puzzle className="text-muted-foreground size-4" />
				</span>
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-sm font-medium">{source.browser}</span>
					<span className="text-muted-foreground truncate text-xs">{m.signin.connectedThroughExtension}</span>
				</span>
			</div>
			<FieldGroup className="gap-3">
				<Field data-disabled={disabled}>
					<FieldLabel htmlFor={id}>{m.signin.pairingCode}</FieldLabel>
					<Input
						id={id}
						type="password"
						value={pairingSecret}
						onChange={(event) => setPairingSecret(event.target.value)}
						pattern="[A-Za-z0-9_-]{43}"
						minLength={43}
						maxLength={43}
						autoComplete="off"
						spellCheck={false}
						disabled={disabled}
						required
					/>
					<FieldDescription>{m.signin.pairingHint}</FieldDescription>
				</Field>
				<Button type="submit" disabled={disabled || pairingSecret.trim().length !== 43}>
					{m.signin.connect}
				</Button>
			</FieldGroup>
		</form>
	);
}

/** The whole app is behind this. Nothing renders until an account is linked. */
export function SignInView({ onSignedIn }: { onSignedIn: (auth: AuthState) => void }) {
	const m = useMessages();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	// Undefined until detection answers, so the empty state never renders over a running scan.
	const [accounts, setAccounts] = useState<BrowserAccount[] | undefined>(undefined);
	const [sources, setSources] = useState<ExtensionSource[]>([]);

	const findAccounts = useCallback(() => {
		setAccounts(undefined);
		void window.nixie?.auth
			.browsers()
			.then(setAccounts)
			.catch(() => setAccounts([]));
	}, []);
	useEffect(findAccounts, [findAccounts]);

	// Read once and follow the pushes, since the reader installs the extension with this screen open.
	useEffect(() => {
		if (!window.nixie) return;
		void window.nixie.auth
			.extensionSources()
			.then(setSources)
			.catch(() => undefined);
		return window.nixie.auth.onExtensionSources(setSources);
	}, []);

	const run = (work?: Promise<AuthState>) => {
		if (!work) return setError(m.signin.onlyInApp);
		setError("");
		setBusy(true);
		void work
			.then((state) => {
				if (state.status !== "authenticated") return setError(m.signin.didNotSignIn);
				onSignedIn(state);
			})
			// Electron wraps a handler's rejection in an English prefix naming the channel, which is not
			// something to show a reader in any language: main already put the message in theirs.
			.catch((reason: Error) =>
				setError(reason.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, ""))
			)
			.finally(() => setBusy(false));
	};

	return (
		<div className="bg-background relative flex h-full">
			{/* No top bar here, so this strip is what keeps the frameless window draggable. */}
			<div className="drag-region absolute inset-x-0 top-0 z-10 h-14" />
			<HeroPanel />
			<main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 py-14">
				<div className="my-auto flex w-full max-w-sm flex-col gap-6">
					<div className="flex flex-col gap-3">
						<img src={MARK} alt="" className="size-11 rounded-xl lg:hidden" />
						<h1 className="text-2xl font-bold tracking-tight">{m.signin.title}</h1>
						<p className="text-muted-foreground text-sm">{m.signin.intro}</p>
					</div>

					{error && (
						<p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
							{error}
						</p>
					)}

					{/* Windows Chrome, Edge, Brave and Vivaldi encrypt their cookies in a way only the browser
					    itself can read, so the extension is the primary path there and sits above the disk list,
					    which reaches only Firefox. */}
					{platform === "win32" && (
						<ExtensionBlock
							sources={sources}
							disabled={busy}
							onLink={(installId, pairingSecret) => run(window.nixie?.auth.linkExtension(installId, pairingSecret))}
						/>
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
										onSelect={() => run(window.nixie?.auth.importFromBrowser(account))}
									/>
								))}
							</div>
							<p className="text-muted-foreground text-sm">{m.signin.accountsNote}</p>
						</div>
					) : (
						<div className="border-border flex flex-col items-start gap-3 rounded-xl border border-dashed p-4">
							<p className="text-muted-foreground text-sm">
								{platform === "win32" ? (
									<>
										{m.signin.noFirefoxBefore}{" "}
										<a
											href="https://music.youtube.com"
											target="_blank"
											rel="noreferrer"
											className="text-foreground underline underline-offset-4"
										>
											music.youtube.com
										</a>{" "}
										{m.signin.noFirefoxAfter}
									</>
								) : (
									<>
										{m.signin.noBrowserBefore}{" "}
										<a
											href="https://music.youtube.com"
											target="_blank"
											rel="noreferrer"
											className="text-foreground underline underline-offset-4"
										>
											music.youtube.com
										</a>{" "}
										{m.signin.noBrowserAfter}
									</>
								)}
							</p>
							<Button variant="outline" size="sm" onClick={findAccounts}>
								{m.signin.checkAgain}
							</Button>
						</div>
					)}

					{/* Elsewhere the disk read handles every browser, so the extension is the secondary path. */}
					{platform !== "win32" && (
						<ExtensionBlock
							sources={sources}
							disabled={busy}
							onLink={(installId, pairingSecret) => run(window.nixie?.auth.linkExtension(installId, pairingSecret))}
						/>
					)}

					{/*
					 * The disclaimer belongs on the screen that asks for a Google session, not only on a
					 * settings tab reached later: this is the point at which someone decides whether to hand
					 * their YouTube account to something they may have assumed Google wrote. It closes on the
					 * unofficial interface rather than the trademark, since that is the part carrying real risk
					 * to the account being linked, and it is the one thing no other screen says.
					 */}
					<DiagnosticReport />
					<p className="text-muted-foreground border-border border-t pt-4 text-xs">{m.signin.disclaimer}</p>
				</div>
			</main>
		</div>
	);
}

/**
 * What a linked account that holds no Music Premium subscription gets instead of the app. It is a
 * screen of its own rather than an error on the sign-in view, because nothing about the sign-in
 * failed: the session is real and YouTube recognises it, and there is nothing to retry.
 *
 * Signing out is the only action, since it is what leads back to linking a different account. The
 * subscription itself is bought on the web and picked up on the next launch, which is what the second
 * line says rather than offering a "check again" that would be one more thing to press.
 */
export function PremiumRequiredView({ onSignedOut }: { onSignedOut: (auth: AuthState) => void }) {
	const m = useMessages();
	const [busy, setBusy] = useState(false);

	return (
		<div className="bg-background relative flex h-full">
			{/* No top bar here either, so this strip is what keeps the frameless window draggable. */}
			<div className="drag-region absolute inset-x-0 top-0 z-10 h-14" />
			<HeroPanel />
			<main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 py-14">
				<div className="my-auto flex w-full max-w-sm flex-col gap-6">
					<div className="flex flex-col gap-3">
						<img src={MARK} alt="" className="size-11 rounded-xl lg:hidden" />
						<h1 className="text-2xl font-bold tracking-tight">{m.signin.premium.title}</h1>
						<p className="text-muted-foreground text-sm">{m.signin.premium.why}</p>
						<p className="text-muted-foreground text-sm">{m.signin.premium.next}</p>
					</div>
					<Button
						variant="outline"
						disabled={busy}
						className="self-start"
						onClick={() => {
							setBusy(true);
							void window.nixie?.auth
								.signOut()
								.then(onSignedOut)
								.finally(() => setBusy(false));
						}}
					>
						{m.signin.premium.signOut}
					</Button>
					<a
						href="https://music.youtube.com"
						target="_blank"
						rel="noreferrer"
						className="text-muted-foreground hover:text-foreground self-start text-sm underline underline-offset-4"
					>
						{m.signin.premium.openYouTubeMusic}
					</a>
					<DiagnosticReport />
				</div>
			</main>
		</div>
	);
}

/**
 * What a Mac that has not allowed Nixie gets instead of the app. macOS refuses it every other app's
 * data, so the browser profile the session lives in cannot be re-read, and a session that is not
 * re-read is rotated out from under playback within minutes: the app looks signed in and plays
 * nothing. Full Disk Access is the grant that covers it, and macOS applies it only to a process
 * started afterwards, which is why the second button restarts rather than checking again. The
 * extension reads nothing off disk, so it is the way round for anyone who would rather not grant it,
 * and the disclosure of what the grant reaches is stated beside it rather than left to System Settings.
 */
export function DataAccessView({ onUseLink }: { onUseLink: () => void }) {
	const m = useMessages();
	const [busy, setBusy] = useState(false);

	return (
		<div className="bg-background relative flex h-full">
			{/* No top bar here either, so this strip is what keeps the frameless window draggable. */}
			<div className="drag-region absolute inset-x-0 top-0 z-10 h-14" />
			<HeroPanel />
			<main className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 py-14">
				<div className="my-auto flex w-full max-w-sm flex-col gap-6">
					<div className="flex flex-col gap-3">
						<img src={MARK} alt="" className="size-11 rounded-xl lg:hidden" />
						<h1 className="text-2xl font-bold tracking-tight">{m.signin.dataAccess.title}</h1>
						<p className="text-muted-foreground text-sm">{m.signin.dataAccess.why}</p>
						<ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
							<li>{m.signin.dataAccess.stepOpen}</li>
							<li>{m.signin.dataAccess.stepTurnOn}</li>
							<li>{m.signin.dataAccess.stepRestart}</li>
						</ol>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => void window.nixie?.app.openPrivacySettings()}>
							{m.signin.dataAccess.openSettings}
						</Button>
						<Button
							variant="outline"
							disabled={busy}
							onClick={() => {
								setBusy(true);
								void window.nixie?.app.relaunch().finally(() => setBusy(false));
							}}
						>
							{m.signin.dataAccess.restart}
						</Button>
					</div>
					<p className="text-muted-foreground text-sm">
						{m.signin.dataAccess.linkBefore}
						<button type="button" onClick={onUseLink} className="text-foreground underline underline-offset-4">
							{m.signin.dataAccess.useLink}
						</button>
						{m.signin.dataAccess.linkAfter}
					</p>
					<DiagnosticReport />
				</div>
			</main>
		</div>
	);
}
