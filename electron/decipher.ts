import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import { Platform } from "youtubei.js";

type Primitive = string | number | boolean | null | undefined;

interface ScriptData {
	output: string;
}

/** A worker message, or `undefined` when the process went away before answering. */
type Settle = (message: object | undefined) => void;

interface Evaluator {
	child: UtilityProcess;
	waiting: Map<string, Settle>;
}

/** A fixed code as well as the message, so the log can say which way the evaluator failed. */
function failure(message: string, code: string) {
	return Object.assign(new Error(message), { code });
}

export function configureRestrictedEvaluator() {
	Platform.load({ ...Platform.shim, eval: evaluateRestricted });
}

// Two budgets, not one. The spawn budget runs until the worker says it is ready, which is the whole
// boot: `spawn` fires as soon as the process exists (0 ms on macOS), long before it can answer, so a
// budget armed there still charged the boot to the evaluation. The evaluation itself is a few
// milliseconds. Development gets a longer spawn budget: the first `pnpm dev` after a clone downloads
// the Electron binary and runs the Vite optimizer while this fork races them, which starved it past
// 10 s. A packaged build never downloads Electron, so 10 s there is a real failure, not contention.
const SPAWN_TIMEOUT_MS = process.env.VITE_DEV_SERVER_URL ? 30_000 : 10_000;
const EVALUATE_TIMEOUT_MS = 1500;

/**
 * One evaluator for the whole session, started on first use and replaced only once it exits or misses
 * a deadline. A process per evaluation made every stream resolve pay a full utility-process boot:
 * about 60 ms on an Apple Silicon Mac, but seconds on a busy Windows machine (process creation, the
 * antivirus scanning the image). The boot ran inside the evaluate budget, so a slow one failed the
 * attempt, `resolve` fell through to its next client and paid another boot, and the renderer's
 * 15 s play-start timeout fired while it was still trying. Evaluations stay isolated from each other:
 * each one runs in a fresh `vm` context, and the process boundary is what keeps the player script
 * away from the app, exactly as before.
 */
let current: Promise<Evaluator> | undefined;

function startEvaluator(): Promise<Evaluator> {
	const workerPath = join(import.meta.dirname, "decipher-worker.js");
	const child = utilityProcess.fork(workerPath, [], {
		serviceName: "Nixie Decipher Evaluator",
		stdio: "ignore",
		// No `env` option. Electron only clears the child's environment when the map is non-empty, so
		// `env: {}` cleared nothing on any platform and was a lie in the code; a genuinely empty
		// environment is also what a Windows child process cannot start from.
		execArgv: ["--permission", `--allow-fs-read=${workerPath}`],
	});
	const waiting = new Map<string, Settle>();
	const started = new Promise<Evaluator>((resolve, reject) => {
		const spawnTimer = setTimeout(() => {
			if (current === started) current = undefined;
			child.kill();
			reject(failure("Restricted evaluator failed to spawn in time", "EVALUATOR_SPAWN_TIMEOUT"));
		}, SPAWN_TIMEOUT_MS);
		child.on("message", (message: unknown) => {
			if (typeof message !== "object" || message === null) return;
			if ("ready" in message) {
				clearTimeout(spawnTimer);
				resolve({ child, waiting });
			} else if ("id" in message && typeof message.id === "string") {
				waiting.get(message.id)?.(message);
			}
		});
		// The gate at startup awaits an evaluation, so nothing may be left pending by a process that is
		// gone: a child that exits (a crash, a permission refusal, the kill below) settles everything it
		// held, and the next evaluation starts a fresh one.
		child.once("exit", (code) => {
			clearTimeout(spawnTimer);
			if (current === started) current = undefined;
			reject(failure(`Restricted evaluator exited with ${code}`, "EVALUATOR_EXITED"));
			for (const settle of waiting.values()) settle(undefined);
		});
	});
	return started;
}

export async function evaluateRestricted(data: ScriptData, environment: Record<string, Primitive>) {
	if (data.output.length > 2_000_000) throw new Error("Player evaluator input exceeds its limit");
	const evaluator = (current ??= startEvaluator());
	const { child, waiting } = await evaluator;
	const id = randomUUID();
	return new Promise<unknown>((resolve, reject) => {
		const evaluateTimer = setTimeout(() => {
			// The worker runs one job at a time, so one past its deadline may be stuck in it: the process
			// is retired rather than reused, and whatever else it held settles through its `exit`.
			waiting.delete(id);
			if (current === evaluator) current = undefined;
			child.kill();
			reject(failure("Restricted evaluator timed out", "EVALUATOR_TIMEOUT"));
		}, EVALUATE_TIMEOUT_MS);
		waiting.set(id, (message) => {
			clearTimeout(evaluateTimer);
			waiting.delete(id);
			if (!message) reject(failure("Restricted evaluator exited without answering", "EVALUATOR_EXITED"));
			// The message is whatever the player script threw, so the code is what the log keeps.
			else if ("error" in message) reject(failure(String(message.error), "EVALUATOR_FAILED"));
			else resolve("result" in message ? message.result : undefined);
		});
		child.postMessage({ id, source: data.output, environment });
	});
}
