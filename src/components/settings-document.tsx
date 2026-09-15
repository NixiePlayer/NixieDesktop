import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "#/components/ui/dialog";
import { messages, useMessages } from "#/lib/i18n";
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
	const m = useMessages();

	useEffect(() => {
		if (!open || text !== undefined) return;
		void window.nixie?.local
			.document(name)
			.then(setText)
			// Read at the moment it fails, so it is never a dependency that refetches the document.
			.catch(() => setText(messages().settings.document.unreadable(name)));
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
				{/* A fixed height, not a maximum: every one of these documents runs past it, so a maximum
				    only ever described the placeholder, and the dialog opened one line tall and jumped to
				    full height the moment the text landed. */}
				<pre className="text-muted-foreground h-[60vh] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
					{text ?? m.settings.document.reading}
				</pre>
			</DialogContent>
		</Dialog>
	);
}
