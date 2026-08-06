import { Globe, Link2, Lock, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { addPlaylist } from "#/lib/library";
import type { Playlist, PlaylistPrivacy } from "#/shared/contracts";
import { Button } from "./ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/toast";

// Upstream's own wording for each option, and the icon it draws beside it.
export const privacies = {
	public: { label: "Public", hint: "Anyone can search for and view", icon: Globe },
	unlisted: { label: "Unlisted", hint: "Anyone with the link can view", icon: Link2 },
	private: { label: "Private", hint: "Only you can view", icon: Lock },
} satisfies Record<PlaylistPrivacy, { label: string; hint: string; icon: React.ComponentType<{ className?: string }> }>;

// `Select` names its value through this map, so the trigger reads "Public" rather than "public".
const privacyLabels = Object.fromEntries(
	Object.entries(privacies).map(([value, option]) => [value, option.label])
) as Record<PlaylistPrivacy, string>;

/** Who can reach the playlist, stated the way its own dialog states it. */
export function PrivacyLabel({ privacy }: { privacy: PlaylistPrivacy }) {
	const { label, icon: Icon } = privacies[privacy];
	return (
		<span className="inline-flex items-center gap-1.5">
			<Icon className="size-3.5" />
			{label}
		</span>
	);
}

function readForm(form: HTMLFormElement) {
	const data = new FormData(form);
	const title = data.get("title");
	const description = data.get("description");
	return {
		title: typeof title === "string" ? title.trim() : "",
		description: typeof description === "string" ? description.trim() : "",
	};
}

/**
 * Left to itself this is the rail's `+` button and owns both its state and its trigger. A menu's
 * "Save to playlist" submenu drives it instead: the item that opens it is gone by the time the
 * dialog appears, so the state has to be held above the popup and there is no trigger to render.
 */
export function NewPlaylistDialog({
	open: controlledOpen,
	onOpenChange,
	onCreated,
}: {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onCreated?: (playlist: Playlist) => void;
}) {
	const [ownOpen, setOwnOpen] = useState(false);
	const open = controlledOpen ?? ownOpen;
	const setOpen = (next: boolean) => {
		setOwnOpen(next);
		onOpenChange?.(next);
	};
	const [busy, setBusy] = useState(false);
	const [privacy, setPrivacy] = useState<PlaylistPrivacy>("public");
	const [collaborate, setCollaborate] = useState(false);

	// A private playlist cannot be collaborative upstream ("Change privacy to allow collaboration"),
	// so the toggle follows the privacy instead of letting the create come back rejected.
	const shareable = privacy !== "private";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// The next playlist starts where upstream's own dialog starts, not where the last one ended.
				if (!next) {
					setPrivacy("public");
					setCollaborate(false);
				}
			}}
		>
			{controlledOpen === undefined && (
				<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New playlist" />}>
					<Plus />
				</DialogTrigger>
			)}
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New playlist</DialogTitle>
					<DialogDescription>The playlist is created on your YouTube Music account.</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const { title, description } = readForm(event.currentTarget);
						if (!title) return;
						setBusy(true);
						void window.noctune?.music
							.command({
								type: "playlist-create",
								title,
								description: description || undefined,
								privacy,
								collaborate: shareable && collaborate,
							})
							.then((result) => {
								const playlist: Playlist = {
									// The create endpoint answers with the playlist's own id, where a playlist is
									// addressed by its browse id everywhere in this app: the same string under `VL`.
									id: result.id ? `VL${result.id}` : title,
									title,
									description: description || undefined,
									privacy,
									itemCount: 0,
								};
								// Straight into the store rather than back up to the rail: the submenu offering the
								// same playlists is nowhere near that rail and has to see the new one too.
								addPlaylist(playlist);
								onCreated?.(playlist);
								setOpen(false);
								toast.add({ title: "Playlist created", description: title, type: "success" });
							})
							.catch(() => toast.add({ title: "Could not create playlist", type: "error" }))
							.finally(() => setBusy(false));
					}}
				>
					<FieldGroup>
						<Field>
							{/* Every field names its control through `aria-labelledby` rather than `htmlFor`: a label
						    bound to a control forwards a click onto it, so a press on the word put the caret in
						    the field or opened the select. The accessible name is the same either way. */}
							<FieldLabel id="new-playlist-title-label">Title</FieldLabel>
							<Input
								aria-labelledby="new-playlist-title-label"
								name="title"
								maxLength={150}
								required
								autoComplete="off"
							/>
						</Field>
						<Field>
							<FieldLabel id="new-playlist-description-label">Description</FieldLabel>
							<Textarea
								aria-labelledby="new-playlist-description-label"
								name="description"
								maxLength={5000}
								className="resize-none"
							/>
						</Field>
						<Field>
							<FieldLabel id="new-playlist-privacy-label">Privacy</FieldLabel>
							<Select
								items={privacyLabels}
								value={privacy}
								onValueChange={(next) => {
									setPrivacy(next as PlaylistPrivacy);
									if (next === "private") setCollaborate(false);
								}}
							>
								<SelectTrigger aria-labelledby="new-playlist-privacy-label">
									<SelectValue>
										<PrivacyLabel privacy={privacy} />
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{Object.entries(privacies).map(([value, option]) => (
											<SelectItem key={value} value={value}>
												<option.icon className="size-4" />
												{option.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<FieldDescription>{privacies[privacy].hint}</FieldDescription>
						</Field>
						<Field orientation="horizontal">
							<FieldLabel id="new-playlist-collaborate-label">Collaborate</FieldLabel>
							<Switch
								aria-labelledby="new-playlist-collaborate-label"
								checked={shareable && collaborate}
								disabled={!shareable}
								onCheckedChange={setCollaborate}
							/>
						</Field>
						{!shareable && <FieldDescription>Change privacy to allow collaboration.</FieldDescription>}
						<DialogFooter>
							<DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
							<Button type="submit" disabled={busy}>
								Create
							</Button>
						</DialogFooter>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function EditPlaylistDialog({
	title,
	description,
	privacy,
	onSave,
}: {
	title: string;
	description: string;
	/** Stated only for a playlist the account owns, which is also the only one whose privacy it can set. */
	privacy?: PlaylistPrivacy;
	onSave: (title: string, description: string, privacy?: PlaylistPrivacy) => void;
}) {
	const [open, setOpen] = useState(false);
	const [nextPrivacy, setNextPrivacy] = useState(privacy);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// The fields are uncontrolled and remount on close, so the select goes back with them
				// rather than holding a choice the cancelled edit never saved.
				if (!next) setNextPrivacy(privacy);
			}}
		>
			<DialogTrigger render={<Button variant="outline" />}>
				<Pencil data-icon="inline-start" />
				Edit details
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit playlist</DialogTitle>
					<DialogDescription>Changes sync to YouTube Music.</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const next = readForm(event.currentTarget);
						onSave(next.title, next.description, nextPrivacy);
						setOpen(false);
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel id="playlist-title-label">Name</FieldLabel>
							<Input
								aria-labelledby="playlist-title-label"
								name="title"
								defaultValue={title}
								maxLength={150}
								required
							/>
						</Field>
						<Field>
							<FieldLabel id="playlist-description-label">Description</FieldLabel>
							<Textarea
								aria-labelledby="playlist-description-label"
								name="description"
								defaultValue={description}
								maxLength={5000}
								className="resize-none"
							/>
						</Field>
						{nextPrivacy && (
							<Field>
								<FieldLabel id="playlist-privacy-label">Privacy</FieldLabel>
								<Select
									items={privacyLabels}
									value={nextPrivacy}
									onValueChange={(value) => setNextPrivacy(value as PlaylistPrivacy)}
								>
									<SelectTrigger aria-labelledby="playlist-privacy-label">
										<SelectValue>
											<PrivacyLabel privacy={nextPrivacy} />
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{Object.entries(privacies).map(([value, option]) => (
												<SelectItem key={value} value={value}>
													<option.icon className="size-4" />
													{option.label}
												</SelectItem>
											))}
										</SelectGroup>
									</SelectContent>
								</Select>
								<FieldDescription>{privacies[nextPrivacy].hint}</FieldDescription>
							</Field>
						)}
						<Button type="submit">Save changes</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}
