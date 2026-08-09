/**
 * Collects the licence text of every dependency that ships inside the app.
 *
 * Vite inlines the whole production tree into `dist/` and `dist-electron/`, and the minifier drops
 * the licence headers on the way, so a built bundle carries none of the notices MIT and ISC ask to
 * travel with a copy, none of the Apache-2.0 NOTICE files, and nothing for the OFL font binaries in
 * `dist/assets`. Electron and Chromium are the exception: electron-builder copies their own two
 * files into the app by itself. Everything else is collected here, shipped beside the app's own
 * LICENSE (`build.files`), and read by the About tab.
 *
 * It is generated rather than committed because a notice that has gone stale is worse than one that
 * is regenerated on every build. `pnpm build` writes it, and `postinstall` writes it once more so a
 * development run has it too.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = "THIRD_PARTY_LICENSES.txt";

const PREAMBLE = `Third-party licenses

Nixie bundles the packages below into the application. Each one is listed with its version, the
license it declares, and the full text of the license file it ships. Nixie's own license is in
LICENSE, and the projects and data sources it depends on are described in THIRD_PARTY_NOTICES.md.

Electron and Chromium are not listed here. Their notices are packaged separately, as
LICENSE.electron.txt and LICENSES.chromium.html inside the application.

This file is generated from the dependency tree on every build. Do not edit it by hand.
`;

/** A package can ship a licence and a NOTICE beside it, and Apache-2.0 asks for both. */
const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

const grouped = JSON.parse(
	execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
);

const packages = Object.values(grouped)
	.flat()
	.sort((a, b) => a.name.localeCompare(b.name));

if (!packages.length) {
	console.error(`Release blocked: no dependencies found, ${OUTPUT} would ship empty.`);
	process.exit(1);
}

const sections = packages.map((entry) => {
	const heading = `${entry.name} ${entry.versions.join(", ")}`;
	const lines = [heading, "-".repeat(heading.length), entry.license];
	if (entry.homepage) lines.push(entry.homepage);
	return `${lines.join("\n")}\n\n${licenseText(entry)}`;
});

writeFileSync(OUTPUT, `${PREAMBLE}\n${"=".repeat(96)}\n\n${sections.join(`\n${"=".repeat(96)}\n\n`)}`);
console.log(`Wrote ${OUTPUT} for ${packages.length} packages.`);

/** Falls back to the declared identifier, since a package shipping no file still has to be named. */
function licenseText(entry) {
	const directory = entry.paths?.find(Boolean);
	const files = directory
		? readdirSync(directory)
				.filter((file) => LICENSE_FILE.test(file))
				.sort()
		: [];
	const texts = files.map((file) => readFileSync(join(directory, file), "utf8").trim()).filter(Boolean);
	if (!texts.length) return `No license file is distributed with this package. It declares ${entry.license}.\n`;
	return `${texts.join("\n\n")}\n`;
}
