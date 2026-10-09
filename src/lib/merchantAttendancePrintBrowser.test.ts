import assert from "node:assert/strict";
import test from "node:test";
import { deliverAttendancePrint } from "./merchantAttendancePrintBrowser";
import type { AttendancePrintDelivery } from "./merchantAttendancePrintClient";

class FakeWindow extends EventTarget {
  print: (() => void) | undefined;
}
class FakeFrame extends EventTarget {
  title = ""; tabIndex = 0; srcdoc = ""; style = { cssText: "" }; isConnected = false;
  marker: string | null = "timesheet"; removed = 0; attributes = new Map<string, string>();
  contentWindow = new FakeWindow();
  contentDocument = { body: { getAttribute: () => this.marker } };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  remove() { this.isConnected = false; this.removed++; }
  load() { this.dispatchEvent(new Event("load")); }
}
function fixture(run: (f: { frame: FakeFrame; input: AttendancePrintDelivery; controller: AbortController; expire: () => void }) => Promise<void>) {
  return async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), frame = new FakeFrame(), controller = new AbortController();
    let authorized = true;
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement: (tag: string) => { assert.equal(tag, "iframe"); return frame; }, body: { appendChild: (child: FakeFrame) => { assert.equal(child, frame); child.isConnected = true; } },
    } });
    const input: AttendancePrintDelivery = { kind: "timesheet", html: '<body data-attendance-print-document="timesheet">synthetic</body>', filename: "synthetic.csv",
      signal: controller.signal, authorized: () => authorized && !controller.signal.aborted, remainingMs: () => 300000 };
    try { await run({ frame, input, controller, expire: () => { authorized = false; } }); }
    finally { controller.abort(); if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
  };
}

test("print frame is inert, ignores preliminary load and dispatches once, afterprint removes all transient content", fixture(async ({ frame, input }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; frame.contentWindow.dispatchEvent(new Event("afterprint")); };
  frame.marker = null; const pending = deliverAttendancePrint(input); frame.load(); assert.equal(calls, 0);
  assert.equal(frame.attributes.get("sandbox"), "allow-same-origin allow-modals"); assert.equal(frame.attributes.get("aria-hidden"), "true");
  assert(!frame.attributes.get("sandbox")!.includes("allow-scripts")); assert(frame.style.cssText.includes("left:-12000px"));
  frame.marker = "timesheet"; frame.load(); await pending; frame.load(); assert.equal(calls, 1); assert.equal(frame.isConnected, false); assert.equal(frame.removed, 1);
}));
test("hidden/unmounted signal clears a waiting frame and late load never prints", fixture(async ({ frame, input, controller }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; };
  const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_expired/);
  controller.abort(); frame.load(); await rejected; assert.equal(calls, 0); assert(!frame.isConnected);
}));
test("lease is synchronously checked after load even when timer has not run", fixture(async ({ frame, input, expire }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; };
  const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_expired/);
  expire(); frame.load(); await rejected; assert.equal(calls, 0); assert(!frame.isConnected);
}));
test("lease is checked again immediately before print after document inspection", fixture(async ({ frame, input, expire }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; };
  frame.contentDocument.body.getAttribute = () => { expire(); return "timesheet"; };
  const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_expired/);
  frame.load(); await rejected; assert.equal(calls, 0); assert(!frame.isConnected);
}));
test("missing print API does not fall back to parent page or another window", fixture(async ({ frame, input }) => {
  const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_unavailable/);
  frame.load(); await rejected; assert(!frame.isConnected);
}));
test("throwing printer outcome stays uncertain and is never retried", fixture(async ({ frame, input }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; throw Error("browser"); };
  const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_uncertain/);
  frame.load(); await rejected; frame.load(); assert.equal(calls, 1); assert(!frame.isConnected);
}));
test("an asynchronously open dialog remains cancelable after the promise resolves", fixture(async ({ frame, input, controller }) => {
  let calls = 0; frame.contentWindow.print = () => { calls++; };
  const pending = deliverAttendancePrint(input); frame.load(); await pending;
  assert(frame.isConnected); controller.abort(); assert(!frame.isConnected); frame.load(); assert.equal(calls, 1);
}));
test("expired or pre-aborted document never attaches a frame", fixture(async ({ frame, input, expire }) => {
  expire(); await assert.rejects(deliverAttendancePrint(input), /attendance_print_expired/); assert(!frame.isConnected); assert.equal(frame.srcdoc, "");
}));
test("missing load and missing afterprint both have bounded cleanup", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await fixture(async ({ frame, input }) => {
    const pending = deliverAttendancePrint(input), rejected = assert.rejects(pending, /attendance_print_expired/);
    context.mock.timers.tick(30000); await rejected; assert(!frame.isConnected);
  })();
  await fixture(async ({ frame, input }) => {
    frame.contentWindow.print = () => {};
    const pending = deliverAttendancePrint(input); frame.load(); await pending; assert(frame.isConnected);
    context.mock.timers.tick(60000); assert(!frame.isConnected);
  })();
  context.mock.timers.reset();
});
