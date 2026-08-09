import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MusicEntity, Page } from "#/shared/contracts";

/**
 * The hold is module state, so every test imports a fresh copy of it. `queryMusic` reads the bridge
 * off `window`, which a renderer always has and this environment does not.
 */
async function freshApi(query: (request: unknown) => Promise<Page<MusicEntity>>) {
	vi.resetModules();
	Object.assign(globalThis, {
		window: { neotune: { auth: { state: async () => ({ status: "authenticated" }) }, music: { query } } },
	});
	return import("#/lib/api");
}

describe("queryMusic", () => {
	let draws = 0;
	let query: Mock<(request: unknown) => Promise<Page<MusicEntity>>>;

	beforeEach(() => {
		draws = 0;
		// A mix answers a different hundred songs every time it is asked, which is the whole problem.
		query = vi.fn(async () => ({ items: [], continuation: `page-${++draws}` }));
	});

	it("draws an auto-generated mix once and answers every later reader with it", async () => {
		const { queryMusic } = await freshApi(query);
		const played = await queryMusic({ type: "playlist", id: "VLRDATfhcG9wIHB1bms" });
		const opened = await queryMusic({ type: "playlist", id: "VLRDATfhcG9wIHB1bms" });
		expect(opened).toBe(played);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("draws a mix again for a walk through the whole list, whose token the held page already spends", async () => {
		const { queryMusic } = await freshApi(query);
		await queryMusic({ type: "playlist", id: "RDATfhcG9wIHB1bms" });
		const walked = await queryMusic({ type: "playlist", id: "RDATfhcG9wIHB1bms" }, true);
		expect(walked.continuation).toBe("page-2");
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("holds nothing else: an ordinary playlist is stable, and an edited one has to be read again", async () => {
		const { queryMusic } = await freshApi(query);
		await queryMusic({ type: "playlist", id: "PLsomething" });
		await queryMusic({ type: "playlist", id: "PLsomething" });
		await queryMusic({ type: "album", id: "MPREb_1" });
		expect(query).toHaveBeenCalledTimes(3);
	});

	it("drops a failed draw rather than replaying it at every later reader", async () => {
		const failing = vi.fn(async () => {
			if (failing.mock.calls.length === 1) throw new Error("upstream");
			return { items: [] };
		});
		const { queryMusic } = await freshApi(failing);
		await expect(queryMusic({ type: "playlist", id: "RDx" })).rejects.toThrow("upstream");
		await expect(queryMusic({ type: "playlist", id: "RDx" })).resolves.toEqual({ items: [] });
	});
});
