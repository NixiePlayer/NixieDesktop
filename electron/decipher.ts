import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess } from "electron";
import { Platform } from "youtubei.js";

type Primitive = string | number | boolean | null | undefined;

interface ScriptData {
	output: string;
}

export function configureRestrictedEvaluator() {
	Platform.load({ ...Platform.shim, eval: evaluateRestricted });
}

// Two budgets, not one. The evaluation is worth 1500 ms; the spawn is not part of it, and on a cold
// Windows machine (Defender's first touch of the binary, a cold page cache) the spawn alone can eat
// most of a single budget. When it did, the whole app refused to start behind verifyRestrictedEvaluator,
// naming a timeout rather than the wait it actually was. The evaluate timer is armed only once the
// child has spawned, so the two never share a clock.
const SPAWN_TIMEOUT_MS = 10_000;
const EVALUATE_TIMEOUT_MS = 1500;

export async function evaluateRestricted(data: ScriptData, environment: Record<string, Primitive>) {
	if (data.output.length > 2_000_000) throw new Error("Player evaluator input exceeds its limit");
	const workerPath = join(import.meta.dirname, "decipher-worker.js");
	const child = utilityProcess.fork(workerPath, [], {
		serviceName: "Nixie Decipher Evaluator",
		stdio: "ignore",
		// No `env` option. Electron only clears the child's environment when the map is non-empty, so
		// `env: {}` cleared nothing on any platform and was a lie in the code; a genuinely empty
		// environment is also what a Windows child process cannot start from.
		execArgv: ["--permission", `--allow-fs-read=${workerPath}`],
	});
	const id = randomUUID();
	const result = await new Promise<unknown>((resolve, reject) => {
		let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
		const spawnTimer = setTimeout(() => {
			child.kill();
			reject(new Error("Restricted evaluator failed to spawn in time"));
		}, SPAWN_TIMEOUT_MS);
		child.once("spawn", () => {
			clearTimeout(spawnTimer);
			evaluateTimer = setTimeout(() => {
				child.kill();
				reject(new Error("Restricted evaluator timed out"));
			}, EVALUATE_TIMEOUT_MS);
			child.postMessage({ id, source: data.output, environment });
		});
		child.once("message", (message: unknown) => {
			clearTimeout(evaluateTimer);
			if (typeof message !== "object" || message === null || !("id" in message) || message.id !== id) {
				reject(new Error("Restricted evaluator returned an invalid response"));
				return;
			}
			if ("error" in message) reject(new Error(String(message.error)));
			else resolve("result" in message ? message.result : undefined);
		});
		child.once("exit", (code) => {
			clearTimeout(spawnTimer);
			clearTimeout(evaluateTimer);
			if (code !== 0) reject(new Error(`Restricted evaluator exited with ${code}`));
		});
	});
	child.kill();
	return result;
}
