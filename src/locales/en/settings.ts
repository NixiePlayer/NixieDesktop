/** The settings page, its account rows, the bundled documents and the update prompt. */
export const settings = {
	title: "Settings",
	tabs: { general: "General", playback: "Playback", privacy: "Privacy", about: "About" },
	scope: { computer: "On this computer", account: "Your account · every device" },
	general: {
		description: "How Nixie looks, and what YouTube Music sends it.",
		theme: {
			label: "Theme",
			description: "System follows your device's appearance.",
			dark: "Dark",
			light: "Light",
			system: "System",
			always: "Always",
			followsDevice: "Follows the device",
		},
		language: {
			label: "Language",
			description:
				"System follows your device's language. YouTube Music answers in it too, so shelf titles and genres follow it.",
			system: "System",
			// Each language is named in its own words, in every dictionary.
			en: "English",
			it: "Italiano",
		},
		notify: {
			label: "Notify on track change",
			description:
				"Names the next track when the queue moves on by itself. Nothing is shown while Nixie is the app you are in.",
			refused: "Your system refused the last one.",
			hint: {
				darwin: "Allow notifications for Nixie in System Settings, under Notifications.",
				win32:
					"Allow notifications for Nixie in Settings, under System and then Notifications, and check that Do not disturb is off.",
				linux:
					"Allow notifications for Nixie in your desktop's notification settings, and check that a notification service is running.",
			},
		},
		region: {
			label: "Content region",
			description:
				"Decides which charts, new releases and recommendations you are shown. This is not the app's language.",
			automatic: "Chosen by YouTube",
		},
		restricted: {
			label: "Restricted mode",
			description:
				"Hides songs and videos with potentially mature content. No filter catches everything. YouTube keeps this per app rather than on your account, so it covers Nixie alone.",
		},
		likedFromYouTube: {
			label: "Liked music from YouTube",
			description: "Shows music videos you gave a thumbs up in other YouTube apps in your Liked music playlist.",
		},
	},
	playback: {
		description: "How Nixie streams and levels what you play.",
		normalization: {
			label: "Volume normalization",
			description: (maxBoostDb: number) =>
				`Holds tracks near one loudness, using the levels YouTube measured. Quiet tracks are brought up toward the target and loud ones held down, with the lift capped at ${maxBoostDb} dB so nothing clips.`,
			quiet: (lufs: number) => `Quiet (${lufs} LUFS)`,
			normal: (lufs: number) => `Normal (${lufs} LUFS)`,
			loud: (lufs: number) => `Loud (${lufs} LUFS)`,
		},
		autoplay: {
			label: "Autoplay",
			description:
				"Keeps playing when the queue runs out, on a radio YouTube Music seeds from the track that just finished. Turning this off stops Nixie at the end of the queue.",
		},
		quality: {
			label: "Audio quality",
			description: "Opus is preferred, AAC is the fallback.",
			low: "Data saver",
			normal: "Balanced",
			high: "Highest available",
		},
		dynamicQueue: {
			label: "Dynamic queue",
			description: "Lets YouTube Music update queues and radios as it learns what you listen to.",
		},
	},
	privacy: {
		description:
			"Nixie has no account service, backend, telemetry, or media cache. Nothing here leaves this device except what the rows below send to the account you linked.",
		reportHistory: {
			label: "Report plays to YouTube",
			description:
				"Tells YouTube Music what you played, which is what personalises your home feed. Turning this off leaves the feed on whatever it already knows about you.",
		},
		diagnostics: {
			label: "Diagnostics",
			description:
				"Writes a log file with playback and session events. Cookies, stream URLs, file paths, and lyrics are redacted.",
			action: "Export",
		},
		localData: {
			label: "Local data",
			description: "Removes the queue, settings, and the linked browser account, so this signs you out.",
			action: "Clear",
		},
		pauseWatchHistory: {
			label: "Pause watch history",
			description:
				"Stops YouTube recording what you play, in every app signed in to this account. It can take a moment to apply.",
		},
		pauseSearchHistory: {
			label: "Pause search history",
			description: "Stops YouTube recording what you search for, in every app signed in to this account.",
		},
		manageHistory: {
			label: "Manage or delete your history",
			description: "Review and remove what YouTube has recorded. Deleting is permanent and covers every device.",
		},
	},
	about: {
		description: "What this build is, and how to tell us it is wrong.",
		readingBuild: "Reading this build.",
		copy: "Copy",
		versionCopied: "Version copied",
		reportIssue: {
			label: "Report an issue",
			description: "Review and copy recent errors, or open a GitHub issue with app and system information.",
		},
		disclaimer:
			"Nixie is an independent, unofficial client and is not affiliated with, endorsed by, or sponsored by Google or YouTube. YouTube and YouTube Music are trademarks of Google LLC. It is not a YouTube Music product and does not reproduce or imitate one: it plays what the account you linked can already play, and it stores no media of its own.",
		documents: {
			license: { title: "License", description: "Nixie is released under the MIT license." },
			privacy: { title: "Privacy", description: "What is stored on this computer, and the one thing that leaves it." },
			security: { title: "Security", description: "How the app is sandboxed, and how to report a vulnerability." },
			notices: { title: "Third-party notices", description: "The projects and lyrics sources Nixie depends on." },
			licenses: {
				title: "Third-party licenses",
				description: "The license of every open source package bundled into this build.",
			},
		},
		youtubeAndGoogle: "YouTube and Google",
		terms: { label: "YouTube Terms of Service", description: "The terms covering the account Nixie plays through." },
		googlePrivacy: {
			label: "Google Privacy Policy",
			description: "How Google handles the data behind that account.",
		},
		youtubeMusic: { description: "The official app, where every account setting can also be changed." },
	},
	document: {
		reading: "Reading…",
		unreadable: (name: string) => `Nixie could not read ${name} from this build.`,
	},
	account: {
		openSettings: "Open YouTube Music settings",
		notSaved: "YouTube Music did not save that",
		unavailable: "Nixie could not reach your account settings. They are still yours to change on YouTube Music.",
	},
	update: {
		restartNow: "Restart now",
		downloading: {
			label: (version: string) => `Downloading Nixie ${version}`,
			description: "Keep listening, this runs in the background.",
		},
		unsupported: {
			label: "Check for updates",
			description: "A development build has no release feed behind it, so this answers nothing.",
			action: "Check now",
		},
		checking: {
			label: "Checking for updates",
			description: "Asking GitHub what the latest release is.",
			action: "Checking",
		},
		current: { label: "Up to date", description: "This is the latest release.", action: "Check again" },
		ready: {
			label: (version: string) => `Nixie ${version} is ready`,
			description: "Restarting installs it, and so does quitting Nixie later.",
		},
		error: {
			label: "Could not check for updates",
			description: "GitHub could not be reached. Every release is on the repository as well.",
		},
		toast: {
			anyReady: "An update is ready",
			description: "Restart to install it, or keep listening and it installs when you next quit.",
		},
	},
};
