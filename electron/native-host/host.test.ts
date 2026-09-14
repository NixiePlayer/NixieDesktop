import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

// host.cjs runs under Electron as Node and exports only its pure framing helpers. Required rather than
// imported so the CommonJS module's exports are reached without an interop wrapper.
const { frame, reader, relay } = createRequire(import.meta.url)("./host.cjs") as {
	frame: (message: unknown) => Buffer;
	reader: (onMessage: (message: unknown) => void, onFatal: (reason: string) => void) => (chunk: Buffer) => void;
	relay: (options: {
		socket: EventEmitter & { write: (line: string) => unknown };
		stdin: NodeJS.ReadableStream;
		stdout: { write: (chunk: Buffer) => unknown };
		handshake: unknown;
		exit: (code: number) => void;
	}) => void;
};

describe("frame", () => {
	it("writes a 4-byte little-endian length prefix then the JSON body", () => {
		const framed = frame({ type: "ping" });
		const length = framed.readUInt32LE(0);
		const body = framed.subarray(4).toString("utf8");
		expect(body).toBe(JSON.stringify({ type: "ping" }));
		expect(length).toBe(Buffer.byteLength(body));
	});
});

describe("reader", () => {
	it("delivers one message per complete frame", () => {
		const messages: unknown[] = [];
		const feed = reader((message) => messages.push(message), vi.fn());
		feed(frame({ a: 1 }));
		feed(frame({ b: 2 }));
		expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("reassembles a frame split across chunks", () => {
		const messages: unknown[] = [];
		const feed = reader((message) => messages.push(message), vi.fn());
		const framed = frame({ hello: "world" });
		feed(framed.subarray(0, 3));
		feed(framed.subarray(3, 6));
		feed(framed.subarray(6));
		expect(messages).toEqual([{ hello: "world" }]);
	});

	it("delivers two frames arriving in one chunk", () => {
		const messages: unknown[] = [];
		const feed = reader((message) => messages.push(message), vi.fn());
		feed(Buffer.concat([frame({ a: 1 }), frame({ b: 2 })]));
		expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("calls onFatal on an oversize frame rather than buffering it", () => {
		const onFatal = vi.fn();
		const feed = reader(() => {}, onFatal);
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32LE(1024 * 1024, 0);
		feed(header);
		expect(onFatal).toHaveBeenCalledWith("frame too large");
	});

	it("calls onFatal on an unparseable body", () => {
		const onFatal = vi.fn();
		const feed = reader(() => {}, onFatal);
		const body = Buffer.from("{not json", "utf8");
		const header = Buffer.allocUnsafe(4);
		header.writeUInt32LE(body.length, 0);
		feed(Buffer.concat([header, body]));
		expect(onFatal).toHaveBeenCalledWith("unparseable frame");
	});
});

describe("relay", () => {
	it("writes the handshake ahead of a hello the browser sent before the pipe was up", async () => {
		const writes: string[] = [];
		const socket = Object.assign(new EventEmitter(), { write: (line: string) => writes.push(line) });
		const stdin = new PassThrough();
		// The early hello: already on stdin before the socket exists, as it is when Chrome launches the
		// host and speaks first.
		stdin.write(frame({ type: "hello", installId: "x" }));
		relay({ socket, stdin, stdout: new PassThrough(), handshake: { v: 1, token: "t", origin: "o" }, exit: vi.fn() });
		await new Promise((resolve) => setImmediate(resolve));
		expect(writes).toEqual([
			`${JSON.stringify({ v: 1, token: "t", origin: "o" })}\n`,
			`${JSON.stringify({ type: "hello", installId: "x" })}\n`,
		]);
	});
});
