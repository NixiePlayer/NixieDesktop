/**
 * What a link pasted into the search field points at. Only the two hosts YouTube Music's own share
 * sheet hands out are read: `music.youtube.com` for every kind, and `youtu.be` for a song shared from
 * the mobile apps. Anything else that looks like a link is `unsupported`, never searched for, so an
 * arbitrary URL is not sent upstream as a query.
 *
 * A link is read for its id and nothing else: the URL is never fetched or opened, and every id is
 * held to the shape upstream uses for it, so what reaches a route or a query is a plain id.
 */
export type MusicLink = { type: "album" | "artist" | "playlist" | "song"; id: string } | { type: "unsupported" };

const videoId = /^[\w-]{11}$/;
const listId = /^[\w-]{2,128}$/;
const channelId = /^UC[\w-]{22}$/;

/** `undefined` for text that is not a link at all, which the field searches for as before. */
export function musicLink(text: string): MusicLink | undefined {
	const value = text.trim();
	// A link copied from the address bar keeps its scheme, one typed by hand often does not.
	const bare = /^(?:music\.youtube\.com|youtu\.be)\//i.test(value);
	if (!bare && !/^https?:\/\//i.test(value)) return undefined;
	const unsupported = { type: "unsupported" } as const;
	let url: URL;
	try {
		url = new URL(bare ? `https://${value}` : value);
	} catch {
		return unsupported;
	}
	// `hostname` is what the URL parser resolved, so `music.youtube.com@elsewhere` and
	// `music.youtube.com.elsewhere` land here as the host they really are.
	if (url.username || url.password || url.port) return unsupported;
	const path = url.pathname.split("/").filter(Boolean);
	if (url.hostname === "youtu.be") {
		const [id = ""] = path;
		return path.length === 1 && videoId.test(id) ? { type: "song", id } : unsupported;
	}
	if (url.hostname !== "music.youtube.com") return unsupported;
	const [page, id = ""] = path;
	if (path.length === 1 && page === "watch") {
		const v = url.searchParams.get("v") ?? "";
		return videoId.test(v) ? { type: "song", id: v } : unsupported;
	}
	if (path.length === 1 && page === "playlist") {
		const list = url.searchParams.get("list") ?? "";
		return listId.test(list) ? { type: "playlist", id: `VL${list}` } : unsupported;
	}
	if (path.length === 2 && page === "channel" && channelId.test(id)) return { type: "artist", id };
	if (path.length === 2 && page === "browse" && listId.test(id)) {
		if (id.startsWith("MPREb_")) return { type: "album", id };
		if (id.startsWith("VL") || id.startsWith("MPSP")) return { type: "playlist", id };
		if (channelId.test(id)) return { type: "artist", id };
	}
	return unsupported;
}
