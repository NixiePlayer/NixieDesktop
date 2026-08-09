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
import { dropHeldPages, queryMusic } from "#/lib/api";
import { formatBytes, plural } from "#/lib/format";
import { applyTheme, storedTheme } from "#/lib/theme";
import { checkForUpdates, useUpdateState } from "#/lib/updates";
import { cn } from "#/lib/utils";
import type { AppInfo, NormalizationLevel, Settings } from "#/shared/contracts";
import { defaultState } from "#/shared/defaults";
import { maxBoostDb, normalizationTargets } from "#/shared/normalization";
import { regionCode } from "#/shared/regions";

const themes = [
	{ value: "dark", label: "Dark", caption: "Always", icon: Moon },
	{ value: "light", label: "Light", caption: "Always", icon: Sun },
	{ value: "system", label: "System", caption: "Follows the device", icon: Monitor },
] as const;

// The label carries the loudness each level aims for, which is the whole difference between them.
type Level = Exclude<NormalizationLevel, "off">;
const levels: Record<Level, string> = {
	quiet: `Quiet (${normalizationTargets.quiet} LUFS)`,
	normal: `Normal (${normalizationTargets.normal} LUFS)`,
	loud: `Loud (${normalizationTargets.loud} LUFS)`,
};

// Passed to Select as `items` so the trigger shows the label instead of the raw value.
const qualities: Record<Settings["quality"], string> = {
	low: "Data saver",
	normal: "Balanced",
	high: "Highest available",
};

const tabs = [
	{ value: "general", label: "General", icon: SlidersHorizontal },
	{ value: "playback", label: "Playback", icon: Gauge },
	{ value: "downloads", label: "Downloads", icon: Download },
	{ value: "privacy", label: "Privacy", icon: Shield },
	{ value: "about", label: "About", icon: Info },
] as const;

const REPOSITORY = "https://github.com/NoctunePlayer/NoctuneDesktop";

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
 */
