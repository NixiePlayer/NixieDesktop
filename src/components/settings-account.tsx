import { useRouter } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { Switch } from "#/components/ui/switch";
import { toast } from "#/components/ui/toast";
import type { AccountSetting, AccountSettingKey } from "#/shared/contracts";

/** The one link that stands in for every switch this section could not draw. */
export function OpenYouTubeMusicSettings({ children = "Open YouTube Music settings" }: { children?: string }) {
	return (
		<a
			href="https://music.youtube.com/settings"
			target="_blank"
			rel="noreferrer"
			className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
		>
			{children}
			<ExternalLink className="size-3.5" />
		</a>
	);
}

type State = { status: "loading" } | { status: "ready"; settings: AccountSetting[] } | { status: "failed" };

/**
 * The account settings, fetched once and written optimistically.
 *
 * Optimistic is not a nicety here. Upstream applies the two history switches a beat after it accepts
 * them, so reading straight back states the value that was just replaced, and a switch driven off
 * that read would snap backwards a moment after every press. Nothing here reads back: the press is
 * believed, and only a rejection moves the switch again.
 */
export function useAccountSettings() {
	const [state, setState] = useState<State>({ status: "loading" });
	const router = useRouter();

	const load = useCallback(() => {
		setState({ status: "loading" });
		const bridge = window.neotune;
		if (!bridge) return setState({ status: "failed" });
		void bridge.music
			.accountSettings()
			// An empty answer is a failure that main already logged: YouTube Music always states these.
			.then((settings) => setState(settings.length ? { status: "ready", settings } : { status: "failed" }))
			.catch(() => setState({ status: "failed" }));
	}, []);

	useEffect(load, [load]);

	const write = (key: AccountSettingKey, enabled: boolean) => {
		if (state.status !== "ready") return;
		const previous = state.settings;
		setState({
			status: "ready",
			settings: previous.map((setting) => (setting.key === key ? { ...setting, enabled } : setting)),
		});
		void window.neotune?.music
			.command({ type: "account-setting", key, enabled })
			// These settings decide what upstream answers with, and nothing is revalidated under a
			// reader, so a page already in the cache goes on being the one the old value produced:
			// "Liked music from YouTube" is the whole contents of the Liked music playlist. Invalidated
			// after the write lands rather than beside it, since a refetch racing the write would be
			// answered for the value being replaced.
			// Handled as the second argument rather than a `.catch`, which would also take a rejection
			// from the refetch and roll a switch back over a page that failed to load.
			.then(
				() => router.invalidate(),
				() => {
					setState({ status: "ready", settings: previous });
					toast.add({ title: "YouTube Music did not save that", type: "error" });
				}
			);
	};

	return { state, write, retry: load };
}

/** Stands in for the rows while they load, shaped like them so nothing jumps when they arrive. */
export function AccountSettingsSkeleton({ rows }: { rows: number }) {
	return (
		<div className="border-border divide-border flex flex-col divide-y rounded-xl border">
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className="flex items-start justify-between gap-6 p-5">
					<div className="flex flex-col gap-2">
						<Skeleton className="h-4 w-44" />
						<Skeleton className="h-3 w-64" />
					</div>
					<Skeleton className="h-5 w-9 rounded-full" />
				</div>
			))}
		</div>
	);
}

export function AccountSettingsUnavailable({ onRetry }: { onRetry: () => void }) {
	return (
		<div className="border-border flex flex-col items-start gap-4 rounded-xl border p-5">
			<p className="text-muted-foreground text-sm">
				Neotune could not reach your account settings. They are still yours to change on YouTube Music.
			</p>
			<div className="flex items-center gap-4">
				<Button variant="outline" size="sm" onClick={onRetry}>
					Try again
				</Button>
				<OpenYouTubeMusicSettings />
			</div>
		</div>
	);
}

/** A switch bound to one account setting, or nothing at all if this response never named it. */
export function AccountSwitch({
	settings,
	setting,
	onChange,
}: {
	settings: AccountSetting[];
	setting: AccountSettingKey;
	onChange: (key: AccountSettingKey, enabled: boolean) => void;
}) {
	const current = settings.find(({ key }) => key === setting);
	if (!current) return;
	return <Switch checked={current.enabled} onCheckedChange={(enabled) => onChange(setting, enabled)} />;
}
