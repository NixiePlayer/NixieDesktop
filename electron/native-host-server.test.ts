import { spawn } from "node:child_process";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NativeHostServer } from "./native-host-server";

const ORIGIN = "chrome-extension://pgknibkmcmahfafgbkndpkkcpciigleb/";
const INSTALL_ID = "12345678-1234-4123-8123-1234567890ab";
const OTHER_INSTALL_ID = "abcdef12-1234-4123-8123-1234567890ab";
const SECRET_BYTES = Buffer.alloc(32, 7);
const SECRET = SECRET_BYTES.toString("base64url");
const AUTH_CONTEXT = "nixie-link pull authentication v1\0";
const ENCRYPTION_CONTEXT = "nixie-link cookie encryption v1\0";

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

function derivedKey(context: string) {
	return createHash("sha256").update(context).update(SECRET_BYTES).digest();
}

/** `aad` overrides the bound nonce and install id, for an answer sealed against the wrong request. */
function encryptedAnswer(
	request: Record<string, unknown>,
	cookies: unknown,
	installId = INSTALL_ID,
	aad: { nonce?: string; installId?: string } = {}
) {
	const id = request.id as number;
	const nonce = request.nonce as string;
	const proof = createHmac("sha256", derivedKey(AUTH_CONTEXT))
		.update(`pull\0${id}\0${nonce}\0${installId}`)
		.digest("base64url");
	expect(request.proof).toBe(proof);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", derivedKey(ENCRYPTION_CONTEXT), iv);
	cipher.setAAD(Buffer.from(`cookies\0${id}\0${aad.nonce ?? nonce}\0${aad.installId ?? installId}`));
	const encrypted = Buffer.concat([cipher.update(JSON.stringify(cookies)), cipher.final(), cipher.getAuthTag()]);
	return { type: "cookies", id, nonce, iv: iv.toString("base64url"), ciphertext: encrypted.toString("base64url") };
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

	async function handshake(signedIn = true, installId = INSTALL_ID) {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: server.config.token, origin: ORIGIN });
		peer.send({ type: "hello", installId, browser: "Google Chrome", signedIn });
		return peer;
	}

	it("registers a profile after a valid handshake and hello", async () => {
		await handshake();
		await vi_poll(() => server.connections().length === 1);
		expect(server.connections()[0]).toEqual({ installId: INSTALL_ID, browser: "Google Chrome", signedIn: true });
	});

	it("authenticates the pull and decrypts its cookie payload", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, SECRET, 2000);
		const request = await peer.next();
		expect(request.type).toBe("pull");
		peer.send(encryptedAnswer(request, [cookie("SID", "xyz")]));
		await expect(pulled).resolves.toMatchObject([{ name: "SID", value: "xyz" }]);
	});

	it("accepts an authenticated empty payload as sign-out", async () => {
		const peer = await handshake(false);
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, SECRET, 2000);
		peer.send(encryptedAnswer(await peer.next(), []));
		await expect(pulled).resolves.toEqual([]);
	});

	it("binds a pull response to the socket it requested", async () => {
		const expected = await handshake();
		const attacker = await handshake(true, OTHER_INSTALL_ID);
		await vi_poll(() => server.connections().length === 2);
		const pulled = server.pull(INSTALL_ID, SECRET, 2000);
		const request = await expected.next();
		attacker.send(encryptedAnswer(request, [cookie("SID", "stolen")]));
		expected.send(encryptedAnswer(request, [cookie("SID", "real")]));
		await expect(pulled).resolves.toMatchObject([{ value: "real" }]);
	});

	it("refuses a handshake with the wrong token", async () => {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: "wrong", origin: ORIGIN });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Chrome", signedIn: true });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.connections()).toHaveLength(0);
	});

	it("refuses a handshake from an unlisted origin", async () => {
		const peer = client(server.config.pipe);
		sockets.push(peer.socket);
		await peer.ready();
		peer.send({ v: 1, token: server.config.token, origin: "chrome-extension://someoneelse/" });
		peer.send({ type: "hello", installId: INSTALL_ID, browser: "Chrome", signedIn: true });
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(server.connections()).toHaveLength(0);
	});

	it("does not resolve a pull whose encrypted answer is malformed", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, SECRET, 150);
		peer.send(encryptedAnswer(await peer.next(), [cookie("TRACKING", "x")]));
		await expect(pulled).rejects.toThrow(/timed out/);
	});

	it("updates sign-in status only from the registered socket", async () => {
		const expected = await handshake(false);
		const attacker = await handshake(false, OTHER_INSTALL_ID);
		await vi_poll(() => server.connections().length === 2);
		attacker.send({ type: "status", installId: INSTALL_ID, signedIn: true });
		expected.send({ type: "status", installId: INSTALL_ID, signedIn: true });
		await vi_poll(() => server.connections().find((source) => source.installId === INSTALL_ID)?.signedIn === true);
		expect(server.connections().find((source) => source.installId === INSTALL_ID)?.signedIn).toBe(true);
	});

	it("drops the socket on a second hello rather than orphaning the first registration", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		peer.send({ type: "hello", installId: OTHER_INSTALL_ID, browser: "Brave", signedIn: true });
		await vi_poll(() => server.connections().length === 0);
		expect(server.connections()).toHaveLength(0);
	});

	// Both are POSIX only: on Windows the pipe is named per run and `#reclaim` returns early, so there
	// is no stale file to reclaim and a second listen takes a fresh pipe instead of failing.
	it.skipIf(process.platform === "win32")("reclaims a stale socket file a crash left behind", async () => {
		const other = await mkdtemp(join(tmpdir(), "nixie-host-"));
		const stale = join(other, "native-host", "nixie-host.sock");
		// A killed process never unlinks its socket file, which is exactly what a crash leaves.
		await mkdir(join(other, "native-host"), { recursive: true });
		const crashed = spawn(process.execPath, [
			"-e",
			`require("node:net").createServer().listen(process.argv[1], () => process.stdout.write("up"))`,
			stale,
		]);
		const second = new NativeHostServer();
		try {
			await new Promise((resolve) => crashed.stdout.once("data", resolve));
			crashed.kill("SIGKILL");
			await new Promise((resolve) => crashed.once("exit", resolve));
			expect(existsSync(stale)).toBe(true);
			await expect(second.listen(other, [ORIGIN])).resolves.toBeUndefined();
		} finally {
			if (crashed.exitCode === null && crashed.signalCode === null) {
				crashed.kill("SIGKILL");
				await new Promise((resolve) => crashed.once("exit", resolve));
			}
			await second.close();
			await rm(other, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform === "win32")(
		"does not steal a socket another live instance serves, and leaves its config alone",
		async () => {
			const before = await readFile(join(dir, "native-host", "config.json"), "utf8");
			await expect(new NativeHostServer().listen(dir, [ORIGIN])).rejects.toMatchObject({ code: "EADDRINUSE" });
			expect(await readFile(join(dir, "native-host", "config.json"), "utf8")).toBe(before);
			await handshake();
			await vi_poll(() => server.connections().length === 1);
		}
	);

	it.each([
		{
			name: "a tampered GCM tag",
			tamper: (request: Record<string, unknown>) => {
				const answer = encryptedAnswer(request, [cookie()]);
				const bytes = Buffer.from(answer.ciphertext, "base64url");
				bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 0xff, bytes.length - 1);
				return { ...answer, ciphertext: bytes.toString("base64url") };
			},
		},
		{
			name: "an answer sealed against another nonce",
			tamper: (request: Record<string, unknown>) =>
				encryptedAnswer(request, [cookie()], INSTALL_ID, { nonce: "other-nonce" }),
		},
		{
			name: "an answer sealed against another install id",
			tamper: (request: Record<string, unknown>) =>
				encryptedAnswer(request, [cookie()], INSTALL_ID, { installId: OTHER_INSTALL_ID }),
		},
	])("ignores $name and lets the pull time out", async ({ tamper }) => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, SECRET, 150);
		peer.send(tamper(await peer.next()));
		await expect(pulled).rejects.toThrow(/timed out/);
	});

	it("rejects a pull whose socket disconnects mid-flight", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const pulled = server.pull(INSTALL_ID, SECRET, 2000);
		await peer.next();
		peer.socket.destroy();
		await expect(pulled).rejects.toThrow("Extension disconnected");
	});

	it("destroys a socket that sends a line longer than the cap", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		const closed = new Promise((resolve) => peer.socket.once("close", resolve));
		peer.socket.write("x".repeat(257 * 1024));
		await closed;
		await vi_poll(() => server.connections().length === 0);
	});

	it("destroys a socket that never sends the handshake once the deadline passes", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const peer = client(server.config.pipe);
			sockets.push(peer.socket);
			const closed = new Promise((resolve) => peer.socket.once("close", resolve));
			await peer.ready();
			// The server arms its deadline when it accepts, a turn or two behind the client's connect.
			while (vi.getTimerCount() === 0) await new Promise((resolve) => setImmediate(resolve));
			vi.advanceTimersByTime(5000);
			await closed;
		} finally {
			vi.useRealTimers();
		}
	});

	it("refuses a malformed pairing code before asking the extension anything", async () => {
		const peer = await handshake();
		await vi_poll(() => server.connections().length === 1);
		await expect(server.pull(INSTALL_ID, "not-a-pairing-code")).rejects.toThrow("Invalid extension pairing code");
		peer.send({ type: "status", installId: INSTALL_ID, signedIn: false });
		await vi_poll(() => server.connections()[0]?.signedIn === false);
	});
});

async function vi_poll(predicate: () => boolean, timeoutMs = 1000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
