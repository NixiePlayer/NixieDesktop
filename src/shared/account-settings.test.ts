import { describe, expect, it } from "vitest";
import { extractAccountSettings } from "./account-settings";

/** Shaped after a real `account/get_setting` response, trimmed to the fields the walk reads. */
const setting = (itemId: string, enabled: boolean, settingItemId: string) => ({
	settingBooleanRenderer: {
		title: { runs: [{ text: itemId }] },
		enabled,
		itemId,
		enableServiceEndpoint: { setSettingEndpoint: { settingItemId, boolValue: true, settingItemIdForClient: itemId } },
		disableServiceEndpoint: {
			setSettingEndpoint: { settingItemId, boolValue: false, settingItemIdForClient: itemId },
		},
	},
});

const feedbackSetting = (itemId: string, enabled: boolean) => ({
	settingBooleanRenderer: {
		title: { runs: [{ text: itemId }] },
		enabled,
		itemId,
		enableServiceEndpoint: { feedbackEndpoint: { feedbackToken: `on-${itemId}` } },
		disableServiceEndpoint: { feedbackEndpoint: { feedbackToken: `off-${itemId}` } },
	},
});

/** Restricted Mode as upstream actually sends it: no state, and an endpoint with no api url. */
const safetyMode = {
	settingBooleanRenderer: {
		title: { runs: [{ text: "Restricted Mode" }] },
		itemId: "SAFETY_MODE",
		enableServiceEndpoint: {
			setClientSettingEndpoint: { settingDatas: [{ clientSettingEnum: { item: "SAFETY_MODE" }, boolValue: true }] },
		},
		disableServiceEndpoint: {
			setClientSettingEndpoint: { settingDatas: [{ clientSettingEnum: { item: "SAFETY_MODE" }, boolValue: false }] },
		},
	},
};

const response = {
	responseContext: {},
	contents: {
		sections: [
			{ items: [safetyMode, setting("MUSIC_SHOW_YT_LIKES", false, "371")] },
			{
				items: [
					setting("MUSIC_SAVE_TO_MOST_RECENT_PLAYLIST", true, "454"),
					setting("MUSIC_DYNAMIC_QUEUE", true, "414"),
				],
			},
			{
				items: [
					feedbackSetting("PRIVACY_PAUSE_WATCH_HISTORY", false),
					feedbackSetting("PRIVACY_PAUSE_SEARCH_HISTORY", true),
					feedbackSetting("MUSIC_ENABLE_USER_PROFILE_RADIO", false),
				],
			},
		],
	},
};

describe("extractAccountSettings", () => {
	it("reads the four settings Noctune offers, and only those", () => {
		const { settings } = extractAccountSettings(response);
		expect(settings).toEqual([
			{ key: "likedFromYouTube", enabled: false },
			{ key: "dynamicQueue", enabled: true },
			{ key: "pauseWatchHistory", enabled: false },
			{ key: "pauseSearchHistory", enabled: true },
		]);
	});

	it("keeps each mechanism's own payload rather than deriving one", () => {
		const { endpoints } = extractAccountSettings(response);
		expect(endpoints.get("dynamicQueue")).toEqual({
			enable: {
				kind: "setting",
				payload: { settingItemId: "414", boolValue: true, settingItemIdForClient: "MUSIC_DYNAMIC_QUEUE" },
			},
			disable: {
				kind: "setting",
				payload: { settingItemId: "414", boolValue: false, settingItemIdForClient: "MUSIC_DYNAMIC_QUEUE" },
			},
		});
		expect(endpoints.get("pauseWatchHistory")).toEqual({
			enable: { kind: "feedback", token: "on-PRIVACY_PAUSE_WATCH_HISTORY" },
			disable: { kind: "feedback", token: "off-PRIVACY_PAUSE_WATCH_HISTORY" },
		});
	});

	it("drops Restricted Mode, which states no setting and writes through no endpoint", () => {
		const { settings, endpoints } = extractAccountSettings(response);
		expect(settings.map(({ key }) => key)).not.toContain("restricted");
		expect([...endpoints.keys()]).toHaveLength(4);
	});

	it("answers empty for a response that carries no settings at all", () => {
		expect(extractAccountSettings({ contents: {} })).toEqual({ settings: [], endpoints: new Map() });
		expect(extractAccountSettings(undefined).settings).toEqual([]);
	});

	it("keeps the first of a repeated setting rather than the last", () => {
		const twice = {
			items: [setting("MUSIC_DYNAMIC_QUEUE", true, "414"), setting("MUSIC_DYNAMIC_QUEUE", false, "414")],
		};
		const { settings } = extractAccountSettings(twice);
		expect(settings).toEqual([{ key: "dynamicQueue", enabled: true }]);
	});
});
