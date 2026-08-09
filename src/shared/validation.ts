import type {
	AccountSettingKey,
	BrowserAccount,
	BundledDocument,
	DownloadRequest,
	MusicCommand,
	MusicQuery,
	PersistedState,
	PlaylistPrivacy,
	Track,
} from "./contracts";

const idPattern = /^[\w-]{1,256}$/;
const privacies: string[] = ["public", "unlisted", "private"] satisfies PlaylistPrivacy[];
const queryTypes = new Set([
	"home",
	"explore",
	"suggestions",
	"search",
	"library",
	"radio",
	"album",
	"artist",
	"playlist",
]);
/** Every query that names something upstream. The id is checked for all of them, not just the pages. */
const idQueryTypes = ["radio", "album", "artist", "playlist"];
const commandTypes = new Set([
	"rate",
	"subscribe",
	"library-save",
	"history",
	"playlist-create",
	"playlist-update",
	"playlist-add",
	"playlist-remove",
	"playlist-reorder",
	"playlist-delete",
	"account-setting",
]);
/** Only what Noctune draws a switch for. A key outside this set names an endpoint main never held. */
const accountSettingKeys: string[] = [
	"likedFromYouTube",
	"dynamicQueue",
	"pauseWatchHistory",
	"pauseSearchHistory",
] satisfies AccountSettingKey[];
/** ISO 3166 alpha-2, which is what upstream takes as `gl`. */
const regionPattern = /^[A-Z]{2}$/;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, optional = false): value is string | undefined {
	return (
		(optional && value === undefined) || (typeof value === "string" && value.length > 0 && value.length <= maximum)
	);
}

function validId(value: unknown, optional = false): value is string | undefined {
	return (optional && value === undefined) || (typeof value === "string" && idPattern.test(value));
}

function validPrivacy(value: unknown, optional = false): value is PlaylistPrivacy | undefined {
	return (optional && value === undefined) || (typeof value === "string" && privacies.includes(value));
}

function validIds(value: unknown) {
	return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((item) => validId(item));
}

function optionalString(value: unknown, maximum: number) {
	return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function hasControlCharacter(value: string) {
	return value.split("").some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || (code >= 127 && code <= 159);
	});
}

function validArtist(value: unknown) {
	return (
		record(value) &&
		typeof value.id === "string" &&
		value.id.length <= 256 &&
		boundedString(value.name, 300) &&
		optionalString(value.description, 10_000) &&
		optionalString(value.artworkUrl, 4096)
	);
}

function validAlbum(value: unknown) {
	return (
		record(value) &&
		validId(value.id) &&
		boundedString(value.title, 300) &&
		Array.isArray(value.artists) &&
		value.artists.length <= 50 &&
		value.artists.every(validArtist) &&
		optionalString(value.year, 20) &&
		optionalString(value.artworkUrl, 4096) &&
		(value.trackCount === undefined || (Number.isInteger(value.trackCount) && Number(value.trackCount) >= 0)) &&
		optionalString(value.kind, 100) &&
		(value.explicit === undefined || typeof value.explicit === "boolean")
	);
}

function validTrack(value: unknown): value is Track {
	return (
		record(value) &&
		validId(value.id) &&
		boundedString(value.title, 300) &&
		Array.isArray(value.artists) &&
		value.artists.length <= 50 &&
		value.artists.every(validArtist) &&
		(value.album === undefined || validAlbum(value.album)) &&
		validId(value.albumId, true) &&
		typeof value.durationSeconds === "number" &&
		Number.isFinite(value.durationSeconds) &&
		value.durationSeconds >= 0 &&
		value.durationSeconds <= 86_400 &&
		optionalString(value.artworkUrl, 4096) &&
		(value.explicit === undefined || typeof value.explicit === "boolean") &&
		optionalString(value.plays, 100)
	);
}

function validFingerprint(value: unknown) {
	return (
		record(value) &&
		Number.isInteger(value.itag) &&
		boundedString(value.mimeType, 200) &&
		boundedString(value.codec, 100) &&
		typeof value.bitrate === "number" &&
		Number.isFinite(value.bitrate) &&
		typeof value.durationMs === "number" &&
		Number.isFinite(value.durationMs)
	);
}

export function validateMusicQuery(value: unknown): asserts value is MusicQuery {
	if (!record(value) || !queryTypes.has(String(value.type))) throw new TypeError("Invalid music query");
	if ("continuation" in value && !boundedString(value.continuation, 2048, true))
		throw new TypeError("Invalid continuation");
	const filter = value.filter;
	if (value.type === "home") {
		// Home's filter is a chip token minted in main, the same base64url shape as a continuation,
		// not one of the library and search filter names below.
		if (!validId(filter, true)) throw new TypeError("Invalid filter");
	} else if (
		filter !== undefined &&
		(typeof filter !== "string" || !["songs", "albums", "artists", "playlists"].includes(filter))
	) {
		throw new TypeError("Invalid filter");
	}
	if (["suggestions", "search"].includes(String(value.type)) && !boundedString(value.query, 200)) {
		throw new TypeError("Invalid query");
	}
	if (idQueryTypes.includes(String(value.type)) && !validId(value.id)) {
		throw new TypeError("Invalid remote ID");
	}
	if (value.type === "radio") {
		// The queue upstream named in an artist header's own button. Its `params` is opaque, so it is
		// bounded and never read, exactly as a browse chip's is.
		if (!validId(value.playlistId, true)) throw new TypeError("Invalid remote ID");
		if (
			value.params !== undefined &&
			(!value.playlistId || !boundedString(value.params, 2048) || hasControlCharacter(value.params))
		) {
			throw new TypeError("Invalid watch parameters");
		}
	}
	if (value.type === "explore") {
		if (!validId(value.browseId, true)) throw new TypeError("Invalid remote ID");
		if (
			value.params !== undefined &&
			(!value.browseId || !boundedString(value.params, 2048) || hasControlCharacter(value.params))
		) {
			throw new TypeError("Invalid browse parameters");
		}
	}
}

