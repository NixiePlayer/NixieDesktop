import { runInNewContext } from "node:vm";

interface Job {
	id: string;
	source: string;
	environment: Record<string, string | number | boolean | null | undefined>;
}

process.parentPort.on("message", ({ data }: { data: Job }) => {
	try {
		const sandbox = Object.assign(Object.create(null), data.environment);
		const result: unknown = runInNewContext(`(function () { "use strict";\n${data.source}\n})()`, sandbox, {
			timeout: 750,
			contextCodeGeneration: { strings: false, wasm: false },
		});
		process.parentPort.postMessage({ id: data.id, result });
	} catch (error) {
		process.parentPort.postMessage({
			id: data.id,
			error: error instanceof Error ? error.message : "Evaluation failed",
		});
	}
});

// Sent once the runtime has booted and the listener above is in place, which is what the parent's
// spawn budget waits for: the boot is the slow part on Windows, and it is not the evaluation's.
process.parentPort.postMessage({ ready: true });
