import { mkdtemp, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NativeHostServer } from "./native-host-server";

const ORIGIN = "chrome-extension://pgknibkmcmahfafgbkndpkkcpciigleb/";
const INSTALL_ID = "12345678-1234-4123-8123-1234567890ab";

function cookie(name = "SAPISID", value = "abc123") {
	return {
		name,
		value,
		domain: ".youtube.com",
		path: "/",
		secure: true,
		httpOnly: false,
		expirationDate: 1_800_000_000,
	};
}

/** A line-speaking client, standing in for the native host relay. */
function client(pipe: string) {
	const socket = connect(pipe);
	socket.setEncoding("utf8");
	const messages: Record<string, unknown>[] = [];
	const waiters: ((message: Record<string, unknown>) => void)[] = [];
	let buffer = "";
	socket.on("data", (chunk: string) => {
		buffer += chunk;
		let index: number;
		while ((index = buffer.indexOf("\n")) !== -1) {
			const message = JSON.parse(buffer.slice(0, index));
			buffer = buffer.slice(index + 1);
			const waiter = waiters.shift();
			if (waiter) waiter(message);
			else messages.push(message);
		}
	});
	return {
		socket,
		send: (message: unknown) => socket.write(`${JSON.stringify(message)}\n`),
		next: () =>
			new Promise<Record<string, unknown>>((resolve) => {
				const queued = messages.shift();
				if (queued) resolve(queued);
				else waiters.push(resolve);
			}),
		ready: () => new Promise<void>((resolve) => socket.on("connect", resolve)),
	};
}

describe("NativeHostServer", () => {
	let server: NativeHostServer;
	let dir: string;
	const sockets: Socket[] = [];

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nixie-host-"));
		server = new NativeHostServer();
		await server.listen(dir, [ORIGIN]);
	});

	afterEach(async () => {
		for (const socket of sockets) socket.destroy();
		sockets.length = 0;
		await server.close();
		await rm(dir, { recursive: true, force: true });
	});

	async function handshake(signedIn = true) {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: server.config.token, origin: ORIGIN });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Google Chrome", signedIn, cookies: [cookie()] });
		return peer;
	}

	it("registers a profile after a valid handshake and hello", async () => {
		await handshake();
		await vi_poll(() => server.connections().length === 1);
		expect(server.connections()[0]).toEqual({ installId: INSTALL_ID, browser: "Google Chrome", signedIn: true });
	});

	it("round-trips a pull through the connected client", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, 2000);
		const request = await peer.next();
		expect(request.type).toBe("pull");
		peer.send({ type: "cookies", id: request.id, cookies: [cookie("SID", "xyz")] });
		const cookies = await pulled;
		expect(cookies).toHaveLength(1);
		expect(cookies[0]?.name).toBe("SID");
	});

	it("refuses a handshake with the wrong token", async () => {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: "wrong", origin: ORIGIN });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Chrome", signedIn: true, cookies: [cookie()] });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.connections()).toHaveLength(0);
	});

	it("refuses a handshake from an unlisted origin", async () => {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: server.config.token, origin: "chrome-extension://someoneelse/" });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Chrome", signedIn: true, cookies: [cookie()] });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.connections()).toHaveLength(0);
	});

	it("does not resolve a pull whose answer is malformed", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, 150);
		const request = await peer.next();
		peer.send({ type: "cookies", id: request.id, cookies: [cookie("TRACKING", "x")] });
		await expect(pulled).rejects.toThrow(/timed out/);
	});

	it("drops the socket on a second hello rather than orphaning the first registration", async () => {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: server.config.token, origin: ORIGIN });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Google Chrome", signedIn: true, cookies: [cookie()] });
		await vi_poll(() => server.connections().length === 1);
		peer.send({
			type: "hello",
			installId: "abcdef12-1234-4123-8123-1234567890ab",
			browser: "Brave",
			signedIn: true,
			cookies: [cookie()],
		});
		await vi_poll(() => server.connections().length === 0);
		expect(server.connections()).toHaveLength(0);
	});
});

/** Polls a predicate to let the server's own async socket events settle. */
async function vi_poll(predicate: () => boolean, timeoutMs = 1000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
