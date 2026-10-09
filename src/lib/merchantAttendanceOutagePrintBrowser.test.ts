import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { deliverOutagePrint, type OutagePrintDelivery } from "./merchantAttendanceOutagePrintBrowser";

class FakeWindow extends EventTarget {
  print: (() => void) | undefined;
}
class FakeFrame extends EventTarget {
  title = ""; tabIndex = 0; style = { cssText: "" }; isConnected = false;
  marker: string | null = "blank"; removed = 0; attributes = new Map<string, string>();
  contentWindow: FakeWindow | null = new FakeWindow();
  contentDocument = { URL: "about:srcdoc", body: { getAttribute: (name: string): string | null => {
    assert.equal(name, "data-attendance-outage-print-document"); return this.marker;
  } } };
  beforeSrcdoc: (() => void) | null = null; private html = "";
  get srcdoc() { return this.html; }
  set srcdoc(value: string) { this.beforeSrcdoc?.(); this.html = value; }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  remove() { this.isConnected = false; this.removed++; }
  load() { this.dispatchEvent(new Event("load")); }
}
type Fixture = { frame: FakeFrame; target: FakeWindow; input: OutagePrintDelivery; controller: AbortController;
  expire: () => void; counters: { create: number; append: number }; hooks: { create?: () => void; append?: () => void } };
function fixture(run: (f: Fixture) => Promise<void>) {
  return async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document"), frame = new FakeFrame(), controller = new AbortController();
    const target = frame.contentWindow!, counters = { create: 0, append: 0 }, hooks: Fixture["hooks"] = {};
    let authorized = true;
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      createElement: (tag: string) => { assert.equal(tag, "iframe"); counters.create++; hooks.create?.(); return frame; },
      body: { appendChild: (child: FakeFrame) => { assert.equal(child, frame); counters.append++; child.isConnected = true; hooks.append?.(); } },
    } });
    const input: OutagePrintDelivery = { kind: "blank", html: '<body data-attendance-outage-print-document="blank">synthetic</body>',
      signal: controller.signal, authorized: () => authorized, remainingMs: () => 300000 };
    try { await run({ frame, target, input, controller, counters, hooks, expire: () => { authorized = false; } }); }
    finally { controller.abort(); if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
  };
}

