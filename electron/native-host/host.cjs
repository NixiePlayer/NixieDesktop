"use strict";

// The native messaging host. The browser launches it, not the app, so it is a relay and holds
// nothing: it validates the calling extension and a shared token, then moves JSON between the
// browser (Chrome native messaging framing, on stdio) and the running Nixie app (newline-delimited
// JSON, over a per-user pipe). Cookies only ever travel browser to app; the app sends pull requests
// and never a cookie value, which is what keeps this a relay rather than a place a secret rests.
//
// CommonJS with no dependency beyond node built-ins on purpose: it runs under the packaged Electron
// binary with ELECTRON_RUN_AS_NODE set, and `frame`/`reader` are exported so the framing is unit
// tested without spawning anything.

const net = require("node:net");
const { readFileSync } = require("node:fs");

// Far above a cookie payload, far below anything worth buffering: a frame past this is a peer that is
// not the browser, and it ends the process rather than growing memory.
const MAX_FRAME = 256 * 1024;
// Holds the MV3 service worker open while the app runs: a message over the port resets its idle timer.
const HEARTBEAT_MS = 20_000;

/** Chrome native messaging: a 4-byte little-endian length prefix, then UTF-8 JSON. */
function frame(message) {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	const header = Buffer.allocUnsafe(4);
	header.writeUInt32LE(body.length, 0);
	return Buffer.concat([header, body]);
}

/** Returns a feeder: hand it stdin chunks, it calls onMessage once per complete frame. */
function reader(onMessage, onFatal) {
	let buffer = Buffer.alloc(0);
	return (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			if (buffer.length < 4) return;
			const length = buffer.readUInt32LE(0);
			if (length > MAX_FRAME) return onFatal("frame too large");
			if (buffer.length < 4 + length) return;
			const body = buffer.subarray(4, 4 + length);
			buffer = buffer.subarray(4 + length);
			try {
				onMessage(JSON.parse(body.toString("utf8")));
			} catch {
				return onFatal("unparseable frame");
			}
		}
	};
}

function main() {
	const configArg = process.argv.find((arg) => arg.startsWith("--config="));
	if (!configArg) process.exit(1);
	const config = JSON.parse(readFileSync(configArg.slice("--config=".length), "utf8"));

	// Chrome passes the calling extension's origin as an argument. The browser has already checked it
	// against the host manifest's allowed_origins; this is the same check on our side of it, so a
	// manifest another program widened cannot widen this.
	const origin = process.argv.find((arg) => arg.startsWith("chrome-extension://"));
	if (!origin || !config.allowedOrigins.includes(origin)) process.exit(1);

	const socket = net.connect(config.pipe);
	// The app is not running: leave without a word rather than retrying. The extension's own alarm is
	// the retry, at one attempt a minute.
	socket.on("error", () => process.exit(0));
	socket.on("close", () => process.exit(0));
	socket.setEncoding("utf8");
	// The browser is gone: an EPIPE on the write back is a clean exit rather than an uncaught throw.
	process.stdout.on("error", () => process.exit(0));

	socket.on("connect", () => {
		socket.write(`${JSON.stringify({ v: 1, token: config.token, origin })}\n`);
	});

	// App to browser: pull requests, and nothing carrying a cookie. Each becomes one framed message
	// on stdout, which is the extension's stdin.
	let pending = "";
	socket.on("data", (text) => {
		pending += text;
		if (pending.length > MAX_FRAME) process.exit(1);
		let index;
		while ((index = pending.indexOf("\n")) !== -1) {
			const line = pending.slice(0, index);
			pending = pending.slice(index + 1);
			if (line.length > MAX_FRAME) process.exit(1);
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				process.exit(1);
			}
			process.stdout.write(frame(message));
		}
	});

	const beat = setInterval(() => process.stdout.write(frame({ type: "ping" })), HEARTBEAT_MS);
	beat.unref();

	// Browser to app: a verbatim relay, one line of JSON per frame. The host parses nothing about the
	// contents and holds nothing.
	process.stdin.on(
		"data",
		reader(
			(message) => socket.write(`${JSON.stringify(message)}\n`),
			() => process.exit(1)
		)
	);
	process.stdin.on("end", () => process.exit(0));
}

module.exports = { frame, reader };

// A missing, truncated (the app mid-write) or older-schema config throws in the synchronous setup, and
// a stack trace on stderr carries the config path into Chrome's own log. Exit quietly instead.
if (require.main === module) {
	try {
		main();
	} catch {
		process.exit(1);
	}
}