export function validateMusicCommand(value: unknown): asserts value is MusicCommand {
	if (!record(value) || !commandTypes.has(String(value.type))) throw new TypeError("Invalid music command");
	switch (value.type) {
		case "rate":
			if (!validId(value.trackId) || !["like", "dislike", "indifferent"].includes(String(value.rating))) {
				throw new TypeError("Invalid rating");
			}
			break;
		case "subscribe":
			if (!validId(value.artistId) || typeof value.subscribed !== "boolean")
				throw new TypeError("Invalid subscription");
			break;
		case "library-save":
			if (!validId(value.id) || typeof value.saved !== "boolean") throw new TypeError("Invalid library change");
			break;
		case "history":
			if (
				!validId(value.trackId) ||
				typeof value.positionSeconds !== "number" ||
				!Number.isFinite(value.positionSeconds) ||
				value.positionSeconds < 0 ||
				value.positionSeconds > 86_400
			) {
				throw new TypeError("Invalid history update");
			}
			break;
		case "playlist-create":
			if (
				!boundedString(value.title, 150) ||
				!boundedString(value.description, 5000, true) ||
				!validPrivacy(value.privacy) ||
				(value.collaborate !== undefined && typeof value.collaborate !== "boolean")
			) {
				throw new TypeError("Invalid playlist");
			}
			break;
		case "playlist-update":
			if (
				!validId(value.playlistId) ||
				!boundedString(value.title, 150, true) ||
				!boundedString(value.description, 5000, true) ||
				!validPrivacy(value.privacy, true) ||
				(value.title === undefined && value.description === undefined && value.privacy === undefined)
			) {
				throw new TypeError("Invalid playlist update");
			}
			break;
		case "playlist-add":
			if (!validId(value.playlistId) || !validIds(value.trackIds)) throw new TypeError("Invalid playlist addition");
			break;
		case "playlist-remove":
			if (!validId(value.playlistId) || !validIds(value.itemIds)) throw new TypeError("Invalid playlist removal");
			break;
		case "playlist-reorder":
			if (!validId(value.playlistId) || !validId(value.itemId) || !validId(value.beforeItemId, true)) {
				throw new TypeError("Invalid playlist reorder");
			}
			break;
		case "playlist-delete":
			if (!validId(value.playlistId)) throw new TypeError("Invalid playlist deletion");
			break;
		case "account-setting":
			if (!accountSettingKeys.includes(String(value.key)) || typeof value.enabled !== "boolean") {
				throw new TypeError("Invalid account setting");
			}
			break;
	}
}

/** Named rather than pathed, so the renderer can never reach a file the bundle does not ship. */
export function validateDocumentName(value: unknown): asserts value is BundledDocument {
	const names: string[] = [
		"LICENSE",
		"PRIVACY.md",
		"SECURITY.md",
		"THIRD_PARTY_NOTICES.md",
	] satisfies BundledDocument[];
	if (typeof value !== "string" || !names.includes(value)) throw new TypeError("Unknown document");
}

export function validateDownloadRequest(value: unknown): asserts value is DownloadRequest {
	if (
		!record(value) ||
		!Array.isArray(value.tracks) ||
		value.tracks.length < 1 ||
		value.tracks.length > 2000 ||
		!value.tracks.every(validTrack)
	) {
		throw new TypeError("Invalid download request");
	}
}

export function validateTrack(value: unknown): asserts value is Track {
	if (!validTrack(value)) throw new TypeError("Invalid track");
}

/** The names index into a table of supported browsers in the main process, never straight into a path. */
export function validateBrowserAccount(value: unknown): asserts value is BrowserAccount {
	if (!record(value) || typeof value.browser !== "string" || typeof value.profile !== "string") {
		throw new TypeError("Invalid browser account");
	}
}

export function validateState(value: unknown): asserts value is PersistedState {
	if (!record(value) || value.version !== 1 || !record(value.playback) || !record(value.settings)) {
		throw new TypeError("Invalid local state");
	}
	if (
		!Array.isArray(value.playback.queue) ||
		value.playback.queue.length > 2000 ||
		!Array.isArray(value.recentSearches) ||
		value.recentSearches.length > 20 ||
		!Array.isArray(value.downloads) ||
		value.downloads.length > 20_000 ||
		!value.downloads.every(
			(item) =>
				record(item) &&
				validTrack(item.track) &&
				validFingerprint(item.fingerprint) &&
				(item.integratedLufs === undefined ||
					(typeof item.integratedLufs === "number" && Number.isFinite(item.integratedLufs)))
		)
	) {
		throw new TypeError("Local state exceeds bounds");
	}
	const volume = value.settings.volume;
	if (typeof volume !== "number" || volume < 0 || volume > 1) throw new TypeError("Invalid volume");
	// Undefined is allowed on purpose: that is a state file written before the setting existed, and it
	// reads as on wherever it is checked.
	const reportHistory = value.settings.reportHistory;
	if (reportHistory !== undefined && typeof reportHistory !== "boolean") {
		throw new TypeError("Invalid history setting");
	}
	const region = value.settings.region;
	if (region !== undefined && (typeof region !== "string" || !regionPattern.test(region))) {
		throw new TypeError("Invalid region");
	}
	const restricted = value.settings.restricted;
	if (restricted !== undefined && typeof restricted !== "boolean") throw new TypeError("Invalid restricted mode");
}
