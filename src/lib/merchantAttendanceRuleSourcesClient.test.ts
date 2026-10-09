import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceRuleSourcesClient, type RuleSourcesClientOptions } from "./merchantAttendanceRuleSourcesClient";
import { parseRuleSourcesHttpQuery } from "./merchantAttendanceRuleSources";
import { ruleSourcesHttp, ruleSourcesPopulated, ruleSourcesQuery, ruleSourcesOwner, ruleSourcesId } from "../../scripts/fixtures/attendance-rule-sources-model";

const q = ruleSourcesQuery;
const encoder = new TextEncoder();
const json = (body: unknown = ruleSourcesHttp(), status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const options = (apiFetch: RuleSourcesClientOptions["apiFetch"], timeoutMs?: number): RuleSourcesClientOptions => ({ siteId: q.siteId, ownerId: ruleSourcesOwner, workerId: q.workerId, apiFetch, timeoutMs });
const read = (client: AttendanceRuleSourcesClient) => client.read(q.fromDate, q.throughDate);
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function heldBody(body = ruleSourcesHttp()) {
  let streamController!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
  const bytes = encoder.encode(JSON.stringify(body));
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; controller.enqueue(bytes.slice(0, 20)); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/json" } });
  return { response, cancelled: () => cancelled, release: () => { if (!cancelled) { streamController.enqueue(bytes.slice(20)); streamController.close(); } } };
}
function documentHidden(initial = false) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document"); let value = initial;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return value; } } });
  return { set: (hidden: boolean) => { value = hidden; }, restore: () => { if (descriptor) Object.defineProperty(globalThis, "document", descriptor); else Reflect.deleteProperty(globalThis, "document"); } };
}

