import { createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { ExtensionSource } from "../src/shared/contracts";
import { sanitizeCookies, type SessionCookie } from "../src/shared/youtube-cookies";

// What the sign-in screen shows. The IPC contract owns this shape (`src/shared/contracts.ts`), and the
// server is its only producer, so it is imported rather than restated: a field renamed in one place
// then fails to typecheck here rather than desynchronising silently.
export type ExtensionConnection = ExtensionSource;

// A line past this is a peer that is not our host, so it is dropped rather than buffered.
const MAX_LINE = 256 * 1024;
// More than a handful of browsers connected at once is not a real desktop, it is something wrong.
const MAX_CONNECTIONS = 8;
// The ceiling on sockets open at once, most of them pre-handshake: a local process can find the pipe
// name (it is enumerable) but not the token, so this bounds what an unauthenticated peer can hold.
const MAX_SOCKETS = 32;
// A socket that has not passed the token handshake within this is a peer that never will.
const HANDSHAKE_TIMEOUT_MS = 5000;
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAIRING_SECRET = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const AUTH_CONTEXT = "nixie-link pull authentication v1\0";
const ENCRYPTION_CONTEXT = "nixie-link cookie encryption v1\0";
const BROWSERS = new Set(["Google Chrome", "Microsoft Edge", "Brave", "Vivaldi", "Opera", "Chromium", "Chrome"]);

interface Connection extends ExtensionConnection {
	socket: Socket;
}

interface PendingPull {
	installId: string;
	nonce: string;
	secret: Buffer;
	socket: Socket;
	resolve: (cookies: SessionCookie[]) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

function decodeSecret(value: string) {
	if (!PAIRING_SECRET.test(value)) return;
	const secret = Buffer.from(value, "base64url");
	return secret.length === 32 && secret.toString("base64url") === value ? secret : undefined;
}

function derivedKey(context: string, secret: Buffer) {
	return createHash("sha256").update(context).update(secret).digest();
}

function pullProof(id: number, nonce: string, installId: string, secret: Buffer) {
	return createHmac("sha256", derivedKey(AUTH_CONTEXT, secret))
		.update(`pull\0${id}\0${nonce}\0${installId}`)
		.digest("base64url");
}

/**
 * The one inbound surface this app has. A browser extension reads its own YouTube cookies and hands
 * them here through the native host, which connects to a per-user pipe. On macOS and Linux the socket
 * sits inside a `0o700` userData directory and the token is belt and braces; on Windows a named pipe
 * carries a default DACL that lets any local process connect and node exposes no way to set one, so
 * the pipe name is randomised per install and the first line has to carry a token only this user can
 * read (the config file is `0o600` inside their own profile). The pipe gate is separate from cookie
 * access: every pull is authenticated with the user-paired secret and each cookie payload is
 * AES-256-GCM ciphertext that is bound to its request and socket.
 */
export class NativeHostServer {
	readonly #connections = new Map<string, Connection>();
	readonly #pending = new Map<number, PendingPull>();
	readonly #listeners = new Set<(connections: ExtensionConnection[]) => void>();
	readonly #sockets = new Set<Socket>();
	#server: Server | undefined;
	#token = "";
	#pipe = "";
	#allowedOrigins: string[] = [];
	#nextId = 1;

	/** The pipe path and the token the native host manifest points the browser at. */
	get config() {
		return { pipe: this.#pipe, token: this.#token, allowedOrigins: this.#allowedOrigins };
	}

	async listen(userDataPath: string, allowedOrigins: string[]) {
		this.#allowedOrigins = allowedOrigins;
		this.#token = randomBytes(32).toString("base64url");
		this.#pipe =
			process.platform === "win32"
				? `\\\\.\\pipe\\nixie-${randomBytes(8).toString("hex")}`
				: join(userDataPath, "native-host", "nixie-host.sock");
		const dir = join(userDataPath, "native-host");
		await mkdir(dir, { recursive: true, mode: 0o700 });
		await writeFile(join(dir, "config.json"), JSON.stringify(this.config), { mode: 0o600 });
		await this.#reclaim();

		await new Promise<void>((resolve, reject) => {
			this.#server = createServer((socket) => this.#accept(socket));
			this.#server.on("error", reject);
			this.#server.listen(this.#pipe, resolve);
		});
	}

	/**
	 * A unix socket file is not removed on a crash, and node will not listen over a stale one, so a
	 * single non-graceful exit would leave `listen` throwing EADDRINUSE forever and the extension path
	 * silently dead. The file is unlinked only when nothing answers on it: a socket another live
	 * instance is serving is left alone, so `listen` fails honestly rather than stealing it. Windows
	 * pipes are named per run and vanish with the process, so this is POSIX only.
	 */
	async #reclaim() {
		if (process.platform === "win32") return;
		const answered = await new Promise<boolean>((resolve) => {
			const probe = connect(this.#pipe);
			probe.on("connect", () => {
				probe.destroy();
				resolve(true);
			});
			probe.on("error", () => resolve(false));
		});
		if (!answered) await unlink(this.#pipe).catch(() => undefined);
	}

	/** Closes the server, drops every connection and pending pull, and removes the socket file. */
	async close() {
		for (const { reject, timer } of this.#pending.values()) {
			clearTimeout(timer);
			reject(new Error("Native host closed"));
		}
		this.#pending.clear();
		for (const socket of this.#sockets) socket.destroy();
		this.#sockets.clear();
		this.#connections.clear();
		await new Promise<void>((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
		if (process.platform !== "win32") await unlink(this.#pipe).catch(() => undefined);
	}

	connections(): ExtensionConnection[] {
		return [...this.#connections.values()].map(({ installId, browser, signedIn }) => ({
			installId,
			browser,
			signedIn,
		}));
	}

	onChange(listener: (connections: ExtensionConnection[]) => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** The cookies that profile holds now, pulled through the extension, or a rejection on timeout. */
	async pull(installId: string, pairingSecret: string, timeoutMs = 4000): Promise<SessionCookie[]> {
		const connection = this.#connections.get(installId);
		if (!connection) throw new Error("Extension not connected");
		const secret = decodeSecret(pairingSecret);
		if (!secret) throw new Error("Invalid extension pairing code");
		const id = this.#nextId++;
		const nonce = randomBytes(16).toString("base64url");
		return new Promise<SessionCookie[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error("Extension pull timed out"));
			}, timeoutMs);
			this.#pending.set(id, { installId, nonce, secret, socket: connection.socket, resolve, reject, timer });
			connection.socket.write(
				`${JSON.stringify({ type: "pull", id, nonce, proof: pullProof(id, nonce, installId, secret) })}\n`
			);
		});
	}

	#accept(socket: Socket) {
		// The pipe name is discoverable (\\.\pipe\ is enumerable), so the token is the only real gate and
		// everything before it has to be bounded: a cap on open sockets, a handshake deadline, and a hard
		// limit on how much is buffered before a newline, since a peer that never sends one would grow the
		// buffer without limit ahead of any authentication.
		if (this.#sockets.size >= MAX_SOCKETS) return socket.destroy();
		this.#sockets.add(socket);
		let installId: string | undefined;
		let buffer = "";
		let handshaken = false;
		const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			if (buffer.length > MAX_LINE) return socket.destroy();
			let index: number;
			while ((index = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				let message: unknown;
				try {
					message = JSON.parse(line);
				} catch {
					return socket.destroy();
				}
				if (!handshaken) {
					if (!this.#handshake(message)) return socket.destroy();
					handshaken = true;
					clearTimeout(handshakeTimer);
					continue;
				}
				// One hello per socket, refused before it registers anything: a second would add a
				// connection whose close this socket's own close does not drop, orphaning it in the map
				// behind a dead socket.
				const type =
					typeof message === "object" && message !== null ? (message as Record<string, unknown>).type : undefined;
				if (type === "hello" && installId) return socket.destroy();
				installId = this.#dispatch(socket, message, installId) ?? installId;
			}
		});
		socket.on("close", () => {
			clearTimeout(handshakeTimer);
			this.#sockets.delete(socket);
			if (installId && this.#connections.get(installId)?.socket === socket) {
				this.#connections.delete(installId);
				this.#emit();
			}
			for (const [id, waiter] of this.#pending) {
				if (waiter.socket !== socket) continue;
				this.#pending.delete(id);
				clearTimeout(waiter.timer);
				waiter.reject(new Error("Extension disconnected"));
			}
		});
		socket.on("error", () => socket.destroy());
	}

	#handshake(message: unknown): boolean {
		if (typeof message !== "object" || message === null) return false;
		const record = message as Record<string, unknown>;
		if (record.v !== 1 || typeof record.origin !== "string" || !this.#allowedOrigins.includes(record.origin)) {
			return false;
		}
		if (typeof record.token !== "string") return false;
		const given = Buffer.from(record.token);
		const expected = Buffer.from(this.#token);
		return given.length === expected.length && timingSafeEqual(given, expected);
	}

	/** Returns the installId a hello registered, so the socket's close can drop it. */
	#dispatch(socket: Socket, message: unknown, installId?: string): string | undefined {
		if (typeof message !== "object" || message === null) return undefined;
		const record = message as Record<string, unknown>;
		if (record.type === "hello") return this.#hello(socket, record);
		if (record.type === "status") this.#status(socket, installId, record);
		if (record.type === "cookies") this.#cookies(socket, record);
		return undefined;
	}

	#hello(socket: Socket, record: Record<string, unknown>): string | undefined {
		const installId = record.installId;
		if (typeof installId !== "string" || !INSTALL_ID.test(installId)) {
			socket.destroy();
			return undefined;
		}
		const browser = typeof record.browser === "string" && BROWSERS.has(record.browser) ? record.browser : "Chromium";
		const signedIn = record.signedIn === true;
		if (this.#connections.size >= MAX_CONNECTIONS && !this.#connections.has(installId)) {
			socket.destroy();
			return undefined;
		}
		this.#connections.get(installId)?.socket.destroy();
		this.#connections.set(installId, { socket, installId, browser, signedIn });
		this.#emit();
		return installId;
	}

	#status(socket: Socket, installId: string | undefined, record: Record<string, unknown>) {
		if (record.installId !== installId || !installId) return;
		const connection = this.#connections.get(installId);
		if (!connection || connection.socket !== socket || typeof record.signedIn !== "boolean") return;
		connection.signedIn = record.signedIn;
		this.#emit();
	}

	#cookies(socket: Socket, record: Record<string, unknown>) {
		const id = record.id;
		if (typeof id !== "number" || !Number.isSafeInteger(id)) return;
		const waiter = this.#pending.get(id);
		if (!waiter || waiter.socket !== socket || record.nonce !== waiter.nonce) return;
		if (
			typeof record.iv !== "string" ||
			!BASE64URL.test(record.iv) ||
			typeof record.ciphertext !== "string" ||
			!BASE64URL.test(record.ciphertext)
		) {
			return;
		}
		let cookies: SessionCookie[] | undefined;
		try {
			const iv = Buffer.from(record.iv, "base64url");
			const encrypted = Buffer.from(record.ciphertext, "base64url");
			if (iv.length !== 12 || encrypted.length < 16) return;
			const decipher = createDecipheriv("aes-256-gcm", derivedKey(ENCRYPTION_CONTEXT, waiter.secret), iv);
			decipher.setAAD(Buffer.from(`cookies\0${id}\0${waiter.nonce}\0${waiter.installId}`));
			decipher.setAuthTag(encrypted.subarray(-16));
			const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
			cookies = sanitizeCookies(JSON.parse(plain.toString("utf8")));
		} catch {
			return;
		}
		// A malformed answer is left to time out rather than resolved with a bad session or cleared into
		// silence, which is the same failure a browser that closed mid-pull produces. Only a valid answer
		// settles the promise and cancels its timer.
		if (!cookies) return;
		this.#pending.delete(id);
		clearTimeout(waiter.timer);
		waiter.resolve(cookies);
	}

	#emit() {
		const snapshot = this.connections();
		for (const listener of this.#listeners) listener(snapshot);
	}
}
