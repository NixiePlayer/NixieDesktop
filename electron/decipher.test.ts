import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: mocks.fork } }));

import { evaluateRestricted } from "./decipher";

/** A worker that answers every job with `answer`, or never when `answer` is undefined. */
function fakeWorker(answer?: (id: string) => object) {
	const child = Object.assign(new EventEmitter(), {
		kill: vi.fn(() => queueMicrotask(() => child.emit("exit", 0))),
		postMessage: vi.fn((message: { id: string }) => {
			if (answer) queueMicrotask(() => child.emit("message", answer(message.id)));
		}),
	});
	return child;
}

describe("evaluateRestricted", () => {
	afterEach(async () => {
		// Retire whatever process a test left running, so the next one forks its own.
		vi.useRealTimers();
		for (const { value } of mocks.fork.mock.results) value.kill();
		await new Promise((done) => setTimeout(done, 0));
		mocks.fork.mockReset();
	});

	it("waits for the worker to boot and reuses it for every evaluation", async () => {
		const child = fakeWorker((id) => ({ id, result: { value: id.length } }));
		mocks.fork.mockReturnValue(child);
		const first = evaluateRestricted({ output: "1" }, {});
		await Promise.resolve();
		// Spawned but not booted: nothing is posted to a worker that cannot answer yet.
		child.emit("spawn");
		expect(child.postMessage).not.toHaveBeenCalled();
		child.emit("message", { ready: true });
		await expect(first).resolves.toEqual({ value: 36 });
		await expect(evaluateRestricted({ output: "2" }, {})).resolves.toEqual({ value: 36 });
		expect(mocks.fork).toHaveBeenCalledOnce();
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("keeps the worker after an evaluation rejects", async () => {
		const child = fakeWorker((id) => ({ id, error: "refused" }));
		mocks.fork.mockReturnValue(child);
		const result = evaluateRestricted({ output: "1" }, {});
		child.emit("message", { ready: true });
		await expect(result).rejects.toThrow("refused");
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("retires a worker that misses its deadline and starts another", async () => {
		vi.useFakeTimers();
		const stuck = fakeWorker();
		const fresh = fakeWorker((id) => ({ id, result: "ok" }));
		mocks.fork.mockReturnValueOnce(stuck).mockReturnValueOnce(fresh);
		const result = evaluateRestricted({ output: "1" }, {});
		const rejected = expect(result).rejects.toThrow("Restricted evaluator timed out");
		stuck.emit("message", { ready: true });
		await vi.advanceTimersByTimeAsync(1500);
		await rejected;
		expect(stuck.kill).toHaveBeenCalledOnce();

		const next = evaluateRestricted({ output: "2" }, {});
		fresh.emit("message", { ready: true });
		await expect(next).resolves.toBe("ok");
		expect(mocks.fork).toHaveBeenCalledTimes(2);
	});

	it("settles a pending evaluation when the worker exits", async () => {
		const child = fakeWorker();
		mocks.fork.mockReturnValue(child);
		const result = evaluateRestricted({ output: "1" }, {});
		child.emit("message", { ready: true });
		await Promise.resolve();
		child.emit("exit", 1);
		await expect(result).rejects.toThrow("Restricted evaluator exited without answering");
	});

	it("does not charge a slow boot to the evaluation", async () => {
		vi.useFakeTimers();
		// The process exists at once and its runtime takes seconds to come up, as on a busy Windows machine.
		const child = fakeWorker();
		mocks.fork.mockReturnValue(child);
		const result = evaluateRestricted({ output: "1" }, {});
		child.emit("spawn");
		await vi.advanceTimersByTimeAsync(5000);
		child.emit("message", { ready: true });
		await vi.advanceTimersByTimeAsync(0);
		const [job] = child.postMessage.mock.calls.at(-1) ?? [];
		child.emit("message", { id: job?.id, result: "late but fine" });
		await expect(result).resolves.toBe("late but fine");
	});
});
