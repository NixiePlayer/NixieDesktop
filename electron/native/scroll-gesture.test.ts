import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

// Capture the real AppKit monitor's handler. The probe supplies native samples without
// moving the user's pointer, reading global input or requesting Accessibility access.
const probe = `
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <node_api.h>
static NSEvent *(^captured)(NSEvent *);
static IMP original;
static id capture(id self, SEL selector, NSEventMask mask, NSEvent *(^handler)(NSEvent *)) {
  captured = [handler copy];
  return ((id (*)(id, SEL, NSEventMask, id))original)(self, selector, mask, handler);
}
@interface Sample : NSObject
@property NSWindow *window;
@property NSEventPhase phase;
@property NSEventPhase momentumPhase;
@property BOOL hasPreciseScrollingDeltas;
@end
@implementation Sample
- (CGFloat)scrollingDeltaX { return 40; }
- (CGFloat)scrollingDeltaY { return 2; }
- (NSTimeInterval)timestamp { return 10; }
- (NSPoint)locationInWindow { return NSMakePoint(20, 30); }
- (NSEventModifierFlags)modifierFlags { return 0; }
@end
static napi_value emit(napi_env env, napi_callback_info info) {
  size_t count = 4, length;
  napi_value args[4];
  void *bytes;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  napi_get_buffer_info(env, args[0], &bytes, &length);
  NSView *view = (__bridge NSView *)*(void **)bytes;
  Sample *event = [Sample new];
  event.window = view.window;
  uint32_t phase, momentum;
  bool precise;
  napi_get_value_uint32(env, args[1], &phase);
  napi_get_value_uint32(env, args[2], &momentum);
  napi_get_value_bool(env, args[3], &precise);
  event.phase = phase;
  event.momentumPhase = momentum;
  event.hasPreciseScrollingDeltas = precise;
  captured((NSEvent *)event);
  return NULL;
}
static napi_value init(napi_env env, napi_value exports) {
  Method method = class_getClassMethod([NSEvent class], @selector(addLocalMonitorForEventsMatchingMask:handler:));
  original = method_setImplementation(method, (IMP)capture);
  napi_value function;
  napi_create_function(env, "emit", NAPI_AUTO_LENGTH, emit, NULL, &function);
  napi_set_named_property(env, exports, "emit", function);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
`;

it.runIf(process.platform === "darwin")(
	"forwards native contact and release, ignores momentum, and cleans up the monitor",
	async () => {
		const root = resolve(import.meta.dirname, "../..");
		const directory = mkdtempSync(join(tmpdir(), "nixie-scroll-test-"));
		let pid: number | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			execFileSync(process.execPath, [join(root, "scripts/build-native.mjs")]);
			writeFileSync(join(directory, "probe.m"), probe);
			execFileSync("xcrun", [
				"clang",
				"-bundle",
				"-undefined",
				"dynamic_lookup",
				"-fobjc-arc",
				"-fblocks",
				"-DNAPI_VERSION=8",
				"-I",
				join(dirname(realpathSync(process.execPath)), "../include/node"),
				"-framework",
				"AppKit",
				join(directory, "probe.m"),
				"-o",
				join(directory, "probe.node"),
			]);
			writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "nixie-scroll-test", main: "main.cjs" }));
			writeFileSync(
				join(directory, "main.cjs"),
				`
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const native = require(${JSON.stringify(join(root, "dist-native/scroll-gesture.node"))});
const probe = require("./probe.node");
app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false
  }});
  try {
    const samples = [];
    const handle = win.getNativeWindowHandle();
    assert.throws(() => native.start(Buffer.alloc(0), () => {}), /Expected a native window handle/);
    native.start(handle, sample => samples.push(sample));
    probe.emit(handle, 1, 0, true); // began
    probe.emit(handle, 4, 0, true); // changed
    probe.emit(handle, 2, 0, true); // stationary contact, not a release
    assert.deepEqual(samples.map(sample => sample.phase), ["begin", "update", "update"]);
    assert.equal(samples[0].deltaX, -40);
    assert.equal(samples[0].deltaY, -2);
    assert.equal(samples[0].at, 10000);
    assert(Number.isFinite(samples[0].x) && Number.isFinite(samples[0].y));
    probe.emit(handle, 8, 0, true); // release must arrive before any momentum
    assert.equal(samples.at(-1).phase, "end");
    const count = samples.length;
    probe.emit(handle, 0, 1, true); // momentum began
    probe.emit(handle, 0, 4, true); // momentum changed
    assert.equal(samples.length, count);
    probe.emit(handle, 0, 8, true); // momentum ended: clear wheel suppression
    assert.equal(samples.at(-1).phase, "cancel");
    probe.emit(handle, 16, 0, true); // cancelled contact
    assert.equal(samples.at(-1).phase, "cancel");
    probe.emit(handle, 0, 0, false); // ordinary mouse wheel, not a new swipe
    assert.equal(samples.at(-1).phase, "cancel");
    native.stop();
    native.start(handle, () => {});
    native.stop();
    console.log("Native gesture checks passed");
  } finally {
    native.stop();
    win.destroy();
    app.quit();
  }
}).catch(error => { console.error(error); app.exit(1); });
`
			);
			const env = { ...process.env };
			delete env.ELECTRON_RUN_AS_NODE;
			const executable = createRequire(import.meta.url)("electron") as string;
			const child = spawn(executable, [directory], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
			pid = child.pid;
			timer = setTimeout(() => stopProcessGroup(pid), 10_000);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (data) => {
				stdout += String(data);
			});
			child.stderr.on("data", (data) => {
				stderr += String(data);
			});
			const status = await new Promise<number | null>((resolve, reject) => {
				child.on("error", reject);
				child.on("close", resolve);
			});
			expect(status, stdout + stderr).toBe(0);
			expect(stdout).toContain("Native gesture checks passed");
		} finally {
			clearTimeout(timer);
			stopProcessGroup(pid);
			rmSync(directory, { recursive: true, force: true });
		}
	},
	20_000
);

/** Kill only this test's process group, including helpers if Electron timed out. */
function stopProcessGroup(pid: number | undefined) {
	if (!pid) return;
	try {
		process.kill(-pid, "SIGKILL");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}
