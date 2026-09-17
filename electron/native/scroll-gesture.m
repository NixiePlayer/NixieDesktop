#import <AppKit/AppKit.h>
#include <node_api.h>

// AppKit's contact phase ends at finger release. Chromium's GestureScrollEnd
// includes the momentum tail, and Electron does not expose the wheel phases.
static id monitor;
static NSView *view;
static napi_env environment;
static napi_ref listener;
static napi_async_context context;

static void stop(void *unused) {
  if (monitor) [NSEvent removeMonitor:monitor];
  monitor = nil;
  view = nil;
  if (listener) napi_delete_reference(environment, listener);
  listener = NULL;
  if (context) napi_async_destroy(environment, context);
  context = NULL;
}

static void number(napi_env env, napi_value object, const char *name, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  napi_set_named_property(env, object, name, result);
}

static napi_value start(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  bool buffer = false;
  napi_valuetype type;
  void *bytes = NULL;
  size_t length = 0;
  if (argc != 2 || napi_is_buffer(env, args[0], &buffer) != napi_ok || !buffer ||
      napi_get_buffer_info(env, args[0], &bytes, &length) != napi_ok || length != sizeof(void *) ||
      napi_typeof(env, args[1], &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, NULL, "Expected a native window handle and a callback");
    return NULL;
  }
  stop(NULL);
  environment = env;
  view = (__bridge NSView *)*(void **)bytes;
  napi_create_reference(env, args[1], 1, &listener);
  napi_value name;
  napi_create_string_utf8(env, "nixie:scroll-gesture", NAPI_AUTO_LENGTH, &name);
  napi_async_init(env, NULL, name, &context);
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel
      handler:^NSEvent *(NSEvent *event) {
    if (event.window != view.window || event.phase == NSEventPhaseMayBegin) return event;
    if (event.momentumPhase != NSEventPhaseNone &&
        !(event.momentumPhase & NSEventPhaseEnded)) return event;

    const char *phase = "update";
    if (event.phase & NSEventPhaseBegan) phase = "begin";
    if (event.phase & NSEventPhaseEnded) phase = "end";
    if (!event.hasPreciseScrollingDeltas || event.phase == NSEventPhaseNone ||
        (event.phase & NSEventPhaseCancelled) || (event.modifierFlags & NSEventModifierFlagControl))
      phase = "cancel";

    NSPoint point = [view convertPoint:event.locationInWindow fromView:nil];
    napi_handle_scope scope;
    napi_open_handle_scope(env, &scope);
    napi_value sample, phaseValue, callback, receiver, result;
    napi_create_object(env, &sample);
    napi_create_string_utf8(env, phase, NAPI_AUTO_LENGTH, &phaseValue);
    napi_set_named_property(env, sample, "phase", phaseValue);
    // Match DOM WheelEvent signs and CSS top-left coordinates, not AppKit's.
    number(env, sample, "deltaX", -event.scrollingDeltaX);
    number(env, sample, "deltaY", -event.scrollingDeltaY);
    number(env, sample, "at", event.timestamp * 1000);
    number(env, sample, "x", point.x);
    number(env, sample, "y", view.isFlipped ? point.y : view.bounds.size.height - point.y);
    napi_get_reference_value(env, listener, &callback);
    napi_get_global(env, &receiver);
    if (napi_make_callback(env, context, receiver, callback, 1, &sample, &result) == napi_pending_exception) {
      napi_value error;
      napi_get_and_clear_last_exception(env, &error);
      napi_fatal_exception(env, error);
    }
    napi_close_handle_scope(env, scope);
    return event;
  }];
  return NULL;
}

static napi_value stopCallback(napi_env env, napi_callback_info info) {
  stop(NULL);
  return NULL;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value function;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, NULL, &function);
  napi_set_named_property(env, exports, "start", function);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stopCallback, NULL, &function);
  napi_set_named_property(env, exports, "stop", function);
  napi_add_env_cleanup_hook(env, stop, NULL);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
