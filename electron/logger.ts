import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const sensitive = /(cookie|authorization|googlevideo|signature|lyrics|media bytes)/gi;

export class LocalLogger {
	readonly #path: string;

	constructor(userDataPath: string) {
		this.#path = join(userDataPath, "logs", "nixie.log");
	}

	async write(level: "info" | "warn" | "error", message: string) {
		const safe = message.replaceAll(sensitive, "[redacted]").replaceAll(/https?:\/\/\S+/g, "[url]");
		// Errors also go to the terminal, so a `pnpm dev` session shows the failure without
		// exporting diagnostics first. The redacted string is the only thing that leaves here.
		if (level === "error") console.error(`[nixie] ${safe}`);
		await mkdir(dirname(this.#path), { recursive: true });
		await this.#rotate();
		await appendFile(this.#path, `${new Date().toISOString()} ${level.toUpperCase()} ${safe}\n`, { mode: 0o600 });
	}

	async export(destination: string) {
		const files = await readdir(dirname(this.#path)).catch(() => []);
		const content = await Promise.all(
			files
				.filter((name) => name.startsWith("nixie.log"))
				.map((name) => readFile(join(dirname(this.#path), name), "utf8"))
		);
		await writeFile(destination, content.join("\n"), { mode: 0o600 });
	}

	async #rotate() {
		const size = await stat(this.#path)
			.then((value) => value.size)
			.catch(() => 0);
		if (size < 1_000_000) return;
		await rename(`${this.#path}.2`, `${this.#path}.3`).catch(() => undefined);
		await rename(`${this.#path}.1`, `${this.#path}.2`).catch(() => undefined);
		await rename(this.#path, `${this.#path}.1`).catch(() => undefined);
	}
}
