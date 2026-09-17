import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
	Copy,
	Download,
	ExternalLink,
	Gauge,
	Info,
	Monitor,
	Moon,
	Shield,
	SlidersHorizontal,
	Sun,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DiagnosticReport } from "#/components/diagnostic-report";
import { PageTitle } from "#/components/media";
import {
	AccountSettingsSkeleton,
	AccountSettingsUnavailable,
	AccountSwitch,
	useAccountSettings,
} from "#/components/settings-account";
import { DocumentRow } from "#/components/settings-document";
import { Button } from "#/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { toast } from "#/components/ui/toast";
import { dropHeldPages, queryRegions } from "#/lib/api";
import { applyLanguage, language, storedLanguage, useMessages } from "#/lib/i18n";
import { platform } from "#/lib/platform";
import { applyTheme, storedTheme } from "#/lib/theme";
import { checkForUpdates, useUpdateState } from "#/lib/updates";
import { cn } from "#/lib/utils";
import type { AppInfo, NormalizationLevel, Settings } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";
import type { Language, LanguageSetting } from "#/shared/i18n";
import { maxBoostDb, normalizationTargets } from "#/shared/normalization";
import { regionCode } from "#/shared/regions";

// Labels are read off the dictionary at render, so only what never changes with the language is here.
const themes = [
	{ value: "dark", icon: Moon },
	{ value: "light", icon: Sun },
	{ value: "system", icon: Monitor },
] as const;

type Level = Exclude<NormalizationLevel, "off">;

const tabs = [
	{ value: "general", icon: SlidersHorizontal },
	{ value: "playback", icon: Gauge },
	{ value: "privacy", icon: Shield },
	{ value: "about", icon: Info },
] as const;

/** Leaving the region to upstream is a choice of its own, so it is an option rather than an absence. */
const AUTOMATIC_REGION = "auto";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
	return (
		<section className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold tracking-tight">{title}</h2>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
			{children}
		</section>
	);
}

/**
 * One card of settings under the scope it belongs to. This page is the only one in the app whose
 * rows do not all reach the same distance: a theme is this computer's and nothing else's, while pausing
 * watch history reaches every device signed in to the account. YouTube Music's own settings page
 * never has to say so, because everything on it is account-wide. Here the heading carries it, and
 * nothing else does: no badge on the row, no second colour.
 */
function ScopeGroup({ scope, children }: { scope?: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-3">
			{scope && <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{scope}</h3>}
			<div className="border-border divide-border flex flex-col divide-y rounded-xl border">{children}</div>
		</div>
	);
}

function Setting({
	label,
	description,
	control,
	children,
}: {
	label: string;
	description?: string;
	control?: React.ReactNode;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-4 p-5">
			{/* The control sits beside the label until the column is too narrow to hold both, at which
			    point it drops under it: squeezing the description instead wraps it a word at a time. */}
			<div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:justify-between @lg:gap-6">
				<div className="flex min-w-0 flex-col gap-1">
					<p className="text-sm font-medium">{label}</p>
					{description && <p className="text-muted-foreground text-sm">{description}</p>}
				</div>
				{control}
			</div>
			{children}
		</div>
	);
}

/** A row that leaves the app. Styled as a setting so it sits in the same card as the switches. */
function LinkRow({ href, label, description }: { href: string; label: string; description: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="hover:bg-accent/50 flex items-start justify-between gap-6 p-5 transition-colors"
		>
			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-sm font-medium">{label}</p>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
			<ExternalLink className="text-muted-foreground mt-0.5 size-4 shrink-0" />
		</a>
	);
}

function Choice({
	label,
	caption,
	icon: Icon,
	selected,
	onSelect,
}: {
	label: string;
	caption: string;
	icon?: React.ComponentType<{ className?: string }>;
	selected: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={cn(
				"border-border hover:bg-accent focus-visible:ring-ring/50 flex flex-1 flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors focus-visible:ring-3 focus-visible:outline-none",
				selected && "border-primary text-primary bg-primary/5"
			)}
		>
			{Icon && <Icon className="size-5" />}
			<span className="text-sm font-medium">{label}</span>
			<span className="text-muted-foreground text-xs tabular-nums">{caption}</span>
		</button>
	);
}

