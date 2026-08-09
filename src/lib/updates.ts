import { useEffect, useSyncExternalStore } from "react";
import { toast } from "#/components/ui/toast";
import type { UpdateState } from "#/shared/contracts";

/**
 * The updater's state as the renderer sees it, held here rather than in the one row that used to
 * read it: the rail badges the Settings entry, the toast announces a build that is already
 * downloaded, and the About row still describes the whole lifecycle. Three readers of one fact, so
 * it is a store for the same reason the library and the ratings are.
 *
 * Main owns the state itself and pushes every change, which is why this reads it once before
 * following the pushes: the startup check has usually settled long before the shell mounts.
 */
let state: UpdateState = { status: "unsupported" };
let started = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function set(next: UpdateState) {
	// Only the arrival is announced. The pushes keep coming while the toast is on screen (a download
	// ticks its percent), and re-announcing on every one of them would replace it under the pointer.
	const arrived = next.status === "ready" && state.status !== "ready";
	state = next;
	emit();
	if (arrived) announce(next.version);
}

/**
 * The prompt, and the only one: the download has already happened by the time this is shown, so the
 * question is a restart and nothing else. Dismissing it is the "later", and costs nothing, since
 * electron-updater installs a downloaded build on the next quit anyway. It does not expire, because
 * a listener who left the room to a full album should not come back to a decision that timed out.
 */
function announce(version: string | undefined) {
	toast.add({
		title: version ? `Neotune ${version} is ready` : "An update is ready",
		description: "Restart to install it, or keep listening and it installs when you next quit.",
		type: "success",
		timeout: 0,
		actionProps: {
			children: "Restart now",
			onClick: () => void window.neotune?.update.install(),
		},
	});
}

/**
 * Optimistic for the same reason a rating is: main owns the state, but the round trip out to it and
 * back is long enough to press the button a second time in, and it is drawn enabled for all of it.
 * So the state it is about to be put in is written here first, which disables the button on the
 * press rather than on the answer. Main answers every check, including the development build's,
 * which has nothing to ask and says so: nothing else would take the row back off "checking".
 */
export function checkForUpdates() {
	set({ status: "checking" });
	holdUntil = Date.now() + MIN_CHECK_MS;
	void window.neotune?.update.check();
}

/**
 * How long "Checking" is worth showing for. An answer can come back faster than it can be read, and
 * a button that changes and changes back inside a frame or two reads as a glitch rather than as a
 * check that found nothing, which is the one answer that has nothing else to show for itself.
 */
const MIN_CHECK_MS = 500;

let holdUntil = 0;

/**
 * The pushes, held to that floor. Only the answer is held and only once: "checking" is the state the
 * press already wrote, and everything after the answer (a download's percent, the arrival) is its
 * own event at its own pace and must not be queued behind anything.
 */
function receive(next: UpdateState) {
	const wait = next.status === "checking" ? 0 : holdUntil - Date.now();
	if (wait <= 0) return set(next);
	holdUntil = 0;
	setTimeout(() => set(next), wait);
}

/** Wired once for the app's lifetime, so nothing here is torn down with the component that asked. */
function start() {
	if (started) return;
	started = true;
	const bridge = window.neotune;
	if (!bridge) return;
	// Only if nothing has arrived in the meantime. This starts with the shell, which is while the
	// startup check is still in flight, so a push landing between the ask and the answer is a real
	// beat rather than a theoretical one, and answering it with the older state would pin the row
	// there until the next check, six hours later.
	void bridge.update
		.state()
		.then((initial) => {
			if (state.status === "unsupported") set(initial);
		})
		.catch(() => undefined);
	bridge.update.onState(receive);
}

export function useUpdateState(): UpdateState {
	useEffect(start, []);
	return useSyncExternalStore(subscribe, () => state);
}
