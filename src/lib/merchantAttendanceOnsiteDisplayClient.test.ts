import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import jsQR from "jsqr";
import { AttendanceOnsiteDisplayClient, createOnsiteDisplayQr, parseOnsiteDisplayIssue, ONSITE_DISPLAY_API } from "./merchantAttendanceOnsiteDisplayClient";
import { buildOnsiteScanUrl, parseOnsiteScanUrl } from "./merchantAttendanceOnsiteQrBrowser";

const origin = "https://www.faolla.com", epoch = 1_790_769_600_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const image = "data:image/png;base64,AA==", image2 = "data:image/png;base64,AQ==";
function issued(at = epoch, n = 1) {
  const claims = { v: 1, purpose: "faolla.attendance.onsite", siteId: "99990001", terminalId: id(70), locationId: id(301),
    pairedAtMs: epoch - 120000, issuedAtMs: at, expiresAtMs: at + 45000, nonce: id(n) };
  const token = `aq1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${"A".repeat(43)}`;
  return { ok: true, moduleEnabled: true, siteId: claims.siteId, terminalId: claims.terminalId, locationId: claims.locationId,
    issuedAtMs: claims.issuedAtMs, expiresAtMs: claims.expiresAtMs, token };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
function harness(options: Partial<ConstructorParameters<typeof AttendanceOnsiteDisplayClient>[0]> = {}) {
  let wall = epoch, mono = 0, next = 1, requests = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const client = new AttendanceOnsiteDisplayClient({ scanOrigin: origin, wallNow: () => wall, monotonicNow: () => mono,
    setTimer: (fn, delay) => { const n = next++; timers.set(n, { at: mono + delay, fn }); return n as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: timer => { timers.delete(timer as unknown as number); },
    request: async () => issued(wall, ++requests), render: async () => image, ...options });
  const advance = async (ms: number) => {
    const target = mono + ms; let count = 0;
    while (true) {
      const item = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!item) break; if (++count > 500) throw Error("timer_loop");
      const elapsed = item[1].at - mono; mono = item[1].at; wall += elapsed; timers.delete(item[0]); item[1].fn(); await flush();
    }
    wall += target - mono; mono = target; await flush();
  };
  const jump = async (monoMs: number, wallMs = monoMs) => {
    mono += monoMs; wall += wallMs;
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= mono);
    for (const [key, timer] of due) { if (timers.delete(key)) timer.fn(); } await flush();
  };
  return { client, advance, jump, requests: () => requests, timers: () => timers.size, wall: () => wall };
}

test("issuer response shape and every visible metadata field must match decoded untrusted claims", () => {
  const good = issued(); assert.equal(parseOnsiteDisplayIssue(good).token, good.token);
  for (const bad of [null, [], { ...good, ok: false }, { ...good, moduleEnabled: "true" }, { ...good, employeeId: id(1) },
    { ...good, siteId: "99990002" }, { ...good, terminalId: id(71) }, { ...good, locationId: id(302) },
    { ...good, issuedAtMs: good.issuedAtMs + 1 }, { ...good, expiresAtMs: String(good.expiresAtMs) }, { ...good, token: "invalid" }]) {
    assert.throws(() => parseOnsiteDisplayIssue(bad));
  }
});