/**
 * The regions YouTube Music serves, read off the charts page's own picker, which is the only list of
 * them this app can ask for. Their codes are recovered from their names, since upstream states each
 * option as a browse rather than a country code. Empty until it lands, and empty for good if the
 * browse fails, which leaves the current region as whatever upstream infers.
 *
 * The names arrive in the session's language, so they are matched against it, and read again when the
 * session changes language: `sessionLanguage` moves only once the new setting is stored and the held
 * charts page dropped, since asking before that is answered with the old page in the old words.
 */
function useRegions(sessionLanguage: Language) {
	const [regions, setRegions] = useState<{ code: string; label: string }[]>([]);
	useEffect(() => {
		let current = true;
		void queryRegions()
			.then((page) => {
				if (!current) return;
				const seen = new Map<string, string>();
				for (const region of page.explore?.regions ?? []) {
					const code = regionCode(region.label, sessionLanguage);
					if (code && !seen.has(code)) seen.set(code, region.label);
				}
				setRegions(
					[...seen]
						.map(([code, label]) => ({ code, label }))
						.sort((a, b) => a.label.localeCompare(b.label, sessionLanguage))
				);
			})
			.catch(() => current && setRegions([]));
		return () => {
			current = false;
		};
	}, [sessionLanguage]);
	return regions;
}

/**
 * Whether the system has refused a banner. Read on mount rather than pushed: this is the only page
 * that shows it, and a refusal that happens while it is open is one the reader is not being notified
 * about anyway, since nothing is drawn while Nixie has focus.
 */
function useNotificationsRefused() {
	const [refused, setRefused] = useState(false);
	useEffect(() => {
		void window.nixie?.player
			.notifyRefused()
			.then(setRefused)
			.catch(() => undefined);
	}, []);
	return refused;
}

function useAppInfo() {
	const [info, setInfo] = useState<AppInfo>();
	useEffect(() => {
		void window.nixie?.app
			.info()
			.then(setInfo)
			.catch(() => undefined);
	}, []);
	return info;
}

/**
 * The one row on this page that can change the build it is describing. Main owns the state and the
 * whole update lifecycle, so this reads it once on mount and follows the pushes after that: the
 * startup check has usually settled long before anyone opens this tab.
 *
 * Every state draws a row, including the "unsupported" one this starts on: an updater that only
 * appears once it has something to say is one nobody can ask, and the answer "nothing to install"
 * is worth as much as the offer to install something. In a packaged build that state lasts until
 * main answers, which is a beat; a development build stays there, since there is no feed to ask.
 */
