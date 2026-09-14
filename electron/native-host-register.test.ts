import { describe, expect, it } from "vitest";
import { hostTargets, wrapperScript } from "./native-host-register";

const NAME = "com.theedoran.nixie";

describe("hostTargets", () => {
	it("names a registry key per browser on Windows and no manifest file", () => {
		const targets = hostTargets("win32", {}, "C:\\Users\\x", NAME);
		expect(targets).toHaveLength(5);
		expect(targets.every((target) => target.registryKey && !target.manifestPath)).toBe(true);
		expect(targets[0]?.registryKey).toBe(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NAME}`);
		expect(targets[1]?.registryKey).toBe(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NAME}`);
	});

	it("names a manifest file per browser under Application Support on macOS", () => {
		const targets = hostTargets("darwin", {}, "/Users/x", NAME);
		expect(targets.every((target) => target.manifestPath && !target.registryKey)).toBe(true);
		expect(targets[0]?.manifestPath).toBe(
			`/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts/${NAME}.json`
		);
	});

	it("names a manifest file under .config on Linux, honouring XDG_CONFIG_HOME", () => {
		expect(hostTargets("linux", {}, "/home/x", NAME)[4]?.manifestPath).toBe(
			`/home/x/.config/chromium/NativeMessagingHosts/${NAME}.json`
		);
		expect(hostTargets("linux", { XDG_CONFIG_HOME: "/cfg" }, "/home/x", NAME)[0]?.manifestPath).toBe(
			`/cfg/google-chrome/NativeMessagingHosts/${NAME}.json`
		);
	});
});

describe("wrapperScript", () => {
	it("runs the Electron binary as Node with CRLF on Windows", () => {
		const script = wrapperScript("win32", "C:\\Nixie\\Nixie.exe", "C:\\res\\host.cjs", "C:\\data\\config.json");
		expect(script).toContain("set ELECTRON_RUN_AS_NODE=1");
		expect(script).toContain(`"C:\\Nixie\\Nixie.exe" "C:\\res\\host.cjs" "--config=C:\\data\\config.json"`);
		expect(script).toContain("\r\n");
	});

	it("disables delayed expansion before any path is read, so a `!NAME!` in one survives", () => {
		const script = wrapperScript("win32", "C:\\Users\\!x!\\Nixie.exe", "C:\\res\\host.cjs", "C:\\data\\config.json");
		const lines = script.split("\r\n");
		expect(lines.indexOf("setlocal DisableDelayedExpansion")).toBe(1);
		expect(lines.indexOf("set ELECTRON_RUN_AS_NODE=1")).toBe(2);
		expect(script).toContain(`"C:\\Users\\!x!\\Nixie.exe"`);
	});

	const ROOTS = {
		LOCALAPPDATA: "C:\\Users\\Jörg\\AppData\\Local",
		APPDATA: "C:\\Users\\Jörg\\AppData\\Roaming",
		USERPROFILE: "C:\\Users\\Jörg",
	};

	it.each([
		{
			name: "leaves an ASCII path outside every root literal",
			path: "C:\\Nixie\\Nixie.exe",
			expected: "C:\\Nixie\\Nixie.exe",
		},
		{
			name: "rewrites a path under LOCALAPPDATA to the variable, whatever the case",
			path: "c:\\users\\JÖRG\\appdata\\local\\Programs\\Nixie\\Nixie.exe",
			expected: "%LOCALAPPDATA%\\Programs\\Nixie\\Nixie.exe",
		},
		{
			name: "prefers the longest root over USERPROFILE and doubles a percent in the remainder",
			path: "C:\\Users\\Jörg\\AppData\\Roaming\\Nixie\\100%\\config.json",
			expected: "%APPDATA%\\Nixie\\100%%\\config.json",
		},
		{
			name: "leaves a non-ASCII path outside every root literal",
			path: "D:\\Jörg\\Nixie.exe",
			expected: "D:\\Jörg\\Nixie.exe",
		},
	])("$name", ({ path, expected }) => {
		const script = wrapperScript("win32", path, "C:\\res\\host.cjs", "C:\\data\\config.json", ROOTS);
		expect(script).toContain(`"${expected}" "C:\\res\\host.cjs"`);
	});

	it("writes a launcher under the per-user roots with no non-ASCII byte in it", () => {
		const script = wrapperScript(
			"win32",
			`${ROOTS.LOCALAPPDATA}\\Programs\\Nixie\\Nixie.exe`,
			`${ROOTS.LOCALAPPDATA}\\Programs\\Nixie\\resources\\native-host\\host.cjs`,
			`${ROOTS.APPDATA}\\Nixie\\native-host\\config.json`,
			ROOTS
		);
		expect(Buffer.byteLength(script)).toBe(script.length);
		expect(script).toContain(`"--config=%APPDATA%\\Nixie\\native-host\\config.json" %*`);
	});

	it("execs with the environment variable inline on a POSIX shell", () => {
		const script = wrapperScript("linux", "/opt/nixie/nixie", "/opt/nixie/host.cjs", "/home/x/config.json");
		expect(script.startsWith("#!/bin/sh")).toBe(true);
		expect(script).toContain(
			`ELECTRON_RUN_AS_NODE=1 exec '/opt/nixie/nixie' '/opt/nixie/host.cjs' '--config=/home/x/config.json' "$@"`
		);
		expect(script).not.toContain("\r\n");
	});

	it("quotes POSIX launcher paths as data", () => {
		const script = wrapperScript("linux", "/opt/nixie's/$app", "/res/`host`.cjs", "/home/a b/config.json");
		expect(script).toContain(
			"exec '/opt/nixie'\"'\"'s/$app' '/res/`host`.cjs' '--config=/home/a b/config.json' \"$@\""
		);
	});
});
