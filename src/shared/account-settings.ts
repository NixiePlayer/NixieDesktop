/**
 * The account settings YouTube Music holds, read out of a raw `account/get_setting` response.
 *
 * There is no wrapper for this: youtubei.js models the youtube.com settings pages (`SPaccount_*`,
 * `TwoColumnBrowseResults`) and nothing under `parser/ytmusic/`, and every one of those browse ids
 * answers the music client with a 500. `account/get_setting` under `YTMUSIC` is what the web player
 * itself asks, and it returns all eight settings as `settingBooleanRenderer` nodes in one response.
 */

export type AccountSettingKey = "likedFromYouTube" | "dynamicQueue" | "pauseWatchHistory" | "pauseSearchHistory";

/**
 * Keyed on upstream's own `itemId`, which is stable and unlocalised, unlike the title beside it.
 *
 * The four left out are deliberate: `SAFETY_MODE` is not an account setting at all (see below),
 * `MUSIC_SAVE_TO_MOST_RECENT_PLAYLIST` governs an auto-save Neotune does not do, and the two
 * `MUSIC_ENABLE_*` profile flags only decide what strangers see on a YouTube profile page, which
 * this app never renders.
 */
const KEYS: Record<string, AccountSettingKey> = {
	MUSIC_SHOW_YT_LIKES: "likedFromYouTube",
	MUSIC_DYNAMIC_QUEUE: "dynamicQueue",
	PRIVACY_PAUSE_WATCH_HISTORY: "pauseWatchHistory",
	PRIVACY_PAUSE_SEARCH_HISTORY: "pauseSearchHistory",
};

/** What crosses to the renderer: a state, never an endpoint or a token. */
export interface AccountSetting {
	key: AccountSettingKey;
	enabled: boolean;
}

/**
 * How one direction of one switch is written. Upstream uses two mechanisms in the same response and
 * states which per setting, so neither is inferred: the payload is replayed exactly as it arrived.
 * That matters beyond tidiness, since a switch's `enabled` does not agree with its own `boolValue`
 * in every case (youtube.com's "Keep all my subscriptions private" reads `enabled: true` and sends
 * `boolValue: false` to turn on), so deriving the body from the state would invert some settings.
 */
export type AccountSettingWrite =
	| { kind: "setting"; payload: Record<string, unknown> }
	| { kind: "feedback"; token: string };

export interface AccountSettingEndpoints {
	enable: AccountSettingWrite;
	disable: AccountSettingWrite;
}

export interface AccountSettingsResult {
	settings: AccountSetting[];
	/** Main-process only. Held so a later write can replay the endpoint this read handed out. */
	endpoints: Map<AccountSettingKey, AccountSettingEndpoints>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Every `settingBooleanRenderer` in the tree, whatever it is nested under. */
function booleanSettings(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		for (const item of value) booleanSettings(item, found);
		return found;
	}
	if (!isRecord(value)) return found;
	for (const [key, item] of Object.entries(value)) {
		if (key === "settingBooleanRenderer" && isRecord(item)) found.push(item);
		booleanSettings(item, found);
	}
	return found;
}

function writeFrom(endpoint: unknown): AccountSettingWrite | undefined {
	if (!isRecord(endpoint)) return;
	const setting = endpoint.setSettingEndpoint;
	if (isRecord(setting)) return { kind: "setting", payload: setting };
	const feedback = endpoint.feedbackEndpoint;
	if (isRecord(feedback) && typeof feedback.feedbackToken === "string") {
		return { kind: "feedback", token: feedback.feedbackToken };
	}
	// `setClientSettingEndpoint`, which is what Restricted Mode carries, lands here on purpose. It
	// names no `apiUrl` and the node states no `enabled`, because it is a client flag rather than
	// something the account holds. Neotune sets it on the InnerTube session instead.
}

export function extractAccountSettings(response: unknown): AccountSettingsResult {
	const settings: AccountSetting[] = [];
	const endpoints = new Map<AccountSettingKey, AccountSettingEndpoints>();
	for (const node of booleanSettings(response)) {
		const key = KEYS[String(node.itemId)];
		// A setting with no state is one that cannot be drawn as a switch, so it is dropped rather
		// than shown at a guessed position.
		if (!key || typeof node.enabled !== "boolean" || endpoints.has(key)) continue;
		const enable = writeFrom(node.enableServiceEndpoint);
		const disable = writeFrom(node.disableServiceEndpoint);
		if (!enable || !disable) continue;
		settings.push({ key, enabled: node.enabled });
		endpoints.set(key, { enable, disable });
	}
	return { settings, endpoints };
}
