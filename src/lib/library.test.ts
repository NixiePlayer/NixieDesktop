import { describe, expect, it, vi } from "vitest";

/** The store is module state, so every test imports a fresh copy of it against its own bridge. */
async function freshLibrary(command: () => Promise<unknown>) {
	vi.resetModules();
	Object.assign(globalThis, { window: { noctune: { music: { command } } } });
	return import("#/lib/library");
}

describe("the library store", () => {
	it("holds what was saved, and puts it back when YouTube Music refuses", async () => {
		const refuse = vi.fn(async () => {
			throw new Error("upstream");
		});
		const { saveToLibrary, isHeld } = await freshLibrary(refuse);

		await expect(saveToLibrary("MPREb_1", true)).resolves.toBe(false);
		expect(isHeld("MPREb_1")).toBe(false);
	});

	it("keeps a save that landed, and lets the same id be taken out again", async () => {
		const { saveToLibrary, setSubscribed, isHeld } = await freshLibrary(async () => ({ ok: true }));

		await saveToLibrary("MPREb_1", true);
		expect(isHeld("MPREb_1")).toBe(true);
		await saveToLibrary("MPREb_1", false);
		expect(isHeld("MPREb_1")).toBe(false);

		// Following an artist is the same fact under another endpoint, and the same store answers for it.
		await setSubscribed("UC_1", true);
		expect(isHeld("UC_1")).toBe(true);
	});

	it("holds what a library page listed, without asking about it", async () => {
		const command = vi.fn(async () => ({ ok: true }));
		const { markHeld, isHeld } = await freshLibrary(command);

		markHeld([
			{ id: "VLPL1", title: "Mix" },
			{ id: "song", title: "Song", artists: [], durationSeconds: 1 },
		]);
		expect(isHeld("VLPL1")).toBe(true);
		// A song is liked rather than held, which the thumbs already answer for.
		expect(isHeld("song")).toBe(false);
		expect(command).not.toHaveBeenCalled();
	});
});
