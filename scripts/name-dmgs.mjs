import { renameSync } from "node:fs";

// electron-builder names an artifact after the architecture it was built for, and drops the
// suffix entirely for x64, so the two files a reader picks between arrive as "Noctune-1.2.3.dmg"
// and "Noctune-1.2.3-arm64.dmg". Neither says which Mac it is for, and the one that says nothing
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

export default function nameDmgs({ artifactPaths }) {
	for (const file of artifactPaths.filter((path) => path.endsWith(".dmg"))) {
		renameSync(file, dmgName(file));
	}

	// The hook's return value is the artifacts to publish beside the ones already built, and there
	// are none: the workflow uploads the whole directory itself.
	return [];
}