test("both kinds print only the exact sandboxed document, ignore aboutblank, and dispatch once", async () => {
  for (const kind of ["blank", "handoff"] as const) await fixture(async ({ frame, target, input, counters }) => {
    input.kind = kind; input.html = `<body data-attendance-outage-print-document="${kind}">synthetic</body>`;
    let calls = 0; target.print = () => { calls++; target.dispatchEvent(new Event("afterprint")); };
    frame.contentDocument.URL = "about:blank"; frame.marker = null;
    const pending = deliverOutagePrint(input); frame.load(); assert.equal(calls, 0);
    assert.equal(frame.srcdoc, input.html); assert.equal(counters.create, 1); assert.equal(counters.append, 1);
    assert.equal(frame.attributes.get("sandbox"), "allow-same-origin allow-modals");
    assert.equal(frame.attributes.get("aria-hidden"), "true"); assert.equal(frame.tabIndex, -1);
    assert(!frame.attributes.get("sandbox")!.includes("allow-scripts")); assert(frame.style.cssText.includes("left:-12000px"));
    frame.contentDocument.URL = "about:srcdoc"; frame.marker = kind; frame.load(); await pending; frame.load();
    assert.equal(calls, 1); assert.equal(frame.removed, 1); assert.equal(frame.isConnected, false);
  })();
});
test("wrong marker or unmarked actual document fails closed instead of printing another form", async () => {
  for (const marker of ["handoff", "timesheet", "BLANK", null]) await fixture(async ({ frame, target, input }) => {
    let calls = 0; target.print = () => { calls++; }; frame.marker = marker;
    const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_unavailable/);
    frame.load(); await rejected; frame.marker = "blank"; frame.load(); assert.equal(calls, 0); assert.equal(frame.removed, 1);
  })();
});
test("pre-aborted, unauthorized or throwing authorization never creates a frame", async () => {
  for (const mode of ["abort", "deny", "throw"] as const) await fixture(async ({ input, controller, expire, counters }) => {
    if (mode === "abort") controller.abort(); else if (mode === "deny") expire(); else input.authorized = () => { throw Error("auth"); };
    await assert.rejects(deliverOutagePrint(input), /outage_print_expired/); assert.equal(counters.create, 0); assert.equal(counters.append, 0);
  })();
});
test("invalid remaining budgets are expired before timers or DOM creation", async () => {
  for (const remaining of [NaN, Infinity, -Infinity, 0, -1]) await fixture(async ({ input, counters }) => {
    input.remainingMs = () => remaining;
    await assert.rejects(deliverOutagePrint(input), /outage_print_expired/); assert.equal(counters.create, 0); assert.equal(counters.append, 0);
  })();
  await fixture(async ({ input, counters }) => {
    input.remainingMs = () => { throw Error("budget"); };
    await assert.rejects(deliverOutagePrint(input), /outage_print_expired/); assert.equal(counters.create, 0);
  })();
});
test("revocation during creation, srcdoc or attachment removes the frame without printing", async () => {
  for (const stage of ["create", "srcdoc", "append"] as const) await fixture(async ({ input, frame, target, expire, hooks, counters }) => {
    let calls = 0; target.print = () => { calls++; };
    if (stage === "srcdoc") frame.beforeSrcdoc = expire; else hooks[stage] = expire;
    await assert.rejects(deliverOutagePrint(input), /outage_print_expired/); frame.load();
    assert.equal(calls, 0); assert.equal(frame.removed, 1); assert(!frame.isConnected);
    assert.equal(counters.append, stage === "append" ? 1 : 0);
  })();
});
test("abort or expired authorization while loading clears private HTML and ignores late load", async () => {
  for (const abort of [true, false]) await fixture(async ({ frame, target, input, controller, expire }) => {
    let calls = 0; target.print = () => { calls++; };
    const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_expired/);
    if (abort) controller.abort(); else expire(); frame.load(); await rejected; frame.load();
    assert.equal(calls, 0); assert.equal(frame.removed, 1); assert(!frame.isConnected);
  })();
});
test("authorization and budget are checked after inspecting the marker and immediately before printing", async () => {
  for (const mode of ["auth", "budget", "abort"] as const) await fixture(async ({ frame, target, input, controller, expire }) => {
    let calls = 0; target.print = () => { calls++; };
    frame.contentDocument.body.getAttribute = () => {
      if (mode === "auth") expire(); else if (mode === "budget") input.remainingMs = () => NaN; else controller.abort();
      return "blank";
    };
    const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_expired/); frame.load(); await rejected;
    assert.equal(calls, 0); assert.equal(frame.removed, 1);
    assert.equal(getEventListeners(target, "afterprint").length, 0);
  })();
});
test("missing print target, missing API and inspection failure do not fall back to a parent page or popup", async () => {
  for (const mode of ["window", "print", "inspection"] as const) await fixture(async ({ frame, input }) => {
    if (mode === "window") frame.contentWindow = null;
    if (mode === "inspection") frame.contentDocument.body.getAttribute = () => { throw Error("denied"); };
    const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_unavailable/); frame.load(); await rejected;
    assert.equal(frame.removed, 1); assert(!frame.isConnected);
  })();
});
test("a detached frame is expired even if its late load arrives", fixture(async ({ frame, target, input }) => {
  let calls = 0; target.print = () => { calls++; };
  const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_expired/);
  frame.isConnected = false; frame.load(); await rejected; assert.equal(calls, 0); assert.equal(frame.removed, 1);
}));
test("print throws, aborts or loses authority after invocation remain uncertain and are never retried", async () => {
  for (const mode of ["throw", "abort", "auth", "budget"] as const) await fixture(async ({ frame, target, input, controller, expire }) => {
    let calls = 0; target.print = () => {
      calls++;
      if (mode === "throw") throw Error("browser");
      if (mode === "abort") controller.abort(); else if (mode === "auth") expire(); else input.remainingMs = () => Infinity;
    };
    const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_uncertain/); frame.load(); await rejected; frame.load();
    assert.equal(calls, 1); assert.equal(frame.removed, 1); assert(!frame.isConnected);
  })();
});
test("an open asynchronous dialog accepts only one load and remains abort-cleanable after dispatch resolves", fixture(async ({ frame, target, input, controller }) => {
  let calls = 0; target.print = () => { calls++; frame.load(); };
  const pending = deliverOutagePrint(input); frame.load(); await pending; frame.load(); assert.equal(calls, 1); assert(frame.isConnected);
  controller.abort(); target.dispatchEvent(new Event("afterprint")); frame.load(); assert(!frame.isConnected); assert.equal(frame.removed, 1);
}));
test("normal asynchronous afterprint removes the frame and later abort cannot remove it twice", fixture(async ({ frame, target, input, controller }) => {
  target.print = () => {};
  const pending = deliverOutagePrint(input); frame.load(); await pending; assert(frame.isConnected);
  target.dispatchEvent(new Event("afterprint")); assert.equal(frame.removed, 1); controller.abort(); frame.load(); assert.equal(frame.removed, 1);
}));
test("loading and missing-afterprint cleanup are capped, finite and use the remaining controller budget", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const remaining of [120, Number.MAX_VALUE]) await fixture(async ({ frame, input }) => {
      input.remainingMs = () => remaining;
      const pending = deliverOutagePrint(input), rejected = assert.rejects(pending, /outage_print_expired/);
      const wait = Math.min(remaining, 30000); context.mock.timers.tick(wait - 1); assert(frame.isConnected);
      context.mock.timers.tick(1); await rejected; assert.equal(frame.removed, 1); frame.load();
    })();
    for (const remaining of [240, Number.MAX_VALUE]) await fixture(async ({ frame, target, input }) => {
      target.print = () => { input.remainingMs = () => remaining; };
      const pending = deliverOutagePrint(input); frame.load(); await pending;
      const wait = Math.min(remaining, 60000); context.mock.timers.tick(wait - 1); assert(frame.isConnected);
      context.mock.timers.tick(1); assert.equal(frame.removed, 1); assert(!frame.isConnected);
    })();
  } finally { context.mock.timers.reset(); }
});
test("DOM creation or attachment failure returns unavailable and cleans up without an implicit retry", async () => {
  for (const stage of ["create", "append"] as const) await fixture(async ({ frame, target, input, hooks }) => {
    let calls = 0; target.print = () => { calls++; }; hooks[stage] = () => { throw Error("DOM"); };
    await assert.rejects(deliverOutagePrint(input), /outage_print_unavailable/); frame.load(); assert.equal(calls, 0); assert(!frame.isConnected);
    assert.equal(frame.removed, stage === "create" ? 0 : 1);
  })();
});
