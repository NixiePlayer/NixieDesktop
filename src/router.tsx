import { createHashHistory, createRouter } from "@tanstack/react-router";
import { Skeleton } from "./components/ui/skeleton";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({
	routeTree,
	history: createHashHistory(),
	scrollRestoration: true,
	scrollToTopSelectors: ["#main-scrollable-area"],
	defaultPreload: "intent",
	// Infinity, not the 30s default: a preload is for a page the cache does not hold, and one that
	// refetches an entry the reader already has lands its answer a beat after they clicked the link,
	// which is the swap below happening on the page they just opened.
	defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
	// A route component is not remounted when only its params change, so every page holding state of
	// its own (the playlist's rows and title, the artist's expanded songs) went on showing the entity
	// it was first mounted for while the loader quietly fetched the next one. Keying on the params
	// fixes it for all of them at once. A route without params keys on `{}` and never remounts.
	defaultRemountDeps: ({ params }) => params,
	// ponytail: one shelf-shaped skeleton for every route. pendingMs 0 is what makes navigation
	// feel instant: the default waits a full second on the old page before admitting it is loading.
	// pendingMinMs 0 because a cache hit should not be held back to fill a minimum skeleton time.
	defaultPendingMs: 0,
	defaultPendingMinMs: 0,
	defaultPendingComponent: () => (
		<div className="flex flex-col gap-6">
			<Skeleton className="h-8 w-40" />
			<div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
				{Array.from({ length: 8 }, (_, index) => (
					<Skeleton key={index} className="aspect-square" />
				))}
			</div>
		</div>
	),
	// Cached data is never revalidated in place. The router's stale-while-revalidate default paints
	// the feed the reader left, reloads it underneath, and swaps the fresh one in: a card moves out
	// from under the pointer between aiming and pressing, and the press opens something else. So a
	// page is either held, and rendered exactly as it was left, or gone, and rendered as a skeleton
	// until the fresh answer lands. Nothing in between, and nothing changes under a reader's hands.
	//
	// gcTime is what invalidates it, and with no revalidation it is the only clock: an entry unused
	// for half an hour is dropped, and the next visit is a load from nothing. `router.invalidate()`
	// drops it all on an auth change or a mutation that outdated it.
	defaultStaleTime: Number.POSITIVE_INFINITY,
	defaultGcTime: 30 * 60_000,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
