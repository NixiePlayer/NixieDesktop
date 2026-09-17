import { Bug } from "lucide-react";
import { useId, useState } from "react";
import { useMessages } from "#/lib/i18n";
import { cn } from "#/lib/utils";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";

/** Available before sign-in too. Nothing leaves the app until the reader chooses an action. */
export function DiagnosticReport({ compact = false }: { compact?: boolean }) {
	const m = useMessages().common.diagnostics;
	const titleId = useId();
	const [report, setReport] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");

	const load = () => {
		setReport(undefined);
		setStatus("");
		const bridge = window.nixie;
		if (!bridge) return setStatus(m.failed);
		void bridge.local.diagnostics().then(setReport, () => setStatus(m.failed));
	};
	const share = async (issue: boolean) => {
		if (!report || !window.nixie) return;
		setBusy(true);
		setStatus("");
		try {
			if (issue) await window.nixie.local.reportIssue();
			else await navigator.clipboard.writeText(report);
			setStatus(issue ? m.issueOpened : m.copied);
		} catch {
			setStatus(m.failed);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) load();
			}}
		>
			<DialogTrigger
				render={
					<Button
						variant="outline"
						size={compact ? "icon-sm" : "sm"}
						className={cn("shrink-0", !compact && "w-48")}
						aria-label={m.title}
					/>
				}
			>
				{compact ? <Bug /> : m.title}
			</DialogTrigger>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle id={titleId}>{m.title}</DialogTitle>
					<DialogDescription>{m.description}</DialogDescription>
				</DialogHeader>
				<Textarea
					aria-labelledby={titleId}
					readOnly
					value={report ?? ""}
					placeholder={m.loading}
					className="h-64 resize-none font-mono text-xs"
				/>
				<p role="status" className="text-muted-foreground min-h-5 text-sm">
					{status || m.pasteHint}
				</p>
				<DialogFooter>
					<Button variant="ghost" onClick={load} disabled={busy}>
						{m.refresh}
					</Button>
					<Button variant="outline" disabled={!report || busy} onClick={() => void share(false)}>
						{m.copy}
					</Button>
					<Button disabled={!report || busy} onClick={() => void share(true)}>
						{m.openIssue}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
