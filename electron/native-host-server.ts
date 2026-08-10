import { randomBytes, timingSafeEqual } from "node:crypto";
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
const INSTALL_ID = /^[0-9a-f-]{36}$/;
const BROWSERS = new Set(["Google Chrome", "Microsoft Edge", "Brave", "Vivaldi", "Opera", "Chromium", "Chrome"]);

interface Connection extends ExtensionConnection {
	socket: Socket;
}

/**
 * The one inbound surface this app has. A browser extension reads its own YouTube cookies and hands
 * them here through the native host, which connects to a per-user pipe. On macOS and Linux the socket
 * sits inside a `0o700` userData directory and the token is belt and braces; on Windows a named pipe
 * carries a default DACL that lets any local process connect and node exposes no way to set one, so
 * the pipe name is randomised per install and the first line has to carry a token only this user can
 * read (the config file is `0o600` inside their own profile). Nothing confidential travels outward on
 * this pipe: the app sends pull requests and never a cookie, so a process that guessed both could
 * offer this app a session and could never take one from it.
 */
export class NativeHostServer {
	readonly #connections = new Map<string, Connection>();
	readonly #pending = new Map<
		number,
		{ resolve: (cookies: SessionCookie[]) => void; timer: ReturnType<typeof setTimeout> }
	>();
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
		for (const { timer } of this.#pending.values()) clearTimeout(timer);
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
	async pull(installId: string, timeoutMs = 4000): Promise<SessionCookie[]> {
		const connection = this.#connections.get(installId);
		if (!connection) throw new Error("Extension not connected");
		const id = this.#nextId++;
		return new Promise<SessionCookie[]>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error("Extension pull timed out"));
			}, timeoutMs);
			this.#pending.set(id, { resolve, timer });
			connection.socket.write(`${JSON.stringify({ type: "pull", id })}\n`);
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
				installId = this.#dispatch(socket, message) ?? installId;
			}
		});
		socket.on("close", () => {
			clearTimeout(handshakeTimer);
			this.#sockets.delete(socket);
			if (installId && this.#connections.get(installId)?.socket === socket) {
				this.#connections.delete(installId);
				this.#emit();
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
	#dispatch(socket: Socket, message: unknown): string | undefined {
		if (typeof message !== "object" || message === null) return undefined;
		const record = message as Record<string, unknown>;
		if (record.type === "hello") return this.#hello(socket, record);
		if (record.type === "cookies") this.#cookies(record);
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
		// The hello carries the profile's cookies too, and they are deliberately ignored here: the session
		// comes from the pull the link makes in a moment, which is validated on arrival, so registration
		// only needs the identity and whether a session exists at all.
		if (this.#connections.size >= MAX_CONNECTIONS && !this.#connections.has(installId)) {
			socket.destroy();
			return undefined;
		}
		this.#connections.get(installId)?.socket.destroy();
		this.#connections.set(installId, { socket, installId, browser, signedIn });
		this.#emit();
		return installId;
	}

	#cookies(record: Record<string, unknown>) {
		const id = record.id;
		if (typeof id !== "number") return;
		const waiter = this.#pending.get(id);
		if (!waiter) return;
		const cookies = sanitizeCookies(record.cookies);
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
