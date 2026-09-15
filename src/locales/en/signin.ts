/** The sign-in view and the two screens that stand in for the app: its wording is the app's disclosure. */
export const signin = {
	heroTitle: "A real player for your music.",
	heroBody: "Your playlists, albums and library, in a native desktop player. No browser tab, no ads, gapless.",
	continueWith: (name: string, detail?: string) =>
		detail ? `Continue with ${name}, ${detail}` : `Continue with ${name}`,
	extensionTitle: "Connect Chrome, Edge, Brave or Vivaldi",
	notSignedInTo: "Not signed in to",
	extensionWindows:
		"Windows protects these browsers' cookies so that only the browser can read them. Nixie Link asks the browser for your YouTube session instead. ",
	extensionFallback: "If Nixie cannot find this browser profile, use Nixie Link instead. ",
	installBefore: "The extension is not in browser marketplaces. Follow the ",
	installGuide: "manual installation guide",
	installAfter: ", then open Nixie Link once. Your profile appears here automatically.",
	connectedThroughExtension: "Connected through the extension",
	pairingCode: "Pairing code",
	pairingHint: "Copy this code from the Nixie Link popup.",
	connect: "Connect",
	onlyInApp: "Sign-in is only available in the Nixie desktop app.",
	didNotSignIn: "That did not sign you in. Please try again.",
	title: "Continue with a signed-in browser",
	intro:
		"Nixie continues the YouTube session you are already signed in to in your browser. Google refuses to sign in inside an app window, so it never asks you here.",
	accountsNote:
		"Each row states the account signed in to that browser profile. Your system may ask once for permission to read the browser's saved cookies. Nixie re-reads that profile while it runs, because Google expires the session every few minutes. The cookies go to YouTube and nowhere else.",
	noFirefoxBefore: "No signed-in Firefox found. Sign in at",
	noFirefoxAfter: "in Firefox, or connect Chrome, Edge, Brave or Vivaldi through the extension above.",
	noBrowserBefore: "No signed-in browser found. Sign in at",
	noBrowserAfter: "in Chrome, Brave, Edge, Vivaldi, or Firefox, then check again.",
	checkAgain: "Check again",
	disclaimer:
		"Nixie is an independent, unofficial client and is not affiliated with, endorsed by, or sponsored by Google or YouTube. YouTube and YouTube Music are trademarks of Google LLC. Nixie plays only what the account you link can already play, and your use of that account stays subject to YouTube's terms. It reaches YouTube through the private interface the YouTube Music apps use, which YouTube does not publish or support, so the account you link carries whatever risk that brings.",
	premium: {
		title: "Nixie needs Music Premium",
		why: "Nixie plays without advertisements, in the background, and through its own audio engine. Those are things YouTube sells as a Music Premium subscription, so it plays only for an account that holds one. The account you linked does not.",
		next: "A subscription started on the web is picked up the next time Nixie opens. Signing out here goes back to picking an account.",
		signOut: "Sign out",
		openYouTubeMusic: "Open YouTube Music",
	},
	dataAccess: {
		title: "Allow Nixie to read your browser",
		why: "Nixie stays signed in by reading the YouTube session saved in your browser, and reads it again every few minutes because Google keeps replacing it. macOS is blocking that read, so nothing can play until you allow it.",
		stepOpen: "Open System Settings, then Privacy & Security, then Full Disk Access.",
		stepTurnOn: "Turn on Nixie.",
		stepRestart: "Restart Nixie.",
		openSettings: "Open System Settings",
		restart: "Restart Nixie",
		linkBefore:
			"Full Disk Access lets Nixie read files other apps keep, not only your browser's. If you would rather not allow that, ",
		useLink: "connect through Nixie Link",
		linkAfter: ", which reads the session through the browser instead.",
	},
	somethingWentWrong: "Something went wrong",
};
