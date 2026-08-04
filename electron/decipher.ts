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

export async function evaluateRestricted(data: ScriptData, environment: Record<string, Primitive>) {
	if (data.output.length > 2_000_000) throw new Error("Player evaluator input exceeds its limit");
	const workerPath = join(import.meta.dirname, "decipher-worker.js");
	const child = utilityProcess.fork(workerPath, [], {
		serviceName: "Noctune Decipher Evaluator",
		stdio: "ignore",
		env: {},
		execArgv: ["--permission", `--allow-fs-read=${workerPath}`],
	});
	const id = randomUUID();
	const result = await new Promise<unknown>((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("Restricted evaluator timed out"));
		}, 1500);
		child.once("message", (message: unknown) => {
			clearTimeout(timeout);
			if (typeof message !== "object" || message === null || !("id" in message) || message.id !== id) {
				reject(new Error("Restricted evaluator returned an invalid response"));
				return;
			}
			if ("error" in message) reject(new Error(String(message.error)));
			else resolve("result" in message ? message.result : undefined);
		});
		child.once("exit", (code) => {
			if (code !== 0) reject(new Error(`Restricted evaluator exited with ${code}`));
		});
		child.postMessage({ id, source: data.output, environment });
	});
	child.kill();
	return result;
}
