import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

const START_PX = 24;
const COMPLETE_PX = 150;
const FLING_PX_PER_S = 1100;
const DIRECTION_RATIO = 2.5;
// Move the arrow's centre from 20px outside the edge to 24px inside it.
const REST_PX = 44;
const FLING_END_MS = 100;

interface SwipeGesture {
	readonly dx: number;
	readonly dy: number;
	/** Smoothed signed horizontal velocity, in pixels per second. */
	readonly velocity: number;
	readonly at: number;
}

export const NO_SWIPE: SwipeGesture = { dx: 0, dy: 0, velocity: 0, at: Number.NEGATIVE_INFINITY };

export interface SwipeHint {
	readonly direction: -1 | 1;
	/** 1 is the navigation threshold; the affordance rests before it. */
	readonly progress: number;
	readonly armed: boolean;
	readonly phase: "tracking" | "aborting" | "completing";
}

function sideways({ dx, dy }: SwipeGesture): boolean {
	return Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO;
}

export function swipeDirection(gesture: SwipeGesture): -1 | 1 | undefined {
	if (!sideways(gesture) || gesture.dx === 0) return undefined;
	return gesture.dx < 0 ? -1 : 1;
}

export function feedSwipe(gesture: SwipeGesture, delta: { deltaX: number; deltaY: number; at: number }): SwipeGesture {
	const { deltaX, deltaY, at } = delta;
	const continuing = Number.isFinite(gesture.at);
	const dt = Math.min(50, Math.max(1, continuing ? at - gesture.at : 16));
	const instant = (deltaX / dt) * 1000;
	const dx = (continuing ? gesture.dx : 0) + deltaX;
	return {
		dx,
		dy: (continuing ? gesture.dy : 0) + deltaY,
		velocity: continuing && gesture.velocity !== 0 ? gesture.velocity * 0.6 + instant * 0.4 : instant,
		at,
	};
}

// A retracted back gesture must not turn into forward navigation.
export function endSwipe(gesture: SwipeGesture, endedAt = gesture.at, direction?: -1 | 1): -1 | 1 | undefined {
	const axis = direction ?? swipeDirection(gesture);
	if (!axis) return undefined;
	const travel = gesture.dx * axis;
	if (travel <= START_PX) return undefined;
	const far = travel >= COMPLETE_PX;
	const flung =
		endedAt - gesture.at <= FLING_END_MS &&
		Math.abs(gesture.velocity) >= FLING_PX_PER_S &&
		Math.sign(gesture.velocity) === axis;
	if (!far && !flung) return undefined;
	return axis;
}

export function swipeProgress(gesture: SwipeGesture, direction: -1 | 1): SwipeHint {
	const travel = Math.max(0, gesture.dx * direction - START_PX);
	return {
		direction,
		progress: travel / (COMPLETE_PX - START_PX),
		armed: travel >= COMPLETE_PX - START_PX,
		phase: "tracking",
	};
}

export function swipeOffset(progress: number): number {
	const clamped = Math.min(1, Math.max(0, progress));
	return (1 - (1 - clamped) * (1 - clamped)) * REST_PX;
}

export function swipeAbortDuration(progress: number): number {
	return (swipeOffset(progress) / REST_PX) * 300;
}

interface HistoryPosition {
	readonly back: boolean;
	readonly forward: boolean;
	readonly maxIndex: number;
}

export function historyPosition(index: number, maxIndex: number, pushed = false): HistoryPosition {
	const maximum = pushed ? index : Math.max(index, maxIndex);
	return { back: index !== 0, forward: index < maximum, maxIndex: maximum };
}

interface HistoryEdges extends HistoryPosition {
	/** Preload the adjacent history entry before finger release. */
	preload(direction: -1 | 1): void;
}

type AppRouter = ReturnType<typeof useRouter>;
type HistoryEntry = ReturnType<AppRouter["parseLocation"]>;

export function useHistoryEdges(): HistoryEdges {
	const router = useRouter();
	const entries = useRef(new Map<number, HistoryEntry>());
	const [position, setPosition] = useState(() => {
		const index = router.history.location.state["__TSR_index"];
		return historyPosition(index, index);
	});

	useEffect(() => {
		// The browser exposes only the current entry, so remember visited destinations.
		const remember = () => {
			const entry = router.history.location;
			entries.current.set(entry.state["__TSR_index"], router.parseLocation(entry));
		};
		remember();
		return router.history.subscribe(({ action }) => {
			remember();
			const index = router.history.location.state["__TSR_index"];
			setPosition((current) => historyPosition(index, current.maxIndex, action.type === "PUSH"));
		});
	}, [router]);

	return {
		...position,
		preload: (direction) => {
			const index = router.history.location.state["__TSR_index"];
			const entry = entries.current.get(index + direction);
			if (!entry) return;
			const leaf = router.matchRoutes(entry.pathname, entry.search).at(-1);
			if (!leaf) return;
			void router.preloadRoute({ to: leaf.fullPath, params: leaf.params, search: entry.search });
		},
	};
}

