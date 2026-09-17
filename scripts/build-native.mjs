import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

if (process.platform === "darwin") {
	// Node-API is ABI-stable across Node and Electron. The Node distribution already
	// ships these headers; no node-gyp, Electron headers or runtime dependency is needed.
	const headers = join(dirname(realpathSync(process.execPath)), "../include/node");
	if (!existsSync(join(headers, "node_api.h"))) throw new Error("Install Node 24 with its include/node headers.");
	const root = join(import.meta.dirname, "..");
	mkdirSync(join(root, "dist-native"), { recursive: true });
	execFileSync(
		"xcrun",
		[
			"clang",
			"-bundle",
			"-undefined",
			"dynamic_lookup",
			"-fobjc-arc",
			"-fblocks",
			"-DNAPI_VERSION=8",
			"-mmacosx-version-min=12.0",
			"-arch",
			"arm64",
			"-arch",
			"x86_64",
			"-I",
			headers,
			"-framework",
			"AppKit",
			join(root, "electron/native/scroll-gesture.m"),
			"-o",
			join(root, "dist-native/scroll-gesture.node"),
		],
		{ stdio: "inherit" }
	);
}