function UpdateSetting() {
	const state = useUpdateState();
	const common = useMessages().common;
	const m = useMessages().settings.update;
	const update = window.nixie?.update;
	const version = state.version ?? "";
	// Held once because it is written twice: the downloading button is sized against it, so a reworded
	// button would otherwise leave the bar the width of a sentence nobody prints any more.
	const restart = m.restartNow;
	// Nothing rests on "available" now that the download starts itself: it is the first tick of the
	// download, a beat before the first percent, so it reads as one state rather than two.
	const downloading = {
		label: m.downloading.label(version),
		description: m.downloading.description,
		control: (
			// The button is the bar: a hard-edged gradient fills it from the left as the download runs,
			// so the number has something behind it moving at its own pace rather than a figure ticking
			// in place. It is `backgroundImage` rather than `background`, which would drop the variant's
			// own base colour and leave the unfilled half a hole in the row, and `--primary` because the
			// seek bar is the one progress indicator this app already draws.
			//
			// It is also sized off the button that replaces it rather than off its own text, which is one
			// character shorter at 100% than at 8% and shorter again than the words landing in its place:
			// the bar would shrink as it filled and the row would step twice on the way to the restart.
			// The stack is a grid so the two share a cell, which needs no measurement and no magic width.
			<Button
				variant="outline"
				disabled
				className="grid tabular-nums"
				style={{
					backgroundImage: `linear-gradient(to right, var(--primary) ${state.percent ?? 0}%, transparent 0)`,
				}}
			>
				<span aria-hidden className="invisible col-start-1 row-start-1">
					{restart}
				</span>
				<span className="col-start-1 row-start-1 text-center">{state.percent ?? 0}%</span>
			</Button>
		),
	};
	const row = {
		unsupported: {
			label: m.unsupported.label,
			description: m.unsupported.description,
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					{m.unsupported.action}
				</Button>
			),
		},
		checking: {
			label: m.checking.label,
			description: m.checking.description,
			control: (
				<Button variant="outline" disabled>
					{m.checking.action}
				</Button>
			),
		},
		current: {
			label: m.current.label,
			description: m.current.description,
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					{m.current.action}
				</Button>
			),
		},
		available: downloading,
		downloading,
		ready: {
			label: m.ready.label(version),
			description: m.ready.description,
			control: <Button onClick={() => void update?.install()}>{restart}</Button>,
		},
		error: {
			label: m.error.label,
			description: m.error.description,
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					{common.tryAgain}
				</Button>
			),
		},
	}[state.status];

	return <Setting label={row.label} description={row.description} control={row.control} />;
}

