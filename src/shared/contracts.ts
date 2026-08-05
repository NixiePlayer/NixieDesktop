import type { AccountSetting, AccountSettingKey } from "./account-settings";

export type { AccountSetting, AccountSettingKey };

export type RemoteId = string;

/**
 * A queue upstream already built and named in a button of its own: an artist's shuffled mix, or its
 * radio. Replayed exactly as it arrived rather than derived, since the shuffle is upstream's own
 * order and `params` is opaque. Public ids, no credential.
 */
export interface WatchTarget {
	id: RemoteId;
	playlistId: RemoteId;
	params?: string;
}

export interface Artist {
	id: RemoteId;
	name: string;
	/** Only an artist page's own header carries one. A row that merely names an artist does not. */
	description?: string;
	artworkUrl?: string;
	/** The wide image behind an artist page's header. Only that header carries one. */
	bannerUrl?: string;
	/** What its header's own Shuffle and Mix buttons play. Only an artist page's header carries them. */
	shuffle?: WatchTarget;
	radio?: WatchTarget;
	/** Its place in the chart it was listed in. Only a chart row states one. */
	rank?: number;
	/**
	 * The line under the name on YouTube Music: monthly listeners where upstream knows one, subscribers
	 * where it does not. Localised and already abbreviated ("806K monthly listeners"), so it is only
	 * ever shown, never compared.
	 */
	listeners?: string;
}

export interface Album {
	id: RemoteId;
	title: string;
	artists: Artist[];
	year?: string;
	artworkUrl?: string;
	trackCount?: number;
	/** How upstream labels the release: "Album", "Single", "EP". Localised, so it is only ever shown. */
	kind?: string;
	explicit?: boolean;
}

export interface Track {
	id: RemoteId;
	title: string;
	artists: Artist[];
	album?: Album;
	/**
	 * The release the row points at without naming it, which is all a search result states about its
	 * album: enough to open it, never enough to print it. Set only when `album` is not.
	 */
	albumId?: RemoteId;
	durationSeconds: number;
	artworkUrl?: string;
	explicit?: boolean;
	/** How often it has been played, worded and abbreviated by upstream ("96M plays"). Localised. */
	plays?: string;
	/**
	 * Its place in the chart it was listed in. Upstream states it, rather than it being the row's
	 * position: a row of a kind that has no entity here is dropped on the way, and counting the
	 * survivors off then renumbers everything under the first one dropped.
	 */
	rank?: number;
}

export interface Playlist {
	id: RemoteId;
	title: string;
	description?: string;
	artworkUrl?: string;
	author?: string;
	itemCount?: number;
	/** Only ever known for a playlist the account owns: upstream tells nobody else. */
	privacy?: PlaylistPrivacy;
}

export interface PlaylistItem {
	itemId: RemoteId;
	track: Track;
}

export interface MusicSection<T> {
	title: string;
	strapline?: string;
	artworkUrl?: string;
	itemsPerColumn?: number;
	/** How the shelf is drawn. Absent reads as "cards". */
	layout?: "cards" | "ranked";
	/** Where the shelf's own "More" leads, when upstream states one. */
	more?: BrowseTarget;
	items: T[];
}

export interface BrowseTarget {
	/** The upstream action label, for example "More" or "Moods & genres". */
	label: string;
	/** The title to show after following the target. */
	title: string;
	browseId: RemoteId;
	/** Opaque upstream browse parameters. Pass through unchanged. */
	params?: string;
	destination: "explore" | "playlist";
	/** Only a region picker states this, on the option the page it belongs to already answers. */
	selected?: boolean;
}

export type ExploreSection =
	| {
			type: "navigation";
			title: string;
			layout: "moods" | "genres";
			items: BrowseTarget[];
			more?: BrowseTarget;
	  }
	/** The same shelf home reads, which is why it is the same type. Explore always states its layout. */
	| (MusicSection<MusicEntity> & { type: "media"; layout: "cards" | "ranked" });

export interface ExploreData {
	/** What the page calls itself, when the response names it. A destination is not always titled. */
	title?: string;
	shortcuts: BrowseTarget[];
	sections: ExploreSection[];
	/** A chart's own region picker. Each option is a browse of its own, so each is a target. */
	regions?: BrowseTarget[];
}

/**
 * A mood or genre chip over the home feed. `token` is minted in main and means nothing outside it:
 * the browse parameters behind it never leave that process. The chip a response already answers
 * states no token, since it is where the feed already is.
 */
export interface FeedFilter {
	label: string;
	token?: string;
	selected?: boolean;
}

export interface Page<T> {
	items: T[];
	sections?: MusicSection<T>[];
	/** Home's chips. A first or filtered page carries them, a continuation page does not. */
	filters?: FeedFilter[];
	explore?: ExploreData;
	continuation?: string;
}

