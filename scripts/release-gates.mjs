const accepted = new Set((process.env.NEOTUNE_RELEASE_GATES_ACCEPTED ?? "").split(","));
for (const gate of ["auth", "range", "pcm", "lyrics-rights"]) {
	if (!accepted.has(gate)) fail(`Release gate not accepted: ${gate}`);
}

console.log("All Neotune release gates passed.");

function fail(message) {
	console.error(`Release blocked: ${message}`);
	process.exit(1);
}
