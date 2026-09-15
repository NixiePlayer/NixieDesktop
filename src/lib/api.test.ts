import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MusicEntity, Page } from "#/shared/contracts";

/**
 * The hold is module state, so every test imports a fresh copy of it. `queryMusic` reads the bridge
 * off `window`, which a renderer always has and this environment does not.
 */
async function freshApi(query: (request: unknown) => Promise<Page<MusicEntity>>) {
	vi.resetModules();
	Object.assign(globalThis, {
		window: { nixie: { auth: { state: async () => ({ status: "authenticated" }) }, music: { query } } },
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

	it("holds an artist page for five minutes, then asks again", async () => {
		vi.useFakeTimers();
		try {
			const { queryMusic } = await freshApi(query);
			const searched = await queryMusic({ type: "artist", id: "UC1" });
			expect(await queryMusic({ type: "artist", id: "UC1" })).toBe(searched);
			expect(query).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(5 * 60_000);
			await queryMusic({ type: "artist", id: "UC1" });
			expect(query).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("drops a failed artist page, and every held artist on a session change", async () => {
		const failing = vi.fn(async () => {
			if (failing.mock.calls.length === 1) throw new Error("upstream");
			return { items: [] };
		});
		const { queryMusic, dropHeldPages } = await freshApi(failing);
		await expect(queryMusic({ type: "artist", id: "UC1" })).rejects.toThrow("upstream");
		await queryMusic({ type: "artist", id: "UC1" });
		await queryMusic({ type: "artist", id: "UC1" });
		expect(failing).toHaveBeenCalledTimes(2);
		dropHeldPages();
		await queryMusic({ type: "artist", id: "UC1" });
		expect(failing).toHaveBeenCalledTimes(3);
	});

	it("caps held artists at eight, oldest out", async () => {
		const { queryMusic } = await freshApi(query);
		for (let index = 0; index < 9; index++) await queryMusic({ type: "artist", id: `UC${index}` });
		await queryMusic({ type: "artist", id: "UC8" });
		expect(query).toHaveBeenCalledTimes(9);
		await queryMusic({ type: "artist", id: "UC0" });
		expect(query).toHaveBeenCalledTimes(10);
	});

	it("holds the region list, but not an empty answer", async () => {
		let regions: { label: string }[] = [];
		const charts = vi.fn(async () => ({ items: [], explore: { regions } }) as unknown as Page<MusicEntity>);
		const { queryRegions } = await freshApi(charts);
		await queryRegions();
		regions = [{ label: "Italy" }];
		await queryRegions();
		await queryRegions();
		expect(charts).toHaveBeenCalledTimes(2);
	});
});
