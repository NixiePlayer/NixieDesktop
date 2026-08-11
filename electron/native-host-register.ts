import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cmdLiteral = (value: string) => value.replaceAll("%", "%%");
const shellLiteral = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

// The reverse-DNS name the browser looks the host up by, and the extension id the pinned key derives.
// The same id appears in the extension's manifest `key`, in the host manifest's allowed_origins, and
// in the config the pipe server checks the handshake against: three copies of one contract, and a
// mismatch is answered by the browser with "Access to the specified native messaging host is
// forbidden". It lives in its own repository, so this is the only copy the app holds.
export const NATIVE_HOST_NAME = "com.theedoran.nixie";
export const EXTENSION_ID = "pgknibkmcmahfafgbkndpkkcpciigleb";

/** Where a browser looks for a native host manifest: a registry key on Windows, a file elsewhere. */
export interface HostTarget {
	manifestPath?: string;
	registryKey?: string;
}

// One row per Chromium fork the extension can run in. Windows reads a registry value that points at a
// single manifest file; macOS and Linux each read a manifest file inside the browser's own directory.
const BROWSERS = [
	{ registry: "Software\\Google\\Chrome", mac: "Google/Chrome", linux: "google-chrome" },
	{ registry: "Software\\Microsoft\\Edge", mac: "Microsoft Edge", linux: "microsoft-edge" },
	{
		registry: "Software\\BraveSoftware\\Brave-Browser",
		mac: "BraveSoftware/Brave-Browser",
		linux: "BraveSoftware/Brave-Browser",
	},
	{ registry: "Software\\Vivaldi", mac: "Vivaldi", linux: "vivaldi" },
	{ registry: "Software\\Chromium", mac: "Chromium", linux: "chromium" },
];

/**
 * Pure: the platform and the environment in, the destinations out. Nothing here touches the disk, so
 * the test is a table and runs on any runner, which is what keeps CI on ubuntu (a Windows-only path
 * table is still a value it can assert). On Windows the manifest itself lives under userData and every
 * key points at it, so the file path is the caller's to supply; here only the keys vary.
 */
export function hostTargets(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	home: string,
	hostName: string
): HostTarget[] {
	if (platform === "win32") {
		return BROWSERS.map((browser) => ({ registryKey: `HKCU\\${browser.registry}\\NativeMessagingHosts\\${hostName}` }));
	}
	// posix.join rather than the platform join: a manifest path for macOS or Linux uses their own
	// separator whatever host builds it, which is what keeps this pure and its test portable. In
	// production it only ever runs on the platform it names, where the two agree anyway.
	if (platform === "darwin") {
		const base = posix.join(home, "Library", "Application Support");
		return BROWSERS.map((browser) => ({
			manifestPath: posix.join(base, browser.mac, "NativeMessagingHosts", `${hostName}.json`),
		}));
	}
	const base = env.XDG_CONFIG_HOME || posix.join(home, ".config");
	return BROWSERS.map((browser) => ({
		manifestPath: posix.join(base, browser.linux, "NativeMessagingHosts", `${hostName}.json`),
	}));
}

/** The generated launcher that runs the packaged Electron binary as Node against the relay. */
export function wrapperScript(
	platform: NodeJS.Platform,
	executable: string,
	hostScript: string,
	configPath: string
): string {
	if (platform === "win32") {
		// cmd expands %VAR% even inside double quotes, so a `%` in an account name or install path (both
		// legal on NTFS) would corrupt the argument. Doubling it is how a literal percent survives; `%*`,
		// which forwards Chrome's own origin argument, is left alone.
		return [
			"@echo off",
			"set ELECTRON_RUN_AS_NODE=1",
			`"${cmdLiteral(executable)}" "${cmdLiteral(hostScript)}" "--config=${cmdLiteral(configPath)}" %*`,
			"",
		].join("\r\n");
	}
	return [
		"#!/bin/sh",
		`ELECTRON_RUN_AS_NODE=1 exec ${shellLiteral(executable)} ${shellLiteral(hostScript)} ${shellLiteral(`--config=${configPath}`)} "$@"`,
		"",
	].join("\n");
}

interface RegisterOptions {
	platform: NodeJS.Platform;
	userDataPath: string;
	/** The packaged Electron binary, or the dev electron in development. */
	executable: string;
	/** The unpacked host relay, resources/native-host/host.cjs when packaged. */
	hostScript: string;
	extensionId: string;
	hostName: string;
}

/**
 * Idempotent, and the only registration path that covers every platform: macOS and Linux have no
 * installer, and a Windows development run has none either. The NSIS installer writes the same
 * registry keys so a fresh install works before Nixie is opened, and this repairs and updates them
 * afterwards, which matters because the manifest names an absolute path that an update moves. Each
 * target is written independently and a failure on one (a browser that is not installed, a directory
 * that cannot be made) is swallowed, since the next browser is unrelated to it.
 */
export async function registerNativeHost(options: RegisterOptions) {
	const dir = join(options.userDataPath, "native-host");
	await mkdir(dir, { recursive: true, mode: 0o700 });

	const wrapper = join(dir, options.platform === "win32" ? "nixie-host.bat" : "nixie-host.sh");
	const configPath = join(dir, "config.json");
	await writeFile(wrapper, wrapperScript(options.platform, options.executable, options.hostScript, configPath), {
		mode: 0o700,
	});

	const manifest = JSON.stringify({
		name: options.hostName,
		description: "Nixie browser link",
		path: wrapper,
		type: "stdio",
		allowed_origins: [`chrome-extension://${options.extensionId}/`],
	});

	const targets = hostTargets(options.platform, process.env, homeDir(), options.hostName);

	if (options.platform === "win32") {
		// One manifest file under userData, and every browser's registry key points at it. The value may
		// name a file that does not exist yet at install time; Chromium treats that as an unregistered
		// host, and this write is what makes it real.
		const manifestPath = join(dir, `${options.hostName}.json`);
		await writeFile(manifestPath, manifest, { mode: 0o600 });
		// reg.exe by absolute path for the same reason the manifest launcher uses one: the per-user
		// install directory is the process working directory, which libuv searches before PATH on Windows.
		const regExe = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
		for (const target of targets) {
			if (!target.registryKey) continue;
			// HKCU needs no elevation, and no registry API in node is worth a dependency. A browser that is
			// not installed still gets its key, which is harmless and idempotent (the key is inert without it).
			await execFileAsync(regExe, ["add", target.registryKey, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"]).catch(
				() => undefined
			);
		}
		return;
	}

	for (const target of targets) {
		if (!target.manifestPath) continue;
		// Only into a browser that is installed: the manifest sits two levels down (in the browser's own
		// NativeMessagingHosts), so its grandparent existing is what says the browser is there. Writing it
		// regardless would create Chrome, Brave and Vivaldi data directories on a Mac that has none, which
		// other tools read as those browsers being installed.
		const browserDir = dirname(dirname(target.manifestPath));
		if (!(await exists(browserDir))) continue;
		await mkdir(dirname(target.manifestPath), { recursive: true }).catch(() => undefined);
		await writeFile(target.manifestPath, manifest, { mode: 0o600 }).catch(() => undefined);
	}
}

async function exists(path: string) {
	return access(path).then(
		() => true,
		() => false
	);
}

function homeDir(): string {
	return process.env.HOME || process.env.USERPROFILE || "";
}