// Hidden overflow is not user-scrollable and must not block navigation.
function inHorizontalScroller(target: EventTarget | null): boolean {
	let node = target instanceof Element ? target : null;
	while (node && node !== document.body) {
		const overflowX = getComputedStyle(node).overflowX;
		if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth) return true;
		node = node.parentElement;
	}
	return false;
}

export function createSwipeController({
	allowed,
	preload,
	navigate,
	show,
}: {
	allowed(direction: -1 | 1): boolean;
	preload(direction: -1 | 1): void;
	navigate(direction: -1 | 1): void;
	show(hint: SwipeHint | undefined): void;
}) {
	let gesture = NO_SWIPE;
	let tracking = false;
	let locked: -1 | 1 | undefined;
	let blocked = false;
	let claimed = false;
	let shown: SwipeHint | undefined;
	let clearTimer: ReturnType<typeof setTimeout> | undefined;
	const display = (hint: SwipeHint | undefined) => {
		shown = hint;
		show(hint);
	};
	const abort = () => {
		if (!shown) return;
		display({ ...shown, phase: "aborting" });
		clearTimeout(clearTimer);
		clearTimer = setTimeout(() => display(undefined), swipeAbortDuration(shown.progress));
	};

	return {
		begin() {
			clearTimeout(clearTimer);
			gesture = NO_SWIPE;
			tracking = true;
			locked = undefined;
			blocked = false;
			claimed = false;
			display(undefined);
		},
		update(delta: { deltaX: number; deltaY: number; at: number }, inScroller: boolean) {
			if (!tracking || blocked || (delta.deltaX === 0 && delta.deltaY === 0)) return;
			gesture = feedSwipe(gesture, delta);
			if (!locked) {
				// A carousel or vertical scroll owns the entire contact, even at its edge.
				blocked = inScroller || (Math.abs(gesture.dy) >= START_PX && !sideways(gesture));
				const direction = swipeDirection(gesture);
				if (!blocked && direction && Math.abs(gesture.dx) >= START_PX) {
					blocked = !allowed(direction);
					if (!blocked) {
						locked = direction;
						claimed = true;
						preload(direction);
					}
				}
			}
			if (locked && Math.abs(gesture.dy) > Math.abs(gesture.dx)) {
				locked = undefined;
				blocked = true;
				abort();
			}
			if (locked) display(swipeProgress(gesture, locked));
		},
		end(at: number) {
			if (!tracking) return;
			tracking = false;
			const direction = !blocked && locked ? endSwipe(gesture, at, locked) : undefined;
			if (direction && allowed(direction)) {
				display({ direction, progress: 1, armed: true, phase: "completing" });
				clearTimer = setTimeout(() => display(undefined), 200);
				navigate(direction);
			} else abort();
		},
		cancel() {
			claimed = false;
			if (tracking) abort();
			tracking = false;
		},
		claimed: () => claimed,
		dispose() {
			clearTimeout(clearTimer);
		},
	};
}

export function useSwipeNavigation(): SwipeHint | undefined {
	const router = useRouter();
	const edges = useHistoryEdges();
	const edgesRef = useRef(edges);
	const [hint, setHint] = useState<SwipeHint>();
	edgesRef.current = edges;

	useEffect(() => {
		const nativeSamples = window.nixie?.app.platform === "darwin";
		const swipe = createSwipeController({
			allowed: (direction) => (direction === -1 ? edgesRef.current.back : edgesRef.current.forward),
			preload: (direction) => edgesRef.current.preload(direction),
			navigate: (direction) => (direction === -1 ? router.history.back() : router.history.forward()),
			show: setHint,
		});
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
			if (!nativeSamples)
				swipe.update(
					{ deltaX: event.deltaX, deltaY: event.deltaY, at: event.timeStamp },
					inHorizontalScroller(event.target)
				);
			// Suppress momentum on the destination page until the next contact boundary.
			if (swipe.claimed()) event.preventDefault();
		};
		window.addEventListener("wheel", onWheel, { passive: false });
		const offGesture = window.nixie?.app.onScrollGesture(({ phase, sample }) => {
			if (phase === "cancel") {
				swipe.cancel();
				return;
			}
			if (phase === "begin") swipe.begin();
			if (sample) swipe.update(sample, inHorizontalScroller(document.elementFromPoint(sample.x, sample.y)));
			if (phase === "end") swipe.end(sample?.at ?? performance.now());
		});
		return () => {
			swipe.dispose();
			window.removeEventListener("wheel", onWheel);
			offGesture?.();
		};
	}, [router]);

	return hint;
}
