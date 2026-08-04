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
