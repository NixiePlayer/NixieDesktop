import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { diagnosticReason } from "../src/shared/diagnostics";

export class LocalLogger {
	readonly #path: string;
	#writing = Promise.resolve();
	#pending = 0;
	#recent: string[] = [];
	#diskFailed = false;

	constructor(userDataPath: string) {
		// Do not include legacy logs, which could contain raw upstream error messages.
		this.#path = join(userDataPath, "logs", "diagnostics.log");
	}

	failure(context: string, error: unknown, level: "warn" | "error" = "error") {
		return this.write(level, `${context}: ${diagnosticReason(error)}`);
	}

	/** Callers supply fixed descriptions and counts only, never upstream text or request arguments. */
	write(level: "info" | "warn" | "error", message: string) {
		const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
		this.#recent.push(line);
		this.#recent = this.#recent.slice(-100);
		if (level === "error") console.error(`[nixie] ${message}`);
		// ponytail: cap pending disk writes during an error storm; the last 100 remain in memory.
		if (this.#pending >= 100) return this.#writing;
		this.#pending++;
		this.#writing = this.#writing.then(async () => {
			try {
				await mkdir(dirname(this.#path), { recursive: true });
				await this.#rotate();
				await appendFile(this.#path, line, { mode: 0o600 });
			} catch {
				// A read-only or full disk must not change the operation being diagnosed.
				this.#diskFailed = true;
			} finally {
				this.#pending--;
			}
		});
		return this.#writing;
	}

	async recent() {
		await this.#writing;
		if (this.#diskFailed) return `Log file unavailable; current session only.\n${this.#recent.join("")}`;
		const files = await Promise.all(
			[`${this.#path}.1`, this.#path].map((path) => readFile(path, "utf8").catch(() => ""))
		);
		return files.join("").trim().split("\n").slice(-100).join("\n");
	}

	async #rotate() {
		const size = await stat(this.#path)
			.then((value) => value.size)
			.catch(() => 0);
		if (size < 1_000_000) return;
		await rename(this.#path, `${this.#path}.1`);
	}
}
