import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalLogger } from "./logger";

const paths: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "nixie-logger-test-"));
	paths.push(path);
	return path;
}

describe("LocalLogger", () => {
	it("serializes writes, caps reports, survives restart, and excludes legacy logs", async () => {
		const path = await directory();
		const logger = new LocalLogger(path);
		await logger.write("info", "Application started");
		await writeFile(join(path, "logs", "nixie.log"), "old unsafe content");
		await Promise.all(Array.from({ length: 100 }, (_, index) => logger.write("warn", `event ${index}`)));
		const report = await new LocalLogger(path).recent();
		expect(report.split("\n")).toHaveLength(100);
		expect(report).not.toContain("old unsafe content");
		expect(report).not.toContain("Application started");
		expect(report).toContain("event 99");
	});
	it("records only safe error metadata and falls back to memory when disk writes fail", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const path = await directory();
		await writeFile(join(path, "logs"), "not a directory");
		const logger = new LocalLogger(path);
		await expect(
			logger.failure("connection", Object.assign(new Error("secret C:\\Users\\Person"), { code: "EACCES" }))
		).resolves.toBeUndefined();
		expect(await logger.recent()).toContain("connection: Error / EACCES");
		expect(await logger.recent()).not.toContain("secret");
		expect(await logger.recent()).toContain("current session only");
	});
	it("rotates in order and keeps only one previous log", async () => {
		const path = await directory();
		await mkdir(join(path, "logs"));
		await writeFile(join(path, "logs", "diagnostics.log"), "x".repeat(1_000_000));
		await writeFile(join(path, "logs", "diagnostics.log.1"), "older");
		const logger = new LocalLogger(path);
		await Promise.all([logger.write("info", "first"), logger.write("info", "second")]);
		expect((await readFile(join(path, "logs", "diagnostics.log.1"), "utf8")).length).toBe(1_000_000);
		const content = await readFile(join(path, "logs", "diagnostics.log"), "utf8");
		expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
	});
});