export type RepeatMode = "off" | "all" | "one";
/** What the thumbs say about a track. "indifferent" is upstream's word for neither. */
export type TrackRating = "like" | "dislike" | "indifferent";
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type AudioQuality = "low" | "normal" | "high";
export type Theme = "dark" | "light" | "system";
export type NormalizationLevel = "off" | "quiet" | "normal" | "loud";
/** Who can reach a playlist. Upstream only lets a shareable one be collaborative. */
export type PlaylistPrivacy = "public" | "unlisted" | "private";

export interface QueueContext {
	type: "home" | "explore" | "album" | "playlist" | "search" | "library" | "radio";
	id?: RemoteId;
	title: string;
}

export interface PlaybackSnapshot {
	currentTrack?: Track;
	context?: QueueContext;
	queue: Track[];
	queueIndex: number;
	positionSeconds: number;
	volume: number;
	repeat: RepeatMode;
	shuffle: boolean;
	status: PlayerStatus;
	/** Why the last play attempt failed. Set only alongside `status: "error"`. */
	errorMessage?: string;
}

export interface AudioVariantFingerprint {
	itag: number;
	mimeType: string;
	codec: string;
	bitrate: number;
	durationMs: number;
}

export interface LyricsLine {
	timeSeconds: number;
	text: string;
}

/** Ordered best to worst: the tie-break when two providers answer at the same quality. */
export type LyricsSource = "LRCLIB" | "NetEase" | "YouTube Music";

export interface LyricsResult {
	source: LyricsSource;
	instrumental: boolean;
	lines: LyricsLine[];
	plainLyrics?: string;
	/** The provider's own credit line, when it states one. YouTube Music names who licensed the text. */
	attribution?: string;
}

export interface AuthState {
	status: "signed-out" | "signing-in" | "authenticated" | "expired";
	accountName?: string;
	avatarUrl?: string;
}

/** A browser profile on this computer that already holds a YouTube session. */
export interface BrowserAccount {
	browser: string;
	profile: string;
	/** Only set when the browser has more than its default profile, and only for display. */
	label?: string;
	/** The browser profile's own display name, when the browser states one. */
	accountName?: string;
	/**
	 * The Google account signed in to that browser profile. Usually, but not always, the account
	 * owning its YouTube cookies, so nothing may present it as the account Noctune will use.
	 */
	accountEmail?: string;
	/** Data URL of the profile's picture, read off disk. Never a path and never a Google URL. */
	avatar?: string;
	/** Data URL of the browser's own application icon. */
	icon?: string;
}

export interface Settings {
	theme: Theme;
	quality: AudioQuality;
	normalization: NormalizationLevel;
	volume: number;
	/**
	 * ISO 3166 alpha-2, deciding which charts, releases and recommendations YouTube Music answers
	 * with. Undefined leaves it to whatever youtube.com's own config infers, which is where it sat
	 * before this existed. Not a language: the app's own wording does not follow it.
	 */
	region?: string;
	/**
	 * Restricted Mode. Local rather than account-wide because upstream holds it that way too: it
	 * arrives in `account/get_setting` carrying no state and a `setClientSettingEndpoint` that names
	 * no api url, so it is a flag the client sets on its own session, not something the account keeps.
	 */
	restricted?: boolean;
	/**
	 * Whether a play is reported to YouTube Music's watch history, which is what personalises the
	 * home feed. Read as on unless it is exactly false, so a state file written before this field
	 * existed needs no migration.
	 */
	reportHistory?: boolean;
	/**
	 * Whether the system notification naming the next track is shown when the queue advances on its
	 * own. Read as on unless it is exactly false, for the same reason `reportHistory` is.
	 */
	notifyTrackChange?: boolean;
}

export interface WindowBounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

export interface PersistedState {
	version: 1;
	playback: PlaybackSnapshot;
	settings: Settings;
	windowBounds?: WindowBounds;
	recentSearches: string[];
	downloads: OfflineTrack[];
}

export type MusicQuery =
	/** Both are tokens minted in main, opaque here: a chip's browse parameters, or the next page. */
	| { type: "home"; filter?: string; continuation?: string }
	| { type: "explore"; browseId?: RemoteId; params?: string }
	| { type: "suggestions"; query: string }
	| { type: "search"; query: string; filter?: "songs" | "albums" | "artists" | "playlists"; continuation?: string }
	| { type: "library"; filter?: "songs" | "albums" | "artists" | "playlists"; continuation?: string }
	/**
	 * The endless queue upstream builds around one song. Its first page only, see `extractQueueTracks`.
	 * A `WatchTarget` names the queue itself instead, and `id` is then the song it opens on.
	 */
	| { type: "radio"; id: RemoteId; playlistId?: RemoteId; params?: string }
	| { type: "album" | "artist" | "playlist"; id: RemoteId; continuation?: string };

