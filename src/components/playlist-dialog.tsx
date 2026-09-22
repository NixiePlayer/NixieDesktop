import { Globe, Link2, Lock, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useMessages } from "#/lib/i18n";
import { invalidatePages } from "#/lib/invalidate";
import { addPlaylist } from "#/lib/library";
import type { Playlist, PlaylistPrivacy } from "#/shared/contracts";
import { emptyPlaylistArtwork } from "#/shared/entities";
import type { Messages } from "#/shared/i18n";
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

// Upstream's own wording for each option lives in the dictionary; this is the icon it draws beside it.
const privacyIcons = { public: Globe, unlisted: Link2, private: Lock } satisfies Record<
	PlaylistPrivacy,
	React.ComponentType<{ className?: string }>
>;
const privacyValues = Object.keys(privacyIcons) as PlaylistPrivacy[];

// `Select` names its value through this map, so the trigger reads "Public" rather than "public".
const privacyLabels = (m: Messages) =>
	Object.fromEntries(privacyValues.map((value) => [value, m.menu.privacy[value].label])) as Record<
		PlaylistPrivacy,
		string
	>;

/** Who can reach the playlist, stated the way its own dialog states it. */
export function PrivacyLabel({ privacy }: { privacy: PlaylistPrivacy }) {
	const m = useMessages();
	const Icon = privacyIcons[privacy];
	const { label } = m.menu.privacy[privacy];
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
	const m = useMessages();
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
				<DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={m.menu.newPlaylist} />}>
					<Plus />
				</DialogTrigger>
			)}
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.menu.newPlaylist}</DialogTitle>
					<DialogDescription>{m.menu.newPlaylistDescription}</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const { title, description } = readForm(event.currentTarget);
						if (!title) return;
						setBusy(true);
						void window.nixie?.music
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
									artworkUrl: emptyPlaylistArtwork,
									privacy,
									itemCount: 0,
								};
								// Straight into the store rather than back up to the rail: the submenu offering the
								// same playlists is nowhere near that rail and has to see the new one too.
								addPlaylist(playlist);
								// The rail is the store's; the library page is a cached loader and lists it only once dropped.
								void invalidatePages({ routeId: "/library" });
								onCreated?.(playlist);
								setOpen(false);
								toast.add({ title: m.menu.playlistCreated, description: title, type: "success" });
							})
							.catch(() => toast.add({ title: m.menu.couldNotCreatePlaylist, type: "error" }))
							.finally(() => setBusy(false));
					}}
				>
					<FieldGroup>
						<Field>
							{/* Every field names its control through `aria-labelledby` rather than `htmlFor`: a label
						    bound to a control forwards a click onto it, so a press on the word put the caret in
						    the field or opened the select. The accessible name is the same either way. */}
							<FieldLabel id="new-playlist-title-label">{m.menu.title}</FieldLabel>
							<Input
								aria-labelledby="new-playlist-title-label"
								name="title"
								maxLength={150}
								required
								autoComplete="off"
							/>
						</Field>
						<Field>
							<FieldLabel id="new-playlist-description-label">{m.menu.description}</FieldLabel>
							<Textarea
								aria-labelledby="new-playlist-description-label"
								name="description"
								maxLength={5000}
								className="resize-none"
							/>
						</Field>
						<Field>
							<FieldLabel id="new-playlist-privacy-label">{m.menu.privacyLabel}</FieldLabel>
							<Select
								items={privacyLabels(m)}
								value={privacy}
								onValueChange={(next) => {
									setPrivacy(next as PlaylistPrivacy);
									if (next === "private") setCollaborate(false);
								}}
							>
								{/* Full width rather than the trigger's own `w-fit`, which sizes it to the value it is
								    showing: the control was one width for "Private" and another for "Non in elenco",
								    so it resized as the option changed and again with the language. */}
								<SelectTrigger className="w-full" aria-labelledby="new-playlist-privacy-label">
									<SelectValue>
										<PrivacyLabel privacy={privacy} />
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{privacyValues.map((value) => {
											const Icon = privacyIcons[value];
											return (
												<SelectItem key={value} value={value}>
													<Icon className="size-4" />
													{m.menu.privacy[value].label}
												</SelectItem>
											);
										})}
									</SelectGroup>
								</SelectContent>
							</Select>
							<FieldDescription>{m.menu.privacy[privacy].hint}</FieldDescription>
						</Field>
						<Field orientation="horizontal">
							<FieldLabel id="new-playlist-collaborate-label">{m.menu.collaborate}</FieldLabel>
							<Switch
								aria-labelledby="new-playlist-collaborate-label"
								checked={shareable && collaborate}
								disabled={!shareable}
								onCheckedChange={setCollaborate}
							/>
						</Field>
						{/* Always drawn and hidden when it does not apply, so its line is reserved rather than
						    inserted: appearing with the privacy made the dialog taller, and a dialog centred on
						    its own height moves every row above it when it grows. Hidden this way it is out of
						    the accessibility tree too. */}
						<FieldDescription className={shareable ? "invisible" : undefined}>
							{m.menu.collaborationHint}
						</FieldDescription>
						<DialogFooter>
							<DialogClose render={<Button type="button" variant="ghost" />}>{m.common.cancel}</DialogClose>
							<Button type="submit" disabled={busy}>
								{m.menu.create}
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
	const m = useMessages();
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
				{m.menu.editDetails}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.menu.editPlaylist}</DialogTitle>
					<DialogDescription>{m.menu.editPlaylistDescription}</DialogDescription>
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
							<FieldLabel id="playlist-title-label">{m.menu.name}</FieldLabel>
							<Input
								aria-labelledby="playlist-title-label"
								name="title"
								defaultValue={title}
								maxLength={150}
								required
							/>
						</Field>
						<Field>
							<FieldLabel id="playlist-description-label">{m.menu.description}</FieldLabel>
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
								<FieldLabel id="playlist-privacy-label">{m.menu.privacyLabel}</FieldLabel>
								<Select
									items={privacyLabels(m)}
									value={nextPrivacy}
									onValueChange={(value) => setNextPrivacy(value as PlaylistPrivacy)}
								>
									<SelectTrigger className="w-full" aria-labelledby="playlist-privacy-label">
										<SelectValue>
											<PrivacyLabel privacy={nextPrivacy} />
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectGroup>
											{privacyValues.map((value) => {
												const Icon = privacyIcons[value];
												return (
													<SelectItem key={value} value={value}>
														<Icon className="size-4" />
														{m.menu.privacy[value].label}
													</SelectItem>
												);
											})}
										</SelectGroup>
									</SelectContent>
								</Select>
								<FieldDescription>{m.menu.privacy[nextPrivacy].hint}</FieldDescription>
							</Field>
						)}
						<Button type="submit">{m.menu.saveChanges}</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}