test("construction is idle and has no request, write method, automatic initialization or storage use", async () => {
  let calls = 0, storageReads = 0;
  const descriptors = ["localStorage", "sessionStorage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name] of descriptors) Object.defineProperty(globalThis, name, { configurable: true, get() { storageReads++; throw Error("storage forbidden"); } });
  try {
    const client = new AttendanceRuleSourcesClient(options(async (_url, init) => { calls++; assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); return json(); }));
    assert.equal(calls, 0); assert.equal(client.getSnapshot().phase, "idle"); assert.equal(client.getSnapshot().result, null);
    for (const name of ["initialize", "refresh", "retry", "approve", "withdraw", "save"]) assert.equal(name in client, false);
    client.pause(); client.invalidate(); assert.equal(calls, 0); await read(client);
    assert.equal(calls, 1); assert.equal(storageReads, 0); assert.equal(client.getSnapshot().phase, "ready");
  } finally { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } }
});
test("options are copied and validated, and a read pins exact constructor identity and date query", async () => {
  const urls: string[] = [], supplied = options(async (url, init) => {
    urls.push(String(url)); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert(init?.signal);
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json"); return json();
  });
  const client = new AttendanceRuleSourcesClient(supplied);
  supplied.siteId = "99990002"; supplied.workerId = ruleSourcesId(999); supplied.ownerId = ruleSourcesId(998); supplied.apiFetch = async () => { throw Error("replacement"); };
  await read(client); assert.equal(client.getSnapshot().phase, "ready"); assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/merchant-enterprise\/attendance\/rule-sources\?/);
  assert.deepEqual(parseRuleSourcesHttpQuery("https://www.faolla.com" + urls[0]), q);
  for (const patch of [{ siteId: "bad" }, { ownerId: "bad" }, { workerId: "bad" }, { apiFetch: null }, { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: NaN }, { timeoutMs: 12001 }, { timeoutMs: 1.5 }]) {
    assert.throws(() => new AttendanceRuleSourcesClient({ ...options(async () => json()), ...patch } as RuleSourcesClientOptions));
  }
});
test("invalid date ranges clear prior results locally and do not issue a new request", async () => {
  let calls = 0; const client = new AttendanceRuleSourcesClient(options(async () => { calls++; return json(); }));
  await read(client); assert(client.getSnapshot().result);
  for (const [from, through] of [["", q.throughDate], [q.fromDate, "2026-10-06"], ["2026-02-30", "2026-03-01"], [q.throughDate, q.fromDate]]) {
    await client.read(from, through); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null);
  }
  assert.equal(calls, 1);
});
test("normalized state and every result subtree are frozen and detached from supplied wire", async () => {
  const body = { ok: true, moduleEnabled: false, data: ruleSourcesPopulated() }, before = structuredClone(body);
  const client = new AttendanceRuleSourcesClient(options(async () => json(body))); await read(client);
  const state = client.getSnapshot(); assert.equal(state.phase, "ready"); assert.equal(state.result?.moduleEnabled, false);
  const visit = (value: unknown) => { if (value && typeof value === "object") { assert(Object.isFrozen(value)); Object.values(value).forEach(visit); } }; visit(state);
  assert.throws(() => { state.result!.worker.workerName = "changed"; });
  assert.throws(() => { state.result!.personal.items[0].approval.rules.lateGraceMinutes = { mode: "disabled" }; });
  assert.deepEqual(body, before);
});
test("loading observer pause or date invalidation prevents even the initial GET", async () => {
  for (const pause of [true, false]) {
    let calls = 0; const client = new AttendanceRuleSourcesClient(options(async () => { calls++; return json(); }));
    client.subscribe(() => { if (client.getSnapshot().phase === "loading") { if (pause) client.pause(); else client.invalidate("日期已编辑"); } });
    await read(client); assert.equal(calls, 0); assert.equal(client.getSnapshot().phase, "idle"); assert.equal(client.getSnapshot().result, null);
  }
});
test("a synchronous loading observer can supersede with a new explicit read without sending the old query", async () => {
  const newer = { ...q, fromDate: "2026-10-02", throughDate: "2026-10-03" }; let nested: Promise<void> | undefined, once = false;
  const calls: string[] = [], client = new AttendanceRuleSourcesClient(options(async url => { calls.push(String(url)); return json(ruleSourcesHttp(newer)); }));
  client.subscribe(() => { if (!once && client.getSnapshot().phase === "loading") { once = true; nested = client.read(newer.fromDate, newer.throughDate); } });
  await read(client); await nested;
  assert.equal(calls.length, 1); assert.deepEqual(parseRuleSourcesHttpQuery("https://www.faolla.com" + calls[0]), newer);
  assert.equal(client.getSnapshot().result?.fromDate, newer.fromDate);
});
test("observer exceptions and attempted frozen mutation do not corrupt state or skip safe observers", async () => {
  const client = new AttendanceRuleSourcesClient(options(async () => json())); let seenReady = 0;
  client.subscribe(() => { throw Error("observer failed"); });
  const unsubscribe = client.subscribe(() => { if (client.getSnapshot().phase === "ready") seenReady++; });
  await read(client); assert.equal(seenReady, 1); assert.equal(client.getSnapshot().phase, "ready"); unsubscribe();
  await read(client); assert.equal(seenReady, 1);
});
test("ready observer pause wins without another listener receiving the stale ready state", async () => {
  const client = new AttendanceRuleSourcesClient(options(async () => json())); const observed: string[] = [];
  client.subscribe(() => { if (client.getSnapshot().phase === "ready") client.pause(); });
  client.subscribe(() => { observed.push(client.getSnapshot().phase); });
  await read(client); assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "idle"); assert.equal(observed.includes("ready"), false);
});
test("late headers from the previous query cannot replace a newer successful read", async () => {
  const old = deferred<Response>(), newer = { ...q, fromDate: "2026-10-02", throughDate: "2026-10-03" }; let calls = 0;
  const client = new AttendanceRuleSourcesClient(options(async () => ++calls === 1 ? old.promise : json(ruleSourcesHttp(newer))));
  const first = read(client); await client.read(newer.fromDate, newer.throughDate);
  old.resolve(json()); await first; await Promise.resolve();
  assert.equal(calls, 2); assert.equal(client.getSnapshot().result?.fromDate, newer.fromDate);
});
test("abort-hook reentrant read is not overwritten by the older invalidate or request finalizer", async () => {
  const headers = deferred<Response>(), newer = { ...q, fromDate: "2026-10-02", throughDate: "2026-10-03" };
  let calls = 0, nested: Promise<void> | undefined;
  const client = new AttendanceRuleSourcesClient(options(async (_url, init) => {
    calls++;
    if (calls > 1) return json(ruleSourcesHttp(newer));
    init!.signal!.addEventListener("abort", () => { nested = client.read(newer.fromDate, newer.throughDate); headers.resolve(json()); }, { once: true });
    return headers.promise;
  }));
  const first = read(client); client.invalidate("外层条件变化"); await first; await nested;
  assert.equal(calls, 2); assert.equal(client.getSnapshot().phase, "ready"); assert.equal(client.getSnapshot().result?.fromDate, newer.fromDate);
});
test("date edits and pause abort delayed body reads, clear immediately, and never automatically request again", async () => {
  for (const method of ["invalidate", "pause"] as const) {
    const body = heldBody(); let calls = 0;
    const client = new AttendanceRuleSourcesClient(options(async () => { calls++; return body.response; }));
    const pending = read(client); await Promise.resolve(); await Promise.resolve();
    assert.equal(client.getSnapshot().phase, "loading"); client[method](); assert.equal(client.getSnapshot().result, null);
    body.release(); await pending; assert.equal(client.getSnapshot().phase, "idle"); assert.equal(calls, 1); assert(body.cancelled());
  }
});
test("hidden entry sends no GET, and hidden delayed responses require a later explicit read", async () => {
  const visibility = documentHidden(true); let calls = 0; const delayed = deferred<Response>();
  const client = new AttendanceRuleSourcesClient(options(async () => ++calls === 1 ? delayed.promise : json()));
  try {
    await read(client); assert.equal(calls, 0); visibility.set(false); const pending = read(client);
    visibility.set(true); delayed.resolve(json()); await pending; assert.equal(client.getSnapshot().phase, "idle"); assert.equal(client.getSnapshot().result, null);
    visibility.set(false); await Promise.resolve(); assert.equal(calls, 1); await read(client); assert.equal(calls, 2); assert.equal(client.getSnapshot().phase, "ready");
  } finally { visibility.restore(); }
});
test("hidden state introduced by loading or ready observers is rechecked", async () => {
  for (const phase of ["loading", "ready"] as const) {
    const visibility = documentHidden(false); let calls = 0;
    const client = new AttendanceRuleSourcesClient(options(async () => { calls++; return json(); }));
    client.subscribe(() => { if (client.getSnapshot().phase === phase) visibility.set(true); });
    try { await read(client); assert.equal(calls, phase === "loading" ? 0 : 1); assert.equal(client.getSnapshot().phase, "idle"); assert.equal(client.getSnapshot().result, null); }
    finally { visibility.restore(); }
  }
});
test("one deadline covers pending headers even when fetch ignores the aborted signal", async () => {
  const late = deferred<Response>(); let signal: AbortSignal | null | undefined;
  const client = new AttendanceRuleSourcesClient(options(async (_url, init) => { signal = init?.signal; return late.promise; }, 15));
  await read(client); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); assert(signal?.aborted);
  late.resolve(json()); await Promise.resolve(); assert.equal(client.getSnapshot().phase, "blocked");
});
test("the header wait does not reset the deadline for a stalled UTF-8 body", async () => {
  const headers = deferred<Response>(), body = heldBody();
  const client = new AttendanceRuleSourcesClient(options(async () => headers.promise, 45));
  const pending = read(client); await delay(25); headers.resolve(body.response); await pending;
  assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); assert(body.cancelled());
});
test("only status200 nonredirected JSON successes are accepted, with strict UTF-8", async () => {
  const redirected = json(); Object.defineProperty(redirected, "redirected", { value: true });
  const responses = [redirected, json(ruleSourcesHttp(), 201), json(ruleSourcesHttp(), 206), new Response(null, { status: 204 }),
    new Response(JSON.stringify(ruleSourcesHttp()), { headers: { "Content-Type": "text/html" } }),
    new Response(Uint8Array.from([0xff]), { headers: { "Content-Type": "application/json" } }),
    new Response("{", { headers: { "Content-Type": "application/json" } })];
  for (const response of responses) {
    const client = new AttendanceRuleSourcesClient(options(async () => response)); await read(client); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null);
  }
});
test("streaming UTF-8 decoding accepts code points split across chunks", async () => {
  const body = ruleSourcesHttp(); body.data.worker.workerName = "界";
  const bytes = encoder.encode(JSON.stringify(body)), index = bytes.indexOf(0xe7);
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, index + 1)); controller.enqueue(bytes.slice(index + 1)); controller.close(); } }), { headers: { "Content-Type": "application/json" } });
  const client = new AttendanceRuleSourcesClient(options(async () => response)); await read(client); assert.equal(client.getSnapshot().result?.worker.workerName, "界");
});
test("strict error status and envelope mapping hides unknown details and never leaves prior data", async () => {
  for (const [status, body, expected] of [
    [403, { ok: false, error: "attendance_access_denied" }, /双重身份/],
    [409, { ok: false, error: "attendance_personal_rule_identity_changed" }, /双重身份/],
    [422, { ok: false, error: "attendance_rule_sources_too_large" }, /安全读取上限/],
    [503, { ok: false, error: "attendance_access_denied" }, /无法可靠/],
    [403, { ok: false, error: "attendance_access_denied", debug: "secret-host" }, /无法可靠/],
    [503, { ok: false, error: "secret-host" }, /无法可靠/],
    [401, { ok: false, error: "authentication_required" }, /无法可靠/],
    [403, { ok: true, error: "attendance_access_denied" }, /无法可靠/],
  ] as const) {
    let calls = 0; const client = new AttendanceRuleSourcesClient(options(async () => ++calls === 1 ? json() : json(body, status)));
    await read(client); assert(client.getSnapshot().result); await read(client);
    assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); assert.match(client.getSnapshot().message, expected); assert.doesNotMatch(client.getSnapshot().message, /secret-host/);
  }
});
test("transport success and error byte caps are exact, including trailing JSON whitespace", async () => {
  const successful = JSON.stringify(ruleSourcesHttp()), denied = JSON.stringify({ ok: false, error: "attendance_access_denied" });
  for (const [status, content, limit, expected] of [[200, successful, 1049600, "ready"], [403, denied, 4096, "blocked"]] as const) {
    for (const extra of [0, 1]) {
      const text = content + " ".repeat(limit - encoder.encode(content).byteLength + extra);
      const client = new AttendanceRuleSourcesClient(options(async () => new Response(text, { status, headers: { "Content-Type": "application/json" } })));
      await read(client); assert.equal(client.getSnapshot().phase, extra ? "blocked" : expected);
      if (status === 403) assert.match(client.getSnapshot().message, extra ? /无法可靠/ : /双重身份/);
    }
  }
});
test("success DTO remains pinned to owner, site, worker, dates and complete strict source schema", async () => {
  const mutations: Array<(body: ReturnType<typeof ruleSourcesHttp>) => void> = [body => { body.data.actorId = ruleSourcesId(999); }, body => { body.data.siteId = "99990002"; },
    body => { body.data.worker.workerId = ruleSourcesId(999); }, body => { body.data.fromDate = "2026-09-28"; }, body => { body.data.throughDate = "2026-10-02"; },
    body => { Object.assign(body, { trace: true }); }, body => { Object.assign(body.data.worker, { extra: true }); }, body => { body.data.personal.limited = true; body.data.personal.items = ruleSourcesPopulated().personal.items; }];
  for (const mutate of mutations) { const body = ruleSourcesHttp(); mutate(body); const client = new AttendanceRuleSourcesClient(options(async () => json(body))); await read(client); assert.equal(client.getSnapshot().phase, "blocked"); assert.equal(client.getSnapshot().result, null); }
});
