import { useEffect, useSyncExternalStore } from "react";
import { toast } from "#/components/ui/toast";
import { queryMusic } from "#/lib/api";
import type { MusicCommand, MusicEntity, Playlist } from "#/shared/contracts";
import { isAlbum, isArtist, isPlaylist } from "#/shared/entities";

/**
 * What the account holds, and the one place that says so. Same reason the ratings are a store: the
 * fact has several writers and several readers, and none of them owns the others. The navigation
 * rail lists the playlists, the "Save to playlist" submenu offers the same ones, and every menu that
 * offers to save a release or follow an artist has to name the state it is about to leave. Held in
 * component state, each of those only ever knew about its own click: saving from a card told the
 * card and nothing else, and the menu went on offering to save what was already saved.
 *
 * Nothing here asks upstream whether a release is held. No shelf, search or page response states it,
 * and asking per entity would cost a request per row. What is known for free is what the library
 * pages already listed and what was saved this session, so a label is right about everything the
 * reader has seen and offers the save otherwise, which is where it started.
 */
const held = new Set<string>();
let playlists: Playlist[] = [];
let reading: Promise<void> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

/** Whatever a library page listed is held by definition, which is the only free read of it. */
export function markHeld(items: MusicEntity[]) {
	const before = held.size;
	for (const item of items) if (isAlbum(item) || isArtist(item) || isPlaylist(item)) held.add(item.id);
	if (held.size !== before) emit();
}

/**
 * Every playlist the account holds, read once per session and edited in place after that. Not the
 * library landing, which is recent activity and names only the few playlists it happens to surface.
 */
function readPlaylists() {
	reading ??= queryMusic({ type: "library", filter: "playlists" })
		.then((page) => {
			playlists = page.items.filter(isPlaylist);
			markHeld(playlists);
			emit();
		})
		.catch(() => {
			// An empty rail is what a failed read already looks like. Asked for again on the next mount.
			reading = undefined;
		});
}

/** The rail's list and the submenu's, which are the same list. */
export function usePlaylists(): Playlist[] {
	useEffect(readPlaylists, []);
	return useSyncExternalStore(subscribe, () => playlists);
}

/** Whether the library holds this release, playlist or artist, as far as anything here knows. */
export const isHeld = (id: string): boolean => held.has(id);
export const useHeld = (id: string): boolean => useSyncExternalStore(subscribe, () => isHeld(id));

/**
 * Optimistic and rolled back the way a rating is: the label is the only thing the reader can see, so
 * a silent failure would leave it lying about what the account holds. Answers whether it landed, for
 * a caller that has a page cache to invalidate.
 */
async function toggle(id: string, next: boolean, command: MusicCommand, failure: string): Promise<boolean> {
	if (next) held.add(id);
	else held.delete(id);
	emit();
	try {
		await window.neotune?.music.command(command);
		return true;
	} catch {
		if (next) held.delete(id);
		else held.add(id);
		emit();
		toast.add({ title: failure, description: "YouTube Music would not do that.", type: "error" });
		return false;
	}
}

export const saveToLibrary = (id: string, saved: boolean) =>
	toggle(id, saved, { type: "library-save", id, saved }, saved ? "Not saved" : "Not removed from library");

/** Following an artist is the same fact behind another endpoint, so it reads out of the same store. */
export const setSubscribed = (artistId: string, subscribed: boolean) =>
	toggle(artistId, subscribed, { type: "subscribe", artistId, subscribed }, "Subscription not updated");

export function addPlaylist(playlist: Playlist) {
	playlists = [playlist, ...playlists];
	held.add(playlist.id);
	emit();
}

/** An edit saved on the playlist page, so the rail stops naming it the way it was named before. */
export function updatePlaylist(id: string, patch: Partial<Playlist>) {
	playlists = playlists.map((playlist) => (playlist.id === id ? { ...playlist, ...patch } : playlist));
	emit();
}

export function removePlaylist(id: string) {
	playlists = playlists.filter((playlist) => playlist.id !== id);
	held.delete(id);
	emit();
}

/** Another account holds other things, so none of this survives a sign-in change. */
export function resetLibrary() {
	held.clear();
	playlists = [];
	reading = undefined;
	emit();
}
