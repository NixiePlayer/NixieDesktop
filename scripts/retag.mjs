import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Moves the current version's tag onto HEAD, for a fix committed after the release bump. It reads the
// version out of package.json rather than taking one, since a mistyped version silently creates a
// second tag instead of moving the one that exists, and it repeats the `chore(release): v<version>`
// message `pnpm version` wrote, since `tag.gpgsign` makes every tag annotated and an annotated tag
// with no message is refused outright. Only ever run it on a tag that has not been pushed.
//
// This is a script rather than the POSIX one-liner it replaces (`V=$(node -p ...) && git tag ...`),
// which pnpm ran through `sh` and which has no equivalent on Windows, where development now happens.

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${version}`;

execFileSync("git", ["tag", "-f", "-m", `chore(release): ${tag}`, tag], { stdio: "inherit" });