export type MusicCommand =
	| { type: "rate"; trackId: RemoteId; rating: TrackRating }
	| { type: "subscribe"; artistId: RemoteId; subscribed: boolean }
	/** Holds a release in the library. `id` is an album's browse id or a playlist's, not a track's. */
	| { type: "library-save"; id: RemoteId; saved: boolean }
	| { type: "history"; trackId: RemoteId; positionSeconds: number }
	| { type: "playlist-create"; title: string; description?: string; privacy: PlaylistPrivacy; collaborate?: boolean }
	| { type: "playlist-update"; playlistId: RemoteId; title?: string; description?: string; privacy?: PlaylistPrivacy }
	| { type: "playlist-add"; playlistId: RemoteId; trackIds: RemoteId[] }
	| { type: "playlist-remove"; playlistId: RemoteId; itemIds: RemoteId[] }
	| { type: "playlist-reorder"; playlistId: RemoteId; itemId: RemoteId; beforeItemId?: RemoteId }
	| { type: "playlist-delete"; playlistId: RemoteId }
	/** Writes one YouTube Music account setting, which applies to every device signed in. */
	| { type: "account-setting"; key: AccountSettingKey; enabled: boolean };

export type MusicEntity = Track | Album | Artist | Playlist | PlaylistItem;

export interface ResolvedMedia {
	url: string;
	fingerprint: AudioVariantFingerprint;
	/** Integrated loudness YouTube reports for this exact variant, in LUFS. */
	integratedLufs?: number;
}

export interface OfflineTrack {
	track: Track;
	fingerprint: AudioVariantFingerprint;
	integratedLufs?: number;
}

export interface DownloadRequest {
	tracks: Track[];
}

/** What the About tab states about the build it is running in. */
export interface AppInfo {
	version: string;
	electron: string;
	chrome: string;
	/** Already formatted for display, e.g. "macOS 25.6.0", "Windows 10.0.26100", "Linux 6.8.0". */
	os: string;
	arch: string;
}

/** The documents shipped inside the app bundle, named rather than pathed. */
export type BundledDocument = "LICENSE" | "PRIVACY.md" | "SECURITY.md" | "THIRD_PARTY_NOTICES.md";

export interface MediaCommand {
	type: "play" | "pause" | "toggle" | "next" | "previous" | "seek";
	positionSeconds?: number;
}

export interface NoctuneBridge {
	auth: {
		state(): Promise<AuthState>;
		browsers(): Promise<BrowserAccount[]>;
		importFromBrowser(account: BrowserAccount): Promise<AuthState>;
		importCookies(cookieHeader: string): Promise<AuthState>;
		signOut(): Promise<AuthState>;
	};
	music: {
		query(request: MusicQuery): Promise<Page<MusicEntity>>;
		command(request: MusicCommand): Promise<{ ok: true; id?: string }>;
		/** Undefined when upstream states no rating for the track, which reads as neither thumb. */
		rating(trackId: RemoteId): Promise<TrackRating | undefined>;
		/** Empty when YouTube Music will not state them, which the page shows as a link out. */
		accountSettings(): Promise<AccountSetting[]>;
	};
	player: {
		resolve(trackId: string, quality: AudioQuality): Promise<ResolvedMedia>;
		onMediaCommand(listener: (command: MediaCommand) => void): () => void;
		position(positionSeconds: number): void;
		/** Announces a track the queue moved to on its own. Main decides whether anything is shown. */
		notify(track: Track): Promise<void>;
		/**
		 * Whether the platform refused the last banner it was asked to draw. False until one is, since
		 * nothing can ask whether the app is allowed to post one before trying.
		 */
		notifyRefused(): Promise<boolean>;
	};
	local: {
		load(): Promise<PersistedState>;
		save(state: PersistedState): Promise<void>;
		download(request: DownloadRequest): Promise<{ saved: number }>;
		removeDownload(trackId: RemoteId): Promise<void>;
		clear(selection: "session" | "downloads" | "all"): Promise<void>;
		exportDiagnostics(): Promise<string | undefined>;
		/** Total bytes on disk. Not persisted per track, so it is measured rather than summed. */
		downloadsSize(): Promise<number>;
		/** One of the documents shipped in the bundle, read by name from a fixed set. */
		document(name: BundledDocument): Promise<string>;
	};
	app: {
		info(): Promise<AppInfo>;
	};
}

declare global {
	interface Window {
		noctune?: NoctuneBridge;
	}
}
