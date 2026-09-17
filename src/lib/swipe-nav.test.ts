import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createSwipeController,
	endSwipe,
	feedSwipe,
	historyPosition,
	NO_SWIPE,
	swipeAbortDuration,
	swipeDirection,
	swipeOffset,
	swipeProgress,
} from "./swipe-nav";

function swipe(deltas: Array<[number, number]>, stepMs = 16) {
	let gesture = NO_SWIPE;
	let at = 1000;
	for (const [deltaX, deltaY] of deltas) {
		at += stepMs;
		gesture = feedSwipe(gesture, { deltaX, deltaY, at });
	}
	return gesture;
}

const times = (count: number, delta: [number, number]): Array<[number, number]> =>
	Array.from({ length: count }, () => delta);

describe("endSwipe", () => {
	it("commits at the fixed 150 pixel threshold", () => {
		expect(endSwipe(swipe(times(30, [-5, 0.1]), 50))).toBe(-1);
		expect(endSwipe(swipe(times(29, [-5, 0.1]), 50))).toBeUndefined();
	});

	it("commits a short 1100 pixel per second flick", () => {
		const flick = swipe(times(4, [-20, 0.1]));
		expect(endSwipe(flick)).toBe(-1);
		expect(endSwipe(flick, flick.at + 101)).toBeUndefined();
		expect(endSwipe(swipe(times(4, [20, 0.1])))).toBe(1);
	});

	it("obeys a locked direction over the accumulated sign", () => {
		const reverse = swipe(times(30, [5, 0.1]));
		expect(endSwipe(reverse, undefined, -1)).toBeUndefined();
		expect(endSwipe(reverse, undefined, 1)).toBe(1);
	});

	it("ignores gestures under the 24 pixel start threshold and vertical scrolling", () => {
		expect(endSwipe(swipe([[-24, 0]]))).toBeUndefined();
		expect(endSwipe(swipe(times(30, [-2, 40])))).toBeUndefined();
	});
});

describe("swipeProgress", () => {
	it("appears after 24 pixels and arms at 150 when the affordance rests", () => {
		expect(swipeProgress(swipe([[-24, 0]]), -1)).toEqual({
			direction: -1,
			progress: 0,
			armed: false,
			phase: "tracking",
		});
		expect(swipeProgress(swipe([[-150, 0]]), -1)).toEqual({
			direction: -1,
			progress: 1,
			armed: true,
			phase: "tracking",
		});
	});

	it("stays mounted without progress when a locked gesture pulls past its origin", () => {
		expect(swipeProgress(swipe([[80, 0]]), -1)).toEqual({
			direction: -1,
			progress: 0,
			armed: false,
			phase: "tracking",
		});
	});
});

describe("swipeOffset", () => {
	it("eases out and stops at the 44 pixel resting spot", () => {
		expect(swipeOffset(0)).toBe(0);
		expect(swipeOffset(0.5)).toBe(33);
		expect(swipeOffset(1)).toBe(44);
		expect(swipeOffset(2)).toBe(44);
		expect(swipeAbortDuration(1)).toBe(300);
	});
});

describe("navigation direction", () => {
	it("recognizes a horizontal gesture before the activation threshold", () => {
		expect(swipeDirection(swipe([[-20, 1]]))).toBe(-1);
		expect(swipeDirection(swipe([[20, 1]]))).toBe(1);
		expect(swipeDirection(swipe([[20, 20]]))).toBeUndefined();
	});

	it("keeps forward history until a new push replaces it", () => {
		const afterBack = historyPosition(2, 5);
		expect(afterBack).toEqual({ back: true, forward: true, maxIndex: 5 });
		expect(historyPosition(3, afterBack.maxIndex, true)).toEqual({ back: true, forward: false, maxIndex: 3 });
	});
});

describe("contact-driven navigation", () => {
	afterEach(() => vi.useRealTimers());

	function controller() {
		vi.useFakeTimers();
		const navigate = vi.fn();
		const preload = vi.fn();
		const show = vi.fn();
		const swipe = createSwipeController({ allowed: () => true, navigate, preload, show });
		let at = 1000;
		return {
			swipe,
			navigate,
			preload,
			show,
			move(deltaX: number, deltaY = 0, inScroller = false) {
				at += 16;
				swipe.update({ deltaX, deltaY, at }, inScroller);
			},
			lift() {
				swipe.end(at);
			},
		};
	}

	it.each([-1, 1] as const)("navigates immediately on a fast %i release, before animation or momentum", (direction) => {
		const { swipe, move, lift, navigate, preload, show } = controller();
		swipe.begin();
		for (let n = 0; n < 4; n++) move(direction * 20);
		expect(navigate).not.toHaveBeenCalled();
		expect(preload).toHaveBeenCalledExactlyOnceWith(direction);
		lift();
		expect(navigate).toHaveBeenCalledExactlyOnceWith(direction);
		for (let n = 0; n < 100; n++) move(direction * 20);
		lift();
		vi.advanceTimersByTime(1000);
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(show).toHaveBeenLastCalledWith(undefined);
		expect(swipe.claimed()).toBe(true);
		swipe.dispose();
	});

	it("does not confuse deceleration or a long stationary hold with finger release", () => {
		const { swipe, move, lift, navigate, show } = controller();
		swipe.begin();
		for (let n = 0; n < 5; n++) move(-40);
		for (let n = 0; n < 30; n++) move(-1);
		vi.advanceTimersByTime(60_000);
		expect(navigate).not.toHaveBeenCalled();
		expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ armed: true, phase: "tracking" }));
		lift();
		expect(navigate).toHaveBeenCalledExactlyOnceWith(-1);
		swipe.dispose();
	});

	it("can retract an armed gesture before release", () => {
		const { swipe, move, lift, navigate } = controller();
		swipe.begin();
		move(-180);
		move(170);
		lift();
		expect(navigate).not.toHaveBeenCalled();
		swipe.dispose();
	});

	it("cancels without navigation and accepts a new contact without a cooldown", () => {
		const { swipe, move, lift, navigate } = controller();
		swipe.begin();
		move(-180);
		swipe.cancel();
		lift();
		expect(navigate).not.toHaveBeenCalled();
		swipe.begin();
		move(180);
		lift();
		swipe.begin();
		move(-180);
		lift();
		expect(navigate.mock.calls).toEqual([[1], [-1]]);
		swipe.dispose();
	});

	it("does not claim a carousel or a vertical scroll later in the same contact", () => {
		const { swipe, move, lift, navigate, preload } = controller();
		swipe.begin();
		move(-4, 0, true);
		move(-180);
		lift();
		swipe.begin();
		move(0, 30);
		move(-180);
		lift();
		expect(navigate).not.toHaveBeenCalled();
		expect(preload).not.toHaveBeenCalled();
		expect(swipe.claimed()).toBe(false);
		swipe.dispose();
	});
});
