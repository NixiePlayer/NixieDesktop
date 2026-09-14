import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: mocks.fork } }));

import { evaluateRestricted } from "./decipher";

describe("evaluateRestricted", () => {
	it("kills its utility process when evaluation rejects", async () => {
		const child = Object.assign(new EventEmitter(), {
			kill: vi.fn(),
			postMessage: vi.fn((message: { id: string }) => {
				queueMicrotask(() => child.emit("message", { id: message.id, error: "refused" }));
			}),
		});
		mocks.fork.mockReturnValue(child);
		const result = evaluateRestricted({ output: "1" }, {});
		child.emit("spawn");
		await expect(result).rejects.toThrow("refused");
		expect(child.kill).toHaveBeenCalledOnce();
	});
});
