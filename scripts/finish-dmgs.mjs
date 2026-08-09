import { execFile } from "node:child_process";
import { renameSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// electron-builder names an artifact after the architecture it was built for, and drops the
// suffix entirely for x64, so the two files a reader picks between arrive as "Neotune-1.2.3.dmg"
// and "Neotune-1.2.3-arm64.dmg". Neither says which Mac it is for, and the one that says nothing
// at all is the Intel build, which is the wrong way round for a reader guessing. There is no
// per-architecture `artifactName`: the template's only lever is `${arch}`, which is the raw
// "x64" or "arm64", so the rename happens here, after both are built and before either is
// uploaded.
//
// Only the DMGs are renamed. The ZIP beside each one is what electron-updater installs, and it
// picks the build for an Apple Silicon Mac by testing the file's own url for the substring
// "arm64" (`MacUpdater.filterFilesForArch`), since `latest-mac.yml` states no architecture
// anywhere. A ZIP renamed to say "applesilicon" matches nothing, so every Apple Silicon install
// would take the Intel build instead and go on running it under Rosetta, with nothing to see. The
// DMGs are named in that feed by nothing at all: `dmg.writeUpdateInfo` is false, so no updater
// reads them and a reader is the only one who ever does.
export function dmgName(file) {
	if (file.endsWith("-arm64.dmg")) return file.replace(/-arm64\.dmg$/, "-applesilicon.dmg");
	return file.replace(/\.dmg$/, "-intel.dmg");
}

// The disk image is the thing a first-time reader double-clicks, and Gatekeeper judges it before
// the app inside it is ever reached, so it needs a signature and a ticket of its own. Neither can
// come from `scripts/staple.mjs`: that is the `afterSign` hook, which runs while the DMG has not
// been assembled yet, and electron-builder's own `mac.notarize` submits the app alone. `dmg.sign`
// signs each image as it is built, with the same keychain identity and the same `--keychain`
// electron-builder found for the app, and this hook is the only place holding both finished
// images, so it is where they are submitted and stapled. The app's own submission stays either
// way: the ZIPs the updater installs are built around the bundle, not around the image.
export default async function finishDmgs({ artifactPaths, configuration }) {
	// Renaming first means the file Apple mints a ticket for is the file that ships. The signature
	// and the ticket both live inside the image rather than being keyed to its path, so either
	// order works, but this way no step hands the next one a path that later changes.
	const dmgs = artifactPaths
		.filter((path) => path.endsWith(".dmg"))
		.map((file) => {
			const named = dmgName(file);
			renameSync(file, named);
			return named;
		});

	// `mac.notarize` is false by default, so an ordinary build signs the image and stops there,
	// exactly as `scripts/staple.mjs` leaves the app alone. `pnpm dist` and the release workflow
	// are what turn it on.
	if (configuration.mac?.notarize) await Promise.all(dmgs.map(notarize));

	// The hook's return value is the artifacts to publish beside the ones already built, and there
	// are none: the workflow uploads the whole directory itself.
	return [];
}

// Both images go to Apple at once rather than one after the other. A submission is minutes of
// waiting on a server, and the release already spends two of them on the app, one per
// architecture, so serialising these would cost that twice over for nothing.
async function notarize(dmg) {
	await run("xcrun", [
		"notarytool",
		"submit",
		dmg,
		"--apple-id",
		process.env.APPLE_ID,
		"--team-id",
		process.env.APPLE_TEAM_ID,
		"--password",
		process.env.APPLE_APP_SPECIFIC_PASSWORD,
		"--wait",
	]);

	// This is the gate rather than the exit code above it: `stapler` refuses a submission Apple
	// marked `Invalid`, so a rejection cannot pass for a build that merely finished.
	await run("xcrun", ["stapler", "staple", dmg]);
}