test("local 512px PNG decodes to the exact canonical fragment handoff, without an external image service", async () => {
  const url = buildOnsiteScanUrl(origin, issued().token), png = await createOnsiteDisplayQr(url);
  assert.match(png, /^data:image\/png;base64,/);
  const { data, info } = await sharp(Buffer.from(png.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 512); assert.equal(info.height, 512);
  assert.equal(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data, url);
  assert.deepEqual([...data.subarray(0, 4)], [255, 255, 255, 255]);
});

test("countdown is local, scheduled refresh is 30 seconds, and attempts stay at two per rolling minute", async () => {
  const h = harness(); await h.client.start(true, true);
  assert.equal(h.requests(), 1); assert.equal(h.client.getSnapshot().remainingSeconds, 45); assert.equal(h.client.getSnapshot().canRefresh, false);
  await h.advance(5000); assert.equal(h.client.getSnapshot().canRefresh, true);
  await h.advance(24000); assert.equal(h.requests(), 1); assert.equal(h.client.getSnapshot().remainingSeconds, 16);
  await h.advance(1000); assert.equal(h.requests(), 2); assert.equal(h.client.getSnapshot().remainingSeconds, 45);
  await h.advance(29000); assert.equal(h.requests(), 2);
  await h.advance(1000); assert.equal(h.requests(), 3);
  h.client.dispose(); assert.equal(h.timers(), 0);
});

test("manual refresh is five-second throttled, clears old image first, and enforces rolling cap", async () => {
  const response = deferred<unknown>(); let calls = 0;
  const h = harness({ request: async () => ++calls === 1 ? issued() : response.promise });
  await h.client.start(true, true); await h.client.refresh(); assert.equal(calls, 1);
  await h.advance(5000); const refreshing = h.client.refresh();
  assert.equal(calls, 2); assert.equal(h.client.getSnapshot().code, null); assert.equal(h.client.getSnapshot().phase, "loading");
  await h.client.refresh(); assert.equal(calls, 2);
  response.resolve(issued(epoch + 5000, 2)); await refreshing;
  assert.equal(h.client.getSnapshot().retryAfterSeconds, 55);
  await h.advance(5000); await h.client.refresh(); assert.equal(calls, 2);
  h.client.dispose();
});

test("early manual refresh can create a safe blank interval but automatic issuance resumes only at the rate boundary", async () => {
  const h = harness(); await h.client.start(true, true); await h.advance(5000); await h.client.refresh();
  assert.equal(h.requests(), 2); await h.advance(44999); assert.notEqual(h.client.getSnapshot().code, null);
  await h.advance(1); assert.equal(h.client.getSnapshot().code, null); assert.equal(h.requests(), 2);
  await h.advance(9999); assert.equal(h.requests(), 2); await h.advance(1);
  assert.equal(h.requests(), 3); assert.equal(h.client.getSnapshot().phase, "ready"); h.client.dispose();
});

test("hidden/offline aborts in-flight requests and late response cannot restore an old image", async () => {
  const first = deferred<unknown>(); const signals: AbortSignal[] = [];
  const h = harness({ request: async signal => { signals.push(signal); return signals.length === 1 ? first.promise : issued(epoch + 5000, 2); } });
  const starting = h.client.start(true, true); await h.client.setEnvironment(false, true); await starting;
  assert.equal(signals[0].aborted, true); assert.equal(h.client.getSnapshot().code, null); assert.equal(h.client.getSnapshot().phase, "paused");
  await h.advance(5000); await h.client.setEnvironment(true, true);
  assert.equal(signals.length, 2); assert.equal(h.client.getSnapshot().phase, "ready");
  first.resolve(issued()); await flush(); assert.equal(h.client.getSnapshot().code?.issuedAtMs, epoch + 5000);
  await h.client.setEnvironment(true, false); assert.equal(h.client.getSnapshot().code, null);
  await h.advance(120000); assert.equal(signals.length, 2);
  await h.client.setEnvironment(true, true); assert.equal(signals.length, 3);
  h.client.dispose();
});

test("late local QR render from old visibility generation never overwrites new generation", async () => {
  const slow = deferred<string>(); let rendering = 0;
  const h = harness({ render: async () => ++rendering === 1 ? slow.promise : image2 });
  const starting = h.client.start(true, true); await flush(); assert.equal(rendering, 1);
  await h.client.setEnvironment(false, true); await starting; await h.advance(5000);
  await h.client.setEnvironment(true, true); assert.equal(h.client.getSnapshot().code?.image, image2);
  slow.resolve(image); await flush(); assert.equal(h.client.getSnapshot().code?.image, image2);
  h.client.dispose();
});

test("deadline aborts stuck network or render and failures stop auto retries until explicit retry", async () => {
  const stuck = deferred<unknown>(); let requests = 0, signal!: AbortSignal;
  const h = harness({ request: async current => { requests++; signal = current; return stuck.promise; } });
  const starting = h.client.start(true, true); await h.advance(10000); await starting;
  assert.equal(signal.aborted, true); assert.equal(h.client.getSnapshot().phase, "error"); assert.equal(h.client.getSnapshot().code, null);
  await h.advance(120000); assert.equal(requests, 1);
  const retrying = h.client.refresh(); assert.equal(requests, 2); h.client.dispose(); await retrying;
  const render = deferred<string>(), r = harness({ render: async () => render.promise });
  const pending = r.client.start(true, true); await flush(); await r.advance(10000); await pending;
  render.resolve(image); await flush(); assert.equal(r.client.getSnapshot().phase, "error"); assert.equal(r.client.getSnapshot().code, null); r.client.dispose();
});

test("expired response or expiry during QR rendering never displays an image", async () => {
  let renders = 0;
  const h = harness({ request: async () => issued(epoch - 50000), render: async () => { renders++; return image; } });
  await h.client.start(true, true); assert.equal(renders, 0); assert.equal(h.client.getSnapshot().phase, "error"); h.client.dispose();
  const render = deferred<string>(), r = harness({ request: async () => issued(epoch - 44000), render: async () => render.promise });
  const starting = r.client.start(true, true); await flush(); await r.advance(1001); render.resolve(image); await starting;
  assert.equal(r.client.getSnapshot().code, null); assert.equal(r.client.getSnapshot().phase, "error"); r.client.dispose();
});

test("absolute expiry, backward wall time and monotonic lifetime each clear the displayed code", async () => {
  const wall = harness(); await wall.client.start(true, true); await wall.jump(1000, 46000);
  assert.equal(wall.client.getSnapshot().code, null); assert.equal(wall.requests(), 1); wall.client.dispose();
  const backward = harness(); await backward.client.start(true, true); await backward.jump(1000, -1000);
  assert.equal(backward.client.getSnapshot().code, null); assert.match(backward.client.getSnapshot().message, /时钟/); backward.client.dispose();
  const monotonic = harness(); await monotonic.client.start(true, true); await monotonic.jump(46000, 0);
  assert.equal(monotonic.client.getSnapshot().code, null); assert.equal(monotonic.requests(), 1); monotonic.client.dispose();
});

test("invalid configured origin never requests; paused admission can show finish evidence with no token in state", async () => {
  for (const scanOrigin of [null, "http://www.faolla.com", "https://user:secret@www.faolla.com", "https://www.faolla.com/#wrong"]) {
    const h = harness({ scanOrigin }); await h.client.start(true, true); assert.equal(h.requests(), 0); assert.equal(h.client.getSnapshot().canRefresh, false); h.client.dispose();
  }
  let handoff = ""; const code = issued();
  const h = harness({ request: async () => ({ ...code, moduleEnabled: false }), render: async url => { handoff = url; return image; } });
  await h.client.start(true, true); assert.equal(h.client.getSnapshot().code?.moduleEnabled, false);
  assert.equal(parseOnsiteScanUrl(handoff, origin).token, code.token);
  assert.equal(JSON.stringify(h.client.getSnapshot()).includes(code.token), false);
  assert.equal(JSON.stringify(h.client.getSnapshot()).includes("#qr="), false); h.client.dispose();
});

test("default transport only POSTs an empty issuer body with same-origin credentials and no cache/auth header", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, ONSITE_DISPLAY_API); assert.equal(init?.method, "POST"); assert.equal(init?.body, "{}");
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { "Content-Type": "application/json" });
    return new Response(JSON.stringify(issued()), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const h = harness({ request: undefined }); await h.client.start(true, true); assert.equal(calls, 1); assert.equal(h.client.getSnapshot().phase, "ready"); h.client.dispose();
  } finally { globalThis.fetch = original; }
});

test("display/page are isolated, gated, noindex, and never store tokens or submit employee actions", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  const component = read("../components/enterprise/MerchantAttendanceOnsiteDisplay.tsx"), page = read("../app/enterprise/attendance-terminal/onsite/page.tsx");
  const client = read("./merchantAttendanceOnsiteDisplayClient.ts");
  for (const flag of ["SELF", "TERMINALS", "ONSITE_QR"]) assert.ok(page.includes(`FAOLLA_ATTENDANCE_${flag}_ENABLED !== "1"`));
  assert.match(page, /dynamic = "force-dynamic"/); assert.match(page, /referrer: "no-referrer"/); assert.match(page, /index: false, follow: false/);
  assert.match(page, /terminalRecoveryUrlFromOrigin\(resolveCanonicalPortalOrigin\(\)\)/);
  assert.doesNotMatch(component + client, /localStorage|sessionStorage|indexedDB|document\.cookie|Authorization|onsite-clock|clock_in|console\./);
  assert.match(component, /visibilitychange/); assert.match(component, /"offline"/); assert.match(component, /"pagehide"/);
  assert.match(component, /不能保证真实到店/); assert.match(component, /登录完成后重新扫描当前新码/);
  assert.match(client, /width: 512, margin: 4/);
});
