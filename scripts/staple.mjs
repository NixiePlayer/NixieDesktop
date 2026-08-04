import { execFileSync } from "node:child_process";

// electron-builder notarizes the app itself, from APPLE_ID, APPLE_TEAM_ID and
// APPLE_APP_SPECIFIC_PASSWORD, but it staples nothing, so a downloaded build has to reach Apple
// over the network the first time it is opened and refuses to open at all when it cannot. This
// hook runs immediately after that notarization and attaches the ticket to the bundle, before the
// DMG and the ZIP are built around it.

export default function staple(context) {
	// `mac.notarize` is false by default here, so an unnotarized local build has no ticket to
	// attach. `pnpm dist` is what turns it on, and stapling then fails loudly rather than shipping
	// an artifact that only looks notarized.
	if (!context.packager.platformSpecificBuildOptions.notarize) return;

	execFileSync("xcrun", ["stapler", "staple", `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`], {
		stdio: "inherit",
	});
}
