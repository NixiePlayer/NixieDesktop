/** What the main process says to the reader: the macOS menu, the startup error box, and sign-in failures. */
export const main = {
	exportDiagnostics: "Export diagnostics",
	playback: "Playback",
	startupFailed: "Nixie could not start",
	unknownStartupError: "Unknown startup error",
	/**
	 * Every value here is byte-identical to the English `Error` a sign-in path throws, in `main.ts`,
	 * `browser-cookies.ts` or `native-host-server.ts`: main translates a rejection by finding its message
	 * among these, so rewording one side without the other leaves that error in English.
	 */
	errors: {
		unentitled: "That account has no YouTube Music Premium subscription, which Nixie requires",
		notSignedIn: "That profile is not signed in to YouTube",
		signInClosed: "That sign-in is no longer open. Please start again.",
		secureStorage: "Secure storage is not available on this computer",
		unlockKeyringToPair: "Unlock a system keyring before pairing the extension",
		browserGone: "That browser is no longer connected",
		dataAccessRefused:
			"macOS refused Nixie access to the browser's data. Allow Nixie in System Settings, Privacy & Security, Full Disk Access, then restart Nixie",
		keyringLocked: "Nixie could not read the system keyring. Unlock the keyring and try again.",
		keyringMissing: "Nixie could not read the system keyring. Install libsecret-tools and try again.",
		unsupportedProfile: "Unsupported browser profile",
		invalidPairingCode: "Invalid extension pairing code",
		extensionNotConnected: "Extension not connected",
		extensionTimedOut: "Extension pull timed out",
		extensionDisconnected: "Extension disconnected",
	},
};