function useRegions() {
	const [regions, setRegions] = useState<{ code: string; label: string }[]>([]);
	useEffect(() => {
		void queryMusic({ type: "explore", browseId: "FEmusic_charts" })
			.then((page) => {
				const seen = new Map<string, string>();
				for (const region of page.explore?.regions ?? []) {
					const code = regionCode(region.label);
					if (code && !seen.has(code)) seen.set(code, region.label);
				}
				setRegions([...seen].map(([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label)));
			})
			.catch(() => setRegions([]));
	}, []);
	return regions;
}

function useDownloads() {
	const [state, setState] = useState<{ count: number; bytes: number }>();
	const read = () => {
		const bridge = window.noctune;
		if (!bridge) return;
		void Promise.all([bridge.local.load(), bridge.local.downloadsSize()])
			.then(([stored, bytes]) => setState({ count: stored.downloads.length, bytes }))
			.catch(() => setState({ count: 0, bytes: 0 }));
	};
	useEffect(read, []);
	return { downloads: state, refresh: read };
}

/**
 * Whether the system has refused a banner. Read on mount rather than pushed: this is the only page
 * that shows it, and a refusal that happens while it is open is one the reader is not being notified
 * about anyway, since nothing is drawn while Noctune has focus.
 */
function useNotificationsRefused() {
	const [refused, setRefused] = useState(false);
	useEffect(() => {
		void window.noctune?.player
			.notifyRefused()
			.then(setRefused)
			.catch(() => undefined);
	}, []);
	return refused;
}

function useAppInfo() {
	const [info, setInfo] = useState<AppInfo>();
	useEffect(() => {
		void window.noctune?.app
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
	const update = window.noctune?.update;
	const version = state.version ?? "";
	// Held once because it is written twice: the downloading button is sized against it, so a reworded
	// button would otherwise leave the bar the width of a sentence nobody prints any more.
	const restart = "Restart now";
	// Nothing rests on "available" now that the download starts itself: it is the first tick of the
	// download, a beat before the first percent, so it reads as one state rather than two.
	const downloading = {
		label: `Downloading Noctune ${version}`,
		description: "Keep listening, this runs in the background.",
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
			label: "Check for updates",
			description: "A development build has no release feed behind it, so this answers nothing.",
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					Check now
				</Button>
			),
		},
		checking: {
			label: "Checking for updates",
			description: "Asking GitHub what the latest release is.",
			control: (
				<Button variant="outline" disabled>
					Checking
				</Button>
			),
		},
		current: {
			label: "Up to date",
			description: "This is the latest release.",
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					Check again
				</Button>
			),
		},
		available: downloading,
		downloading,
		ready: {
			label: `Noctune ${version} is ready`,
			description: "Restarting installs it, and so does quitting Noctune later.",
			control: <Button onClick={() => void update?.install()}>{restart}</Button>,
		},
		error: {
			label: "Could not check for updates",
			description: "GitHub could not be reached. Every release is on the repository as well.",
			control: (
				<Button variant="outline" onClick={checkForUpdates}>
					Try again
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
	const [settings, setSettings] = useState<Settings>(() => ({ ...defaultState().settings, theme: storedTheme() }));
	// Remembers the target across an off/on toggle, since "off" cannot hold one.
	const [lastLevel, setLastLevel] = useState<Level>("normal");
	const level = settings.normalization === "off" ? lastLevel : settings.normalization;
	const account = useAccountSettings();
	const regions = useRegions();
	const regionItems = useMemo(
		() => ({ [AUTOMATIC_REGION]: "Chosen by YouTube", ...Object.fromEntries(regions.map((r) => [r.code, r.label])) }),
		[regions]
	);
	const { downloads, refresh: refreshDownloads } = useDownloads();
	const info = useAppInfo();
	const notificationsRefused = useNotificationsRefused();

	useEffect(() => {
		void window.noctune?.local.load().then((state) => setSettings(state.settings));
	}, []);

	const save = async (next: Settings) => {
		setSettings(next);
		applyTheme(next.theme);
		const state = await window.noctune?.local.load();
		if (state) await window.noctune?.local.save({ ...state, settings: next });
	};

	/**
	 * Region and Restricted Mode are fixed when the InnerTube session is built, so every page already
	 * in the router's cache was answered for the old value and would go on being shown for it: nothing
	 * is revalidated under a reader here. Invalidating is what makes the change visible.
	 */
	const saveAndRefetch = (next: Settings) => {
		// Awaited, not fired alongside: the adapter reads the region and Restricted Mode off the stored
		// state when it builds its next session, so invalidating before the write lands would refetch
		// every page against the value being replaced.
		void save(next).then(() => {
			// Invalidating reaches the pages the router holds. The refreshed Home and Explore feeds and
			// the drawn mixes are held outside it, and a Home feed drawn for the old region is exactly
			// what the next visit would be served.
			dropHeldPages();
			void router.invalidate();
		});
	};

	const clearDownloads = () => {
		if (
			!downloads?.count ||
			!window.confirm(`Remove ${plural(downloads.count, "downloaded track")} from this computer?`)
		) {
			return;
		}
		void window.noctune?.local.clear("downloads").then(() => {
			refreshDownloads();
			void router.invalidate();
			toast.add({ title: "Downloads removed", type: "success" });
		});
	};

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
	const issueUrl = `${REPOSITORY}/issues/new?${new URLSearchParams({
		title: "",
		body: info
			? `\n\n---\nNoctune ${info.version} · ${info.os} · ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`
			: "",
	})}`;

	return (
		// Every breakpoint here is the column's own width, not the window's: this page shares the row
		// with a navigation rail and a Now panel that either can open, so the viewport says nothing
		// about how much room is actually left.
		<div className="@container">
			<PageTitle>Settings</PageTitle>
			<Tabs defaultValue="general" orientation="vertical" className="gap-8">
				<TabsList>
					{tabs.map(({ value, label, icon: Icon }) => (
						// The rail keeps its shape as the column narrows: the labels go, the icons stay, and
						// the name is on the trigger itself so it is still announced and still on hover.
						<TabsTrigger key={value} value={value} aria-label={label} title={label}>
							<Icon />
							<span className="@max-2xl:hidden">{label}</span>
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent value="general">
					<Section title="General" description="How Noctune looks, and what YouTube Music sends it.">
						<ScopeGroup scope="On this computer">
							<Setting label="Theme" description="System follows your device's appearance.">
								<div className="flex flex-wrap gap-2">
									{themes.map((option) => (
										<Choice
											key={option.value}
											label={option.label}
											caption={option.caption}
											icon={option.icon}
											selected={settings.theme === option.value}
											onSelect={() => save({ ...settings, theme: option.value })}
										/>
									))}
								</div>
							</Setting>
							<Setting
								label="Notify on track change"
								description="Names the next track when the queue moves on by itself. Nothing is shown while Noctune is the app you are in."
								control={
									<Switch
										checked={settings.notifyTrackChange !== false}
										onCheckedChange={(on) => save({ ...settings, notifyTrackChange: on })}
									/>
								}
							>
								{notificationsRefused && settings.notifyTrackChange !== false && (
									<p className="text-destructive text-sm">
										Your system refused the last one. Allow notifications for Noctune in System Settings, under
										Notifications.
									</p>
								)}
							</Setting>
							<Setting
								label="Content region"
								description="Decides which charts, new releases and recommendations you are shown. This is not the app's language."
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
										<SelectTrigger aria-label="Content region">
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
								label="Restricted mode"
								description="Hides songs and videos with potentially mature content. No filter catches everything. YouTube keeps this per app rather than on your account, so it covers Noctune alone."
								control={
									<Switch
										checked={settings.restricted === true}
										onCheckedChange={(on) => saveAndRefetch({ ...settings, restricted: on })}
									/>
								}
							/>
						</ScopeGroup>
						{accountGroup(
							"Your account · every device",
							1,
							<Setting
								label="Liked music from YouTube"
								description="Shows music videos you gave a thumbs up in other YouTube apps in your Liked music playlist."
								control={<AccountSwitch settings={settingsOf} setting="likedFromYouTube" onChange={account.write} />}
							/>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="playback">
					<Section title="Playback" description="How Noctune streams and levels what you play.">
						<ScopeGroup scope="On this computer">
							<Setting
								label="Volume normalization"
								description={`Holds tracks near one loudness, using the levels YouTube measured. Quiet tracks are brought up toward the target and loud ones held down, with the lift capped at ${maxBoostDb} dB so nothing clips.`}
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
										<SelectTrigger>
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
								label="Autoplay"
								description="Keeps playing when the queue runs out, on a radio YouTube Music seeds from the track that just finished. Turning this off stops Noctune at the end of the queue."
								control={
									<Switch
										checked={settings.autoplay !== false}
										onCheckedChange={(on) => void save({ ...settings, autoplay: on })}
									/>
								}
							/>
							<Setting
								label="Audio quality"
								description="Opus is preferred, AAC is the fallback."
								control={
									<Select
										items={qualities}
										value={settings.quality}
										onValueChange={(quality) => save({ ...settings, quality: quality as Settings["quality"] })}
									>
										<SelectTrigger>
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
							"Your account · every device",
							1,
							<Setting
								label="Dynamic queue"
								description="Lets YouTube Music update queues and radios as it learns what you listen to."
								control={<AccountSwitch settings={settingsOf} setting="dynamicQueue" onChange={account.write} />}
							/>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="downloads">
					<Section
						title="Downloads"
						description="Tracks saved to this computer so they play without a connection. They live with the app and go when it does."
					>
						<ScopeGroup scope="On this computer">
							<Setting
								label="Saved for offline listening"
								description={
									downloads
										? downloads.count
											? `${plural(downloads.count, "track")}, ${formatBytes(downloads.bytes)} on disk.`
											: "Nothing downloaded yet. Save a track, album or playlist from its menu."
										: "Measuring what is on disk."
								}
								control={
									<Button variant="destructive" disabled={!downloads?.count} onClick={clearDownloads}>
										<Trash2 data-icon="inline-start" />
										Remove all
									</Button>
								}
							/>
						</ScopeGroup>
					</Section>
				</TabsContent>

				<TabsContent value="privacy">
					<Section
						title="Privacy"
						description="Noctune has no account service, backend, telemetry, or media cache. Nothing here leaves this device except what the rows below send to the account you linked."
					>
						<ScopeGroup scope="On this computer">
							<Setting
								label="Report plays to YouTube"
								description="Tells YouTube Music what you played, which is what personalises your home feed. Turning this off leaves the feed on whatever it already knows about you."
								control={
									<Switch
										checked={settings.reportHistory !== false}
										onCheckedChange={(on) => save({ ...settings, reportHistory: on })}
									/>
								}
							/>
							<Setting
								label="Diagnostics"
								description="Writes a log file with playback and session events. Cookies, stream URLs, file paths, and lyrics are redacted."
								control={
									<Button variant="outline" onClick={() => void window.noctune?.local.exportDiagnostics()}>
										<Download data-icon="inline-start" />
										Export
									</Button>
								}
							/>
							<Setting
								label="Local data"
								description="Removes the queue, settings, downloads, and the linked browser account, so this signs you out."
								control={
									<Button variant="destructive" onClick={() => void window.noctune?.local.clear("all")}>
										<Trash2 data-icon="inline-start" />
										Clear
									</Button>
								}
							/>
						</ScopeGroup>
						{accountGroup(
							"Your account · every device",
							2,
							<>
								<Setting
									label="Pause watch history"
									description="Stops YouTube recording what you play, in every app signed in to this account. It can take a moment to apply."
									control={<AccountSwitch settings={settingsOf} setting="pauseWatchHistory" onChange={account.write} />}
								/>
								<Setting
									label="Pause search history"
									description="Stops YouTube recording what you search for, in every app signed in to this account."
									control={
										<AccountSwitch settings={settingsOf} setting="pauseSearchHistory" onChange={account.write} />
									}
								/>
								<LinkRow
									href="https://myactivity.google.com/product/youtube"
									label="Manage or delete your history"
									description="Review and remove what YouTube has recorded. Deleting is permanent and covers every device."
								/>
							</>
						)}
					</Section>
				</TabsContent>

				<TabsContent value="about">
					<Section title="About" description="What this build is, and how to tell us it is wrong.">
						<ScopeGroup>
							<Setting
								label={`Noctune ${info?.version ?? ""}`.trim()}
								description={
									info
										? `${info.os} · ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`
										: "Reading this build."
								}
								control={
									<Button
										variant="outline"
										disabled={!info}
										onClick={() => {
											if (!info) return;
											void navigator.clipboard
												.writeText(
													`Noctune ${info.version} · ${info.os} · ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`
												)
												.then(() => toast.add({ title: "Version copied", type: "success" }));
										}}
									>
										<Copy data-icon="inline-start" />
										Copy
									</Button>
								}
							/>
							<UpdateSetting />
							<LinkRow
								href={issueUrl}
								label="Report an issue"
								description="Opens a new issue on GitHub with this build's version already filled in."
							/>
						</ScopeGroup>

						<p className="text-muted-foreground max-w-2xl text-sm">
							Noctune is an independent, unofficial client and is not affiliated with, endorsed by, or sponsored by
							Google or YouTube. YouTube and YouTube Music are trademarks of Google LLC. It is not a YouTube Music
							product and does not reproduce or imitate one: it plays what the account you linked can already play, and
							it stores no media of its own.
						</p>

						<ScopeGroup scope="Noctune">
							<DocumentRow name="LICENSE" title="License" description="Noctune is released under the MIT license." />
							<DocumentRow
								name="PRIVACY.md"
								title="Privacy"
								description="What is stored on this computer, and the one thing that leaves it."
							/>
							<DocumentRow
								name="SECURITY.md"
								title="Security"
								description="How the app is sandboxed, and how to report a vulnerability."
							/>
							<DocumentRow
								name="THIRD_PARTY_NOTICES.md"
								title="Third-party notices"
								description="The projects and lyrics sources Noctune depends on."
							/>
						</ScopeGroup>

						<ScopeGroup scope="YouTube and Google">
							<LinkRow
								href="https://www.youtube.com/t/terms"
								label="YouTube Terms of Service"
								description="The terms covering the account Noctune plays through."
							/>
							<LinkRow
								href="https://policies.google.com/privacy"
								label="Google Privacy Policy"
								description="How Google handles the data behind that account."
							/>
							<LinkRow
								href="https://music.youtube.com"
								label="YouTube Music"
								description="The official app, where every account setting can also be changed."
							/>
						</ScopeGroup>
					</Section>
				</TabsContent>
			</Tabs>
		</div>
	);
}
