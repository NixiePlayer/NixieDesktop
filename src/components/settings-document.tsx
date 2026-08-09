import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "#/components/ui/dialog";
import type { BundledDocument } from "#/shared/contracts";

/**
 * One of the documents shipped inside the app bundle, shown as it was written.
 *
 * Read from the bundle rather than linked to GitHub, so the text is the one in the build that is
 * running and it opens with no network. ponytail: rendered as preformatted text, not parsed. These
 * are files of plain prose, and the generated licence collection is plain text with no markdown in
 * it at all, so a markdown renderer would be the eleventh runtime dependency in a project that has
 * ten.
 */
export function DocumentRow({
	name,
	title,
	description,
}: {
	name: BundledDocument;
	title: string;
	description: string;
}) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState<string>();

	useEffect(() => {
		if (!open || text !== undefined) return;
		void window.neotune?.local
			.document(name)
			.then(setText)
			.catch(() => setText(`Neotune could not read ${name} from this build.`));
	}, [open, text, name]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<button
						type="button"
						className="hover:bg-accent/50 flex w-full flex-col gap-1 p-5 text-left transition-colors"
					/>
				}
			>
				<span className="text-sm font-medium">{title}</span>
				<span className="text-muted-foreground text-sm">{description}</span>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<pre className="text-muted-foreground max-h-[60vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
					{text ?? "Reading…"}
				</pre>
			</DialogContent>
		</Dialog>
	);
}
