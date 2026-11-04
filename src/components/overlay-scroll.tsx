import { ScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode, Ref } from "react";
import { isMac } from "#/lib/platform";
import { cn } from "#/lib/utils";
import { ScrollBar } from "./ui/scroll-area";

/**
 * A vertical scroller whose bar floats over the content, takes no width and shows only while the user
 * scrolls, drags it or points at it, the way macOS draws every scrollbar and Spotify draws its own.
 *
 * macOS keeps its native overlay bar, so there this is two plain elements. Windows and Linux get Base
 * UI's scroll area: the element still scrolls natively (wheel, keys, touchpad, scroll restoration all
 * see an ordinary scroller), only the native bar is hidden and a drawn one sits over it. Chromium's own
 * `OverlayScrollbar` feature, asked for in `electron/main.ts`, cannot be relied on for this: on Windows
 * it follows the "Always show scrollbars" accessibility setting and falls back to the classic gutter.
 *
 * Base UI marks the bar `data-scrolling` only for user-driven scrolls, so the lyrics following the song
 * do not flash it. `className` sizes the outer box; `viewportClassName` styles the scrolling element,
 * which is also what `id` and `viewportRef` land on.
 */
export function OverlayScroll({
	id,
	className,
	viewportClassName,
	viewportRef,
	children,
}: {
	id?: string;
	className?: string;
	viewportClassName?: string;
	viewportRef?: Ref<HTMLDivElement>;
	children: ReactNode;
}) {
	if (isMac) {
		return (
			<div className={cn("relative", className)}>
				<div id={id} ref={viewportRef} className={cn("size-full overflow-y-auto", viewportClassName)}>
					{children}
				</div>
			</div>
		);
	}

	return (
		<ScrollArea.Root className={cn("relative", className)}>
			{/* Base UI also counts a pointer that merely moved over the viewport as the user scrolling, until
			    the next scroll comes to rest, so the first lyric line after the mouse crossed the panel, or
			    the router's scroll to top after a click, would flash the bar. Wheel, keys, touch and the
			    thumb drag stay user scrolls; middle-click autoscroll is the one gesture this stops showing. */}
			<ScrollArea.Viewport
				id={id}
				ref={viewportRef}
				className={cn("size-full outline-none", viewportClassName)}
				onPointerEnter={(event) => event.preventBaseUIHandler()}
				onPointerMove={(event) => event.preventBaseUIHandler()}
			>
				{children}
			</ScrollArea.Viewport>
			<ScrollBar className="**:data-[slot=scroll-area-thumb]:bg-foreground/25 hover:**:data-[slot=scroll-area-thumb]:bg-foreground/40 z-30 opacity-0 transition-opacity duration-500 hover:opacity-100 hover:duration-150 data-scrolling:opacity-100 data-scrolling:duration-150" />
		</ScrollArea.Root>
	);
}
