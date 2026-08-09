import { useEffect, useSyncExternalStore } from "react";
import { toast } from "#/components/ui/toast";
import type { TrackRating } from "#/shared/contracts";

/**
 * One store instead of per-component state, because the same rating has two writers: the player bar's
 * thumbs and every row menu's "Add to liked songs". Liking the playing track from a row has to light
 * the thumb in the bar, and neither owns the other.
 */
const ratings = new Map<string, TrackRating>();
/** Ids already asked about, so a track is read once per session however often it is displayed. */
const asked = new Set<string>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Writes the rating upstream, showing it immediately and putting it back if YouTube Music refuses.
 * Same shape as the playlist edits: the optimistic state is the only thing the user can see, so a
 * silent failure would leave the thumb lying about what the account holds.
 */
export async function rate(trackId: string, rating: TrackRating) {
	const previous = ratings.get(trackId);
	ratings.set(trackId, rating);
	asked.add(trackId);
	emit();
	try {
		await window.neotune?.music.command({ type: "rate", trackId, rating });
	} catch {
		if (previous) ratings.set(trackId, previous);
		else ratings.delete(trackId);
		emit();
		toast.add({ title: "Rating not saved", description: "YouTube Music rejected the change.", type: "error" });
	}
}

/** Clicking the thumb that is already lit clears the rating, the way the web player behaves. */
export const nextRating = (control: "like" | "dislike", current: TrackRating | undefined): TrackRating =>
	current === control ? "indifferent" : control;

/**
 * The rating for one track, read from upstream the first time it is displayed. Only a component that
 * shows the state should call this: the read costs a request, so putting it in a row menu would spend
 * one per row on every page. Upstream not stating a rating is not an error, it reads as neither thumb.
 */
export function useRating(trackId: string | undefined): TrackRating | undefined {
	const rating = useSyncExternalStore(subscribe, () => (trackId ? ratings.get(trackId) : undefined));

	useEffect(() => {
		if (!trackId || asked.has(trackId)) return;
		asked.add(trackId);
		void window.neotune?.music
			.rating(trackId)
			.then((value) => {
				if (!value) return;
				ratings.set(trackId, value);
				emit();
			})
			.catch(() => {
				// Main already swallows an upstream re-layout, so reaching here means the bridge itself is
				// gone. Nothing to say about it that the empty thumbs do not already say.
				asked.delete(trackId);
			});
	}, [trackId]);

	return rating;
}