function SettingsPage() {
	const router = useRouter();
	// The theme is the one setting already in hand: the state file is an IPC round trip away, and a
	// card selected on the default and moved a frame later is the selection visibly changing itself.
	// The language is the same: mirrored in `localStorage`, so the select never jumps either.
	const [settings, setSettings] = useState<Settings>(() => ({
		...defaultState().settings,
		theme: storedTheme(),
		language: storedLanguage(),
	}));
	const m = useMessages();
	const s = m.settings;
	// Remembers the target across an off/on toggle, since "off" cannot hold one.
	const [lastLevel, setLastLevel] = useState<Level>("normal");
	const level = settings.normalization === "off" ? lastLevel : settings.normalization;
	const account = useAccountSettings();
	const [sessionLanguage, setSessionLanguage] = useState(language);
	const regions = useRegions(sessionLanguage);
	const regionItems = useMemo(
		() => ({
			[AUTOMATIC_REGION]: s.general.region.automatic,
			...Object.fromEntries(regions.map((r) => [r.code, r.label])),
		}),
		[regions, s]
	);
	// The label carries the loudness each level aims for, which is the whole difference between them.
	const levels: Record<Level, string> = {
		quiet: s.playback.normalization.quiet(normalizationTargets.quiet),
		normal: s.playback.normalization.normal(normalizationTargets.normal),
		loud: s.playback.normalization.loud(normalizationTargets.loud),
	};
	// Passed to Select as `items` so the trigger shows the label instead of the raw value.
	const qualities: Record<Settings["quality"], string> = {
		low: s.playback.quality.low,
		normal: s.playback.quality.normal,
		high: s.playback.quality.high,
	};
	const languages: Record<LanguageSetting, string> = {
		system: s.general.language.system,
		en: s.general.language.en,
		it: s.general.language.it,
	};
	const info = useAppInfo();
	const notificationsRefused = useNotificationsRefused();

	useEffect(() => {
		void window.nixie?.local.load().then((state) => setSettings(state.settings));
	}, []);

	const save = async (next: Settings) => {
		setSettings(next);
		applyTheme(next.theme);
		const state = await window.nixie?.local.load();
		if (state) await window.nixie?.local.save({ ...state, settings: next });
	};

	/**
	 * Region and Restricted Mode are fixed when the InnerTube session is built, so every page already
	 * in the router's cache was answered for the old value and would go on being shown for it: nothing
	 * is revalidated under a reader here. Invalidating is what makes the change visible.
	 */
	const saveAndRefetch = (next: Settings) =>
		// Awaited, not fired alongside: the adapter reads the region and Restricted Mode off the stored
		// state when it builds its next session, so invalidating before the write lands would refetch
		// every page against the value being replaced.
		save(next).then(() => {
			// Invalidating reaches the pages the router holds. The refreshed Home and Explore feeds and
			// the drawn mixes are held outside it, and a Home feed drawn for the old region is exactly
			// what the next visit would be served.
			dropHeldPages();
			void router.invalidate();
		});

	const accountGroup = (scope: string, rows: number, children: React.ReactNode) => {
		if (account.state.status === "loading") {
			return (
				<div className="flex flex-col gap-3">
					<h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{scope}</h3>
					<AccountSettingsSkeleton rows={rows} />
				</div>
			);
		}
		if (account.state.status === "failed") {
			return (
				<div className="flex flex-col gap-3">
					<h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{scope}</h3>
					<AccountSettingsUnavailable onRetry={account.retry} />
				</div>
			);
		}
		return <ScopeGroup scope={scope}>{children}</ScopeGroup>;
	};

	const settingsOf = account.state.status === "ready" ? account.state.settings : [];

	return (
		// Every breakpoint here is the column's own width, not the window's: this page shares the row
		// with a navigation rail and a Now panel that either can open, so the viewport says nothing
		// about how much room is actually left.
		<div className="@container">
			<PageTitle>{s.title}</PageTitle>
			<Tabs defaultValue="general" orientation="vertical" className="gap-8">
				{/* A fixed rail, so a longer set of names in another language does not move the page under it. */}
				<TabsList className="w-48 shrink-0 @max-2xl:w-fit">
					{tabs.map(({ value, icon: Icon }) => (
						// The rail keeps its shape as the column narrows: the labels go, the icons stay, and
						// the name is on the trigger itself so it is still announced and still on hover.
						<TabsTrigger key={value} value={value} aria-label={s.tabs[value]} title={s.tabs[value]}>
							<Icon />
							<span className="@max-2xl:hidden">{s.tabs[value]}</span>
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent value="general" className="mx-auto w-full max-w-2xl">
					<Section title={s.tabs.general} description={s.general.description}>
						<ScopeGroup scope={s.scope.computer}>
							<Setting label={s.general.theme.label} description={s.general.theme.description}>
								<div className="flex flex-wrap gap-2">
									{themes.map((option) => (
										<Choice
											key={option.value}
											label={s.general.theme[option.value]}
											caption={option.value === "system" ? s.general.theme.followsDevice : s.general.theme.always}
											icon={option.icon}
											selected={settings.theme === option.value}
											onSelect={() => save({ ...settings, theme: option.value })}
										/>
									))}
								</div>
							</Setting>
							<Setting
								label={s.general.language.label}
								description={s.general.language.description}
								control={
									<Select
										items={languages}
										value={settings.language ?? "system"}
										onValueChange={(next) => {
											const setting = next as LanguageSetting;
											// Drawn at once, stored after: main builds the next YouTube session in the new
											// language, so every held and cached page was answered in the old one.
											applyLanguage(setting);
											void saveAndRefetch({ ...settings, language: setting }).then(() =>
												setSessionLanguage(language())
											);
										}}
									>
										<SelectTrigger className="w-56" aria-label={s.general.language.label}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{Object.entries(languages).map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								}
							/>
							<Setting
								label={s.general.notify.label}
								description={s.general.notify.description}
								control={
									<Switch
										checked={settings.notifyTrackChange !== false}
										onCheckedChange={(on) => save({ ...settings, notifyTrackChange: on })}
									/>
								}
							>
								{notificationsRefused && settings.notifyTrackChange !== false && (
									<p className="text-destructive text-sm">
										{s.general.notify.refused} {s.general.notify.hint[platform]}
									</p>
								)}
							</Setting>
							<Setting
								label={s.general.region.label}
								description={s.general.region.description}
								control={
									<Select
										items={regionItems}
										// AUTOMATIC_REGION is always present, so the trigger names a choice rather than
										// sitting blank: Base UI draws the selected item's label, and an unset region
										// matches no option at all.
										value={settings.region ?? AUTOMATIC_REGION}
										disabled={!regions.length}
										onValueChange={(region) =>
											saveAndRefetch({
												...settings,
												region: region === AUTOMATIC_REGION ? undefined : String(region),
											})
										}
									>
										<SelectTrigger className="w-56" aria-label={s.general.region.label}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												<SelectItem value={AUTOMATIC_REGION}>{regionItems[AUTOMATIC_REGION]}</SelectItem>
												{regions.map(({ code, label }) => (
													<SelectItem key={code} value={code}>
														{label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								}
							/>
							<Setting
								label={s.general.restricted.label}
								description={s.general.restricted.description}
								control={
									<Switch
										checked={settings.restricted === true}
										onCheckedChange={(on) => saveAndRefetch({ ...settings, restricted: on })}
									/>
								}
							/>
						</ScopeGroup>
						{accountGroup(
							s.scope.account,
							1,
							<Setting
								label={s.general.likedFromYouTube.label}
								description={s.general.likedFromYouTube.description}
								control={<AccountSwitch settings={settingsOf} setting="likedFromYouTube" onChange={account.write} />}
							/>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="playback" className="mx-auto w-full max-w-2xl">
					<Section title={s.tabs.playback} description={s.playback.description}>
						<ScopeGroup scope={s.scope.computer}>
							<Setting
								label={s.playback.normalization.label}
								description={s.playback.normalization.description(maxBoostDb)}
								control={
									<Switch
										checked={settings.normalization !== "off"}
										onCheckedChange={(on) => {
											setLastLevel(level);
											void save({ ...settings, normalization: on ? level : "off" });
										}}
									/>
								}
							>
								<div className="flex justify-end">
									<Select
										items={levels}
										value={level}
										disabled={settings.normalization === "off"}
										onValueChange={(next) => {
											setLastLevel(next as Level);
											void save({ ...settings, normalization: next as Level });
										}}
									>
										<SelectTrigger className="w-56">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{Object.entries(levels).map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								</div>
							</Setting>
							<Setting
								label={s.playback.autoplay.label}
								description={s.playback.autoplay.description}
								control={
									<Switch
										checked={settings.autoplay !== false}
										onCheckedChange={(on) => void save({ ...settings, autoplay: on })}
									/>
								}
							/>
							<Setting
								label={s.playback.quality.label}
								description={s.playback.quality.description}
								control={
									<Select
										items={qualities}
										value={settings.quality}
										onValueChange={(quality) => save({ ...settings, quality: quality as Settings["quality"] })}
									>
										<SelectTrigger className="w-56">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{Object.entries(qualities).map(([value, label]) => (
													<SelectItem key={value} value={value}>
														{label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								}
							/>
						</ScopeGroup>
						{accountGroup(
							s.scope.account,
							1,
							<Setting
								label={s.playback.dynamicQueue.label}
								description={s.playback.dynamicQueue.description}
								control={<AccountSwitch settings={settingsOf} setting="dynamicQueue" onChange={account.write} />}
							/>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="privacy" className="mx-auto w-full max-w-2xl">
					<Section title={s.tabs.privacy} description={s.privacy.description}>
						<ScopeGroup scope={s.scope.computer}>
							<Setting
								label={s.privacy.reportHistory.label}
								description={s.privacy.reportHistory.description}
								control={
									<Switch
										checked={settings.reportHistory !== false}
										onCheckedChange={(on) => save({ ...settings, reportHistory: on })}
									/>
								}
							/>
							<Setting
								label={s.privacy.diagnostics.label}
								description={s.privacy.diagnostics.description}
								control={
									<Button
										variant="outline"
										onClick={() =>
											void window.nixie?.local
												.exportDiagnostics()
												.catch(() => toast.add({ title: m.common.diagnostics.failed, type: "error" }))
										}
									>
										<Download data-icon="inline-start" />
										{s.privacy.diagnostics.action}
									</Button>
								}
							/>
							<Setting
								label={s.privacy.localData.label}
								description={s.privacy.localData.description}
								control={
									<Button variant="destructive" onClick={() => void window.nixie?.local.clear("all")}>
										<Trash2 data-icon="inline-start" />
										{s.privacy.localData.action}
									</Button>
								}
							/>
						</ScopeGroup>
						{accountGroup(
							s.scope.account,
							2,
							<>
								<Setting
									label={s.privacy.pauseWatchHistory.label}
									description={s.privacy.pauseWatchHistory.description}
									control={<AccountSwitch settings={settingsOf} setting="pauseWatchHistory" onChange={account.write} />}
								/>
								<Setting
									label={s.privacy.pauseSearchHistory.label}
									description={s.privacy.pauseSearchHistory.description}
									control={
										<AccountSwitch settings={settingsOf} setting="pauseSearchHistory" onChange={account.write} />
									}
								/>
								<LinkRow
									href="https://myactivity.google.com/product/youtube"
									label={s.privacy.manageHistory.label}
									description={s.privacy.manageHistory.description}
								/>
							</>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="about" className="mx-auto w-full max-w-2xl">
					<Section title={s.tabs.about} description={s.about.description}>
						<ScopeGroup>
							<Setting
								label={`Nixie ${info?.version ?? ""}`.trim()}
								description={
									info
										? `${info.os} · ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`
										: s.about.readingBuild
								}
								control={
									<Button
										variant="outline"
										disabled={!info}
										onClick={() => {
											if (!info) return;
											void navigator.clipboard
												.writeText(
													`Nixie ${info.version} · ${info.os} · ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`
												)
												.then(() => toast.add({ title: s.about.versionCopied, type: "success" }));
										}}
									>
										<Copy data-icon="inline-start" />
										{s.about.copy}
									</Button>
								}
							/>
							<UpdateSetting />
							<Setting
								control={<DiagnosticReport />}
								label={s.about.reportIssue.label}
								description={s.about.reportIssue.description}
							/>
						</ScopeGroup>

						<p className="text-muted-foreground max-w-2xl text-sm">{s.about.disclaimer}</p>

						<ScopeGroup scope="Nixie">
							<DocumentRow name="LICENSE" {...s.about.documents.license} />
							<DocumentRow name="PRIVACY.md" {...s.about.documents.privacy} />
							<DocumentRow name="SECURITY.md" {...s.about.documents.security} />
							<DocumentRow name="THIRD_PARTY_NOTICES.md" {...s.about.documents.notices} />
							<DocumentRow name="THIRD_PARTY_LICENSES.txt" {...s.about.documents.licenses} />
						</ScopeGroup>

						<ScopeGroup scope={s.about.youtubeAndGoogle}>
							<LinkRow
								href="https://www.youtube.com/t/terms"
								label={s.about.terms.label}
								description={s.about.terms.description}
							/>
							<LinkRow
								href="https://policies.google.com/privacy"
								label={s.about.googlePrivacy.label}
								description={s.about.googlePrivacy.description}
							/>
							<LinkRow
								href="https://music.youtube.com"
								label="YouTube Music"
								description={s.about.youtubeMusic.description}
							/>
						</ScopeGroup>
					</Section>
				</TabsContent>
				{/* The rail stays on the left and the settings sit in the middle of the page rather than in the
				    middle of what is left beside it, which is what this spacer buys: it balances the rail, and it
				    goes when the column is too narrow to spend that width on nothing. */}
				<div aria-hidden className="w-48 shrink-0 @max-4xl:hidden" />
			</Tabs>
		</div>
	);
}
