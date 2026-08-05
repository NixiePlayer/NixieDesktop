import { execFileSync } from "node:child_process";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `pnpm dev` runs the stock Electron binary, and macOS takes the Dock label, the Cmd-Tab entry, and
// the app menu title from that bundle, not from `app.setName`, so development showed "Electron" no
// matter what the main process asked for. Renaming the bundle and its two name keys is the only way
// to reach them. Packaged builds are unaffected: electron-builder downloads its own copy of Electron
// and names it from `build.productName`.

const root = join(import.meta.dirname, "..");
const dist = join(root, "node_modules", "electron", "dist");
const from = join(dist, "Electron.app");
const to = join(dist, "Noctune.app");

if (process.platform !== "darwin" || (!existsSync(from) && !existsSync(to))) process.exit(0);

if (existsSync(from)) renameSync(from, to);
// The executable inside keeps its own name, so only the bundle path moves.
writeFileSync(join(root, "node_modules", "electron", "path.txt"), "Noctune.app/Contents/MacOS/Electron");

const plist = join(to, "Contents", "Info.plist");
// The bundle path stays `Noctune.app` because `path.txt` above points at it, but the two name keys
// carry the channel, so a development window is never mistaken for the installed app beside it.
for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
	execFileSync("plutil", ["-replace", key, "-string", "Noctune (Dev)", plist]);
}
// Editing that plist breaks the seal on the ad-hoc signature Electron ships with, and an app whose
// signature does not validate is refused by UNUserNotificationCenter: every notification comes back
// as UNErrorDomain 1 and macOS never asks for permission, since it will not register the app at all.
// Signing it again ad-hoc is what makes development match a packaged build here.
execFileSync("codesign", ["--force", "--deep", "--sign", "-", to]);
// Launch Services caches bundle metadata by path, and it ignores a plist edit until the bundle's own
// timestamp moves.
execFileSync("touch", [to]);
