import { beforeEach, expect, test, vi } from "vitest";
import type { UpdateState } from "#/shared/contracts";

const toast = vi.hoisted(() => ({ add: vi.fn((_options: object) => `toast-${Math.random()}`), close: vi.fn() }));
vi.mock("#/components/ui/toast", () => ({ toast }));
vi.mock("#/lib/i18n", () => ({
	messages: () => ({
		settings: { update: { ready: { label: (v: string) => v }, toast: {}, restartNow: "Restart now" } },
	}),
}));
// The hook is only the entry point here: run its effect at once and read the store directly.
vi.mock("react", () => ({
	useEffect: (effect: () => void) => effect(),
	useSyncExternalStore: (_subscribe: unknown, snapshot: () => UpdateState) => snapshot(),
}));

let push: (state: UpdateState) => void = () => undefined;
vi.stubGlobal("window", {
	nixie: {
		update: {
			state: () => new Promise(() => undefined),
			onState: (listener: typeof push) => (push = listener),
			check: () => Promise.resolve(),
		},
	},
});

const { useUpdateState } = await import("#/lib/updates");
useUpdateState();

beforeEach(() => vi.clearAllMocks());

test("announces a downloaded build once across later checks", () => {
	push({ status: "ready", version: "0.5.1" });
	for (let check = 0; check < 2; check++) {
		push({ status: "checking" });
		push({ status: "available", version: "0.5.1" });
		push({ status: "downloading", version: "0.5.1", percent: 100 });
		push({ status: "ready", version: "0.5.1" });
	}
	expect(toast.add).toHaveBeenCalledOnce();
	expect(useUpdateState()).toEqual({ status: "ready", version: "0.5.1" });
});

test("replaces the toast when a newer build is downloaded", () => {
	push({ status: "checking" });
	push({ status: "ready", version: "0.5.2" });
	expect(toast.close).toHaveBeenCalledOnce();
	expect(toast.add).toHaveBeenCalledOnce();
	expect(toast.add.mock.calls[0]?.[0]).toMatchObject({ title: "0.5.2" });
});
