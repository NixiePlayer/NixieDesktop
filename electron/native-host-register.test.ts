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

	it("execs with the environment variable inline on a POSIX shell", () => {
		const script = wrapperScript("linux", "/opt/nixie/nixie", "/opt/nixie/host.cjs", "/home/x/config.json");
		expect(script.startsWith("#!/bin/sh")).toBe(true);
		expect(script).toContain(
			'ELECTRON_RUN_AS_NODE=1 exec "/opt/nixie/nixie" "/opt/nixie/host.cjs" "--config=/home/x/config.json" "$@"'
		);
		expect(script).not.toContain("\r\n");
	});
});
