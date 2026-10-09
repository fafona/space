import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { handleRuleCaptures, ruleCapturesDependencies } from "../app/api/merchant-enterprise/attendance/rule-captures/route-handler";
import { MerchantAttendanceError } from "./merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "./merchantEnterpriseAuth.server";
import { RULE_CAPTURES_ERRORS } from "./merchantAttendanceRuleCaptures";
import { executeRuleCaptures } from "./merchantAttendanceRuleCaptures.server";
import { ruleSourcesId, ruleSourcesOwner, type ruleSourcesPopulated } from "../../scripts/fixtures/attendance-rule-sources-model";
import { ruleCapturesQuery, ruleCapturesCommand as captureCommand, ruleCapturesResult } from "../../scripts/fixtures/attendance-rule-captures-model";

const url = "https://www.faolla.com/api/merchant-enterprise/attendance/rule-captures", owner = ruleSourcesOwner;
const ruleCapturesCommand = () => structuredClone(captureCommand);
const body = () => ({ query: ruleCapturesQuery, command: ruleCapturesCommand() });
const get = (suffix = "") => new Request(`${url}?${new URLSearchParams(ruleCapturesQuery)}${suffix}`);
const post = (value: unknown = body(), headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
const rawPost = (value: string | Uint8Array, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json", ...headers }, body: typeof value === "string" ? value : new Uint8Array(value) });
function setup(patch: Partial<typeof ruleCapturesDependencies> = {}) {
  const calls: Parameters<typeof ruleCapturesDependencies.execute>[0][] = [], entitlements: string[] = [], actors: string[] = [];
  const deps: typeof ruleCapturesDependencies = {
    enabled: () => true,
    bodyTimeoutMs: 5000,
    authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }),
    entitlement: async siteId => { entitlements.push(siteId); return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof ruleCapturesDependencies.entitlement>>; },
    allow: actor => { actors.push(actor); return true; },
    // Transport boundary only; the service/parser tests below validate SQL DTOs.
    execute: async input => { calls.push(input); return ruleCapturesResult(); }, ...patch,
  };
  return { deps, calls, entitlements, actors };
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, x-merchant-access-token");
}

test("capture endpoint is independently default-closed and does not authenticate while disabled", async t => {
  const previous = process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED; else process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED = previous; });
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate"); } });
  for (const flag of [undefined, "0", "true", " 1"]) {
    if (flag === undefined) delete process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED;
    else process.env.FAOLLA_ATTENDANCE_RULE_CAPTURES_ENABLED = flag;
    for (const request of [get(), post()]) {
      const response = await handleRuleCaptures(request, { ...f.deps, enabled: ruleCapturesDependencies.enabled });
      assert.equal(response.status, 404); assert.deepEqual(await response.json(), { ok: false, error: "attendance_not_available" }); privateHeaders(response);
    }
  }
  assert.equal(authenticated, 0); assert.equal(f.calls.length, 0);
});

test("only GET and POST reach authentication and unsupported methods return private 405", async () => {
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate"); } });
  for (const method of ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handleRuleCaptures(new Request(url, { method }), f.deps);
    assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, POST"); privateHeaders(response);
  }
  assert.equal(authenticated, 0);
});

test("canonical origin and same-origin mutation proofs reject alternative hosts, CSRF and fetch-site ambiguity", async () => {
  let authenticated = 0; const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate"); } });
  const requests = [new Request(get().url.replace("www.faolla.com", "merchant.faolla.com")),
    new Request(get(), { headers: { origin: "https://evil.invalid" } }), new Request(get(), { headers: { origin: "null" } }),
    post(body(), { origin: "https://evil.invalid" }), post(body(), { origin: "https://www.faolla.com:444" }),
    new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body()) })];
  for (const fetchSite of ["same-site", "cross-site"]) {
    requests.push(new Request(get(), { headers: { "sec-fetch-site": fetchSite } }));
    requests.push(post(body(), { "sec-fetch-site": fetchSite }));
  }
  for (const request of requests) { const response = await handleRuleCaptures(request, f.deps); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "forbidden_origin" }); privateHeaders(response); }
  assert.equal(authenticated, 0); assert.equal(f.calls.length, 0);
});

test("same-origin referer may prove POST origin but forged forwarding does not change canonical Origin", async () => {
  const f = setup();
  const allowed = new Request(url, { method: "POST", headers: { referer: "https://www.faolla.com/merchant", "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body()) });
  assert.equal((await handleRuleCaptures(allowed, f.deps)).status, 200);
  const denied = post(body(), { origin: "https://evil.invalid", "x-forwarded-host": "evil.invalid", "x-forwarded-proto": "https" });
  assert.equal((await handleRuleCaptures(denied, f.deps)).status, 403); assert.equal(f.calls.length, 1);
});

test("empty or weak authentication never reaches entitlement or capture SQL", async () => {
  for (const authenticationMethods of [[], ["invite"], ["magiclink"], ["recovery"], ["password", "recovery"], ["password", "invite"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: owner } as User, accessToken: "synthetic-only", authenticationMethods }) });
    const response = await handleRuleCaptures(post(), f.deps); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_access_denied" }); assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
  }
});

test("rate admission uses authenticated actor and is enforced before body or entitlement", async () => {
  const seen: string[] = [], f = setup({ allow: actor => { seen.push(actor); return false; } });
  for (const request of [get(), rawPost("malformed")]) {
    const response = await handleRuleCaptures(request, f.deps); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); privateHeaders(response);
  }
  assert.deepEqual(seen, [owner, owner]); assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("GET performs only exact original-operation retrieval and returns the private versioned envelope", async () => {
  const f = setup(), response = await handleRuleCaptures(get(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(f.calls, [{ query: ruleCapturesQuery, command: null, authUserId: owner, moduleEnabled: true }]);
  assert.deepEqual(f.entitlements, [ruleCapturesQuery.siteId]); assert.deepEqual(f.actors, [owner]);
  assert.deepEqual(await response.json(), { ok: true, moduleEnabled: true, data: ruleCapturesResult() }); privateHeaders(response);
});

test("POST passes only the parsed explicit command plus current server actor and entitlement", async () => {
  const f = setup(), response = await handleRuleCaptures(post(), f.deps);
  assert.equal(response.status, 200); assert.deepEqual(f.calls, [{ query: ruleCapturesQuery, command: ruleCapturesCommand(), authUserId: owner, moduleEnabled: true }]);
  assert.deepEqual(await response.json(), { ok: true, moduleEnabled: true, data: ruleCapturesResult() }); privateHeaders(response);
});

test("paused GET and same-ID POST still reach SQL with false, allowing recovery but not granting a new write", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof ruleCapturesDependencies.entitlement>> });
  for (const request of [get(), post()]) {
    const response = await handleRuleCaptures(request, f.deps); assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  }
  assert.deepEqual(f.calls.map(input => [input.authUserId, input.moduleEnabled]), [[owner, false], [owner, false]]);
  const denied = setup({ ...f.deps, execute: async input => { assert.equal(input.moduleEnabled, false); throw new MerchantAttendanceError("attendance_platform_paused"); } });
  const response = await handleRuleCaptures(post(), denied.deps); assert.equal(response.status, 403); assert.deepEqual(await response.json(), { ok: false, error: "attendance_platform_paused" });
});

test("GET rejects missing IDs, duplicate keys, dates, forged authority, supplied source and pagination", async () => {
  const f = setup();
  const requests = [new Request(url), new Request(url + "?" + new URLSearchParams({ siteId: ruleCapturesQuery.siteId, workerId: ruleCapturesQuery.workerId })),
    get("&siteId=99990002"), get("&workerId=" + ruleSourcesId(202)), get("&operationId=" + ruleSourcesId(904)),
    get("&fromDate=2026-10-05"), get("&throughDate=2026-10-05"), get("&actorId=" + owner), get("&moduleEnabled=true"), get("&sourceText={}"), get("&beforeRevision=1")];
  for (const request of requests) assert.equal((await handleRuleCaptures(request, f.deps)).status, 400);
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("POST rejects ambiguous URL queries, mismatched operation, extra source/actor/switches and invalid date/reason ranges", async () => {
  const f = setup(), good = body();
  const values = [{ ...good, source: {} }, { ...good, moduleEnabled: true }, { ...good, actorId: owner },
    { query: { ...good.query, actorId: owner }, command: good.command },
    ...[{ operationId: ruleSourcesId(9999) }, { sourceText: "{}" }, { source: {} }, { authUserId: owner }, { moduleEnabled: true },
      { fromDate: "2026-09-29", throughDate: "2026-10-06" }, { fromDate: "2026-10-05", throughDate: "2026-10-04" },
      { fromDate: "1999-12-31", throughDate: "2000-01-01" }, { fromDate: "2026-02-30", throughDate: "2026-03-01" },
      { reason: "" }, { reason: "x".repeat(201) }, { reason: "x\u0000" }, { employeeId: null }, { employeeAuthUserId: "bad-id" }].map(patch => ({ query: good.query, command: { ...good.command, ...patch } }))];
  for (const value of values) assert.equal((await handleRuleCaptures(post(value), f.deps)).status, 400);
  assert.equal((await handleRuleCaptures(new Request(get().url, post()), f.deps)).status, 400);
  assert.equal(f.entitlements.length, 0); assert.equal(f.calls.length, 0);
});

test("POST requires JSON with UTF-8 media type and never forwards malformed or missing JSON", async () => {
  const f = setup();
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "application/problem+json", "application/json; charset=utf-16", "application/json; boundary=abc", ""]) {
    assert.equal((await handleRuleCaptures(post(body(), { "content-type": contentType }), f.deps)).status, 415);
  }
  for (const value of ["", "{", "null", "[]", "true", "1", '"text"']) assert.equal((await handleRuleCaptures(rawPost(value), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await handleRuleCaptures(post(body(), { "content-type": 'Application/JSON; charset="UTF-8"' }), f.deps)).status, 200);
});

test("8192-byte maximum counts actual streamed bytes, not characters or a forged content-length", async () => {
  const f = setup(), json = JSON.stringify(body()), bytes = new TextEncoder().encode(json).byteLength, exact = json + " ".repeat(8192 - bytes);
  assert.equal((await handleRuleCaptures(rawPost(exact), f.deps)).status, 200);
  for (const request of [rawPost(exact + " "), rawPost(exact + " ", { "content-length": "1" }), rawPost(json, { "content-length": "8193" }), rawPost(json, { "content-length": "-1" }), rawPost(json, { "content-length": "bogus" }), post({ ...body(), command: { ...ruleCapturesCommand(), reason: "中".repeat(3000) } })]) {
    const response = await handleRuleCaptures(request, f.deps); assert.equal(response.status, 413); assert.deepEqual(await response.json(), { ok: false, error: "attendance_body_too_large" }); privateHeaders(response);
  }
  assert.equal(f.calls.length, 1);
});

test("invalid UTF-8 inside a JSON string is rejected instead of accepting replacement characters", async () => {
  const f = setup(), json = JSON.stringify({ ...body(), command: { ...ruleCapturesCommand(), reason: "PLACEHOLDER" } }), [prefix, suffix] = json.split("PLACEHOLDER");
  for (const middle of [[0xc3, 0x28], [0xed, 0xa0, 0x80], [0xff]]) {
    const bytes = new Uint8Array([...new TextEncoder().encode(prefix), ...middle, ...new TextEncoder().encode(suffix)]);
    const response = await handleRuleCaptures(rawPost(bytes), f.deps); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  assert.equal((await handleRuleCaptures(rawPost(new Uint8Array([0xc3])), f.deps)).status, 400); assert.equal(f.calls.length, 0);
});

test("valid UTF-8 split across chunks is accepted and oversized stream cancellation cannot replace its safe error", async () => {
  const f = setup(), value = { ...body(), command: { ...ruleCapturesCommand(), reason: "合成留存" } }, encoded = new TextEncoder().encode(JSON.stringify(value));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of encoded) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const request = new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  assert.equal((await handleRuleCaptures(request, f.deps)).status, 200); assert.equal(f.calls[0].command?.reason, "合成留存");
  let cancelled = 0;
  const large = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { cancelled++; return Promise.reject(Error("private cancel detail")); } });
  const overflow = new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: large, duplex: "half" } as RequestInit & { duplex: "half" });
  const response = await handleRuleCaptures(overflow, f.deps); assert.equal(response.status, 413); assert.equal(cancelled, 1); assert.equal(f.calls.length, 1);
});

test("a hanging request body reaches the one total deadline even if cancellation never resolves", { timeout: 1000 }, async () => {
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; return new Promise<void>(() => {}); } });
  const request = new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  const f = setup({ bodyTimeoutMs: 20 }), response = await handleRuleCaptures(request, f.deps);
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  assert.equal(cancelled, 1); assert.equal(f.calls.length, 0); assert.equal(f.entitlements.length, 0); privateHeaders(response);
});

test("successive small chunks cannot reset the total body deadline", { timeout: 1000 }, async () => {
  let interval: ReturnType<typeof setInterval> | undefined, chunks = 0, cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(body())));
      interval = setInterval(() => { chunks++; controller.enqueue(new Uint8Array([32])); if (chunks === 12) { clearInterval(interval); controller.close(); } }, 5);
    },
    cancel() { cancelled++; clearInterval(interval); },
  });
  try {
    const request = new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const f = setup({ bodyTimeoutMs: 20 }), response = await handleRuleCaptures(request, f.deps);
    assert.equal(response.status, 400); assert(chunks < 12); assert.equal(cancelled, 1); assert.equal(f.calls.length, 0);
  } finally { clearInterval(interval); }
});

test("pre-aborted and mid-body aborted requests cancel the reader and never reach capture SQL", { timeout: 1000 }, async () => {
  for (const immediate of [true, false]) {
    let cancelled = 0; const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    if (immediate) controller.abort();
    const request = new Request(url, { method: "POST", signal: controller.signal, headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    const f = setup({ bodyTimeoutMs: 500 }), pending = handleRuleCaptures(request, f.deps);
    const timer = immediate ? null : setTimeout(() => controller.abort(), 5);
    try { const response = await pending; assert.equal(response.status, 400); assert.equal(cancelled, 1); assert.equal(f.calls.length, 0); }
    finally { if (timer !== null) clearTimeout(timer); }
  }
});

test("body timeout injection cannot raise the production ceiling and successful reads remove abort listeners", async () => {
  assert.equal(ruleCapturesDependencies.bodyTimeoutMs, 5000);
  for (const bodyTimeoutMs of [0, -1, 5001, Number.NaN, 1.5]) {
    const f = setup({ bodyTimeoutMs }); assert.equal((await handleRuleCaptures(post(), f.deps)).status, 503); assert.equal(f.calls.length, 0);
  }
  let cancelled = 0; const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(body()))); c.close(); }, cancel() { cancelled++; } });
  const request = new Request(url, { method: "POST", signal: controller.signal, headers: { origin: "https://www.faolla.com", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  const f = setup(); assert.equal((await handleRuleCaptures(request, f.deps)).status, 200); controller.abort();
  assert.equal(cancelled, 0); assert.equal(f.calls.length, 1);
});

test("all documented capture errors retain only their safe code and status, with no source data", async () => {
  for (const [code, status] of Object.entries(RULE_CAPTURES_ERRORS)) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleRuleCaptures(get(), f.deps); assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), { ok: false, error: code }); privateHeaders(response);
  }
});

test("authentication and entitlement failures deny access; unexpected private errors are redacted", async () => {
  for (const [code, status] of [["unauthorized", 401], ["authentication_required", 401], ["enterprise_auth_unavailable", 503], ["enterprise_entitlement_unavailable", 503], ["enterprise_management_disabled", 403]] as const) {
    const f = setup({ authenticate: async () => { throw new MerchantEnterpriseAccessError(code, status); } });
    const response = await handleRuleCaptures(get(), f.deps); assert.equal(response.status, status); assert.deepEqual(await response.json(), { ok: false, error: code }); assert.equal(f.calls.length, 0);
  }
  for (const error of [Error("secret SQL detail"), new MerchantAttendanceError("secret_code"), new MerchantEnterpriseAccessError("private SQL details", 500), new MerchantEnterpriseAccessError("unauthorized", 200)]) {
    const response = await handleRuleCaptures(get(), setup({ execute: async () => { throw error; } }).deps);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
  const f = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleRuleCaptures(post(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
});

test("capture route is a dynamic standalone GET/POST entry with no old source or writer RPC", () => {
  const source = readFileSync(new URL("../app/api/merchant-enterprise/attendance/rule-captures/route.ts", import.meta.url), "utf8");
  assert.match(source, /dynamic = "force-dynamic"/); assert.match(source, /export const GET/); assert.match(source, /export const POST/);
  assert.doesNotMatch(source, /attendance\/(?:rules|personal-rules|sources)|executeRuleSources|executePersonalRules/);
});

test("service rejects a missing privileged RPC client without contacting any alternative backend", async () => {
  await assert.rejects(executeRuleCaptures({ query: ruleCapturesQuery, authUserId: owner, command: null, moduleEnabled: false }, null), /attendance_unavailable/);
});

test("actual service binds precisely one dedicated RPC to server-owned actor, command and paused switch", async () => {
  const calls: unknown[] = [], original = ruleCapturesResult();
  for (const command of [null, ruleCapturesCommand()]) {
    const input = { query: ruleCapturesQuery, authUserId: owner, command, moduleEnabled: false };
    const result = await executeRuleCaptures(input, { rpc: async (name, args) => {
      calls.push({ name, args }); assert.equal(name, "faolla_attendance_rule_captures_v1");
      assert.deepEqual(args, { p_query: ruleCapturesQuery, p_auth_user_id: owner, p_command: command, p_module_enabled: false });
      return { data: original, error: null };
    } });
    assert.equal(result, original); assert.equal(original.receipt!.sourceText, ruleCapturesResult().receipt!.sourceText);
  }
  assert.equal(calls.length, 2);
});

test("handler through real service returns only a validated original capture, including exact UTF8 bytes", async () => {
  const raw = ruleCapturesResult(), source = JSON.parse(raw.receipt!.sourceText) as ReturnType<typeof ruleSourcesPopulated>;
  source.worker.workerName = "合成🙂";
  const text = JSON.stringify(source, null, 1); raw.receipt!.sourceText = text; raw.receipt!.sourceBytes = Buffer.byteLength(text, "utf8");
  raw.receipt!.sourceSha256 = createHash("sha256").update(text, "utf8").digest("hex");
  let calls = 0;
  const f = setup({ execute: input => executeRuleCaptures(input, { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_rule_captures_v1"); assert.equal(args.p_auth_user_id, owner); assert.equal(args.p_module_enabled, true);
    return { data: raw, error: null };
  } }) });
  const response = await handleRuleCaptures(post(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, moduleEnabled: true, data: raw }); assert.equal(calls, 1);
  assert(raw.receipt!.sourceBytes > text.length); assert.equal(raw.receipt!.applied, false); assert.equal(raw.receipt!.historicalApplicationProven, false);
});

test("real service rejects source hash, byte length, metadata and command mismatches before route disclosure", async () => {
  const corruptions: Array<(raw: ReturnType<typeof ruleCapturesResult>) => void> = [
    raw => { raw.actorId = ruleSourcesId(98); }, raw => { raw.siteId = "99990002"; }, raw => { raw.workerId = ruleSourcesId(202); },
    raw => { raw.operationId = ruleSourcesId(5009); }, raw => { raw.receipt!.sourceSha256 = "0".repeat(64); },
    raw => { raw.receipt!.sourceBytes++; }, raw => { raw.receipt!.sourceText += " "; },
    raw => { raw.receipt!.command.reason = "not the requested reason"; }, raw => { raw.receipt!.sourceReadAt = "2026-10-04T12:00:00.000000Z"; },
    raw => { raw.receipt!.actorId = ruleSourcesId(98); }, raw => { raw.receipt!.observedAt = "2026-10-04T12:00:00.000005Z"; },
    raw => { Object.assign(raw.receipt!, { applied: true }); }, raw => { Object.assign(raw.receipt!, { historicalApplicationProven: true }); },
  ];
  for (const corrupt of corruptions) {
    const raw = ruleCapturesResult(); corrupt(raw);
    const f = setup({ execute: input => executeRuleCaptures(input, { rpc: async () => ({ data: raw, error: null }) }) });
    const response = await handleRuleCaptures(post(), f.deps); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_rule_capture_invalid" }); privateHeaders(response);
  }
});

test("a correct hash cannot authorize unrelated or incomplete saved source metadata", async () => {
  for (const edit of [
    (source: ReturnType<typeof ruleSourcesPopulated>) => { source.siteId = "99990002"; },
    (source: ReturnType<typeof ruleSourcesPopulated>) => { source.actorId = ruleSourcesId(98); },
    (source: ReturnType<typeof ruleSourcesPopulated>) => { source.worker.employeeAuthUserId = ruleSourcesId(500); },
    (source: ReturnType<typeof ruleSourcesPopulated>) => { source.personal = { revision: 3, limited: true, items: [] }; },
  ]) {
    const raw = ruleCapturesResult(), source = JSON.parse(raw.receipt!.sourceText) as ReturnType<typeof ruleSourcesPopulated>; edit(source);
    const text = JSON.stringify(source); raw.receipt!.sourceText = text; raw.receipt!.sourceBytes = Buffer.byteLength(text, "utf8");
    raw.receipt!.sourceSha256 = createHash("sha256").update(text, "utf8").digest("hex");
    await assert.rejects(executeRuleCaptures({ query: ruleCapturesQuery, authUserId: owner }, { rpc: async () => ({ data: raw, error: null }) }), /attendance_rule_capture_invalid/);
  }
});

test("unknown GET is null but a POST without its immutable receipt fails closed", async () => {
  const raw = ruleCapturesResult(); raw.receipt = null;
  const f = setup({ execute: input => executeRuleCaptures(input, { rpc: async () => ({ data: raw, error: null }) }) });
  const found = await handleRuleCaptures(get(), f.deps); assert.equal(found.status, 200); assert.equal((await found.json()).data.receipt, null);
  const missing = await handleRuleCaptures(post(), f.deps); assert.equal(missing.status, 503); assert.deepEqual(await missing.json(), { ok: false, error: "attendance_rule_capture_invalid" });
});

test("privileged RPC failures expose only exact documented error codes, not embedded details", async () => {
  for (const message of ["private SQL detail", "attendance_access_denied: private context", " attendance_access_denied", "attendance_rule_capture_invalid\nsecret"]) {
    await assert.rejects(executeRuleCaptures({ query: ruleCapturesQuery, authUserId: owner }, { rpc: async () => ({ data: null, error: { message } }) }), /attendance_unavailable/);
  }
  await assert.rejects(executeRuleCaptures({ query: ruleCapturesQuery, authUserId: owner }, { rpc: async () => { throw Error("private network detail"); } }), /attendance_unavailable/);
  await assert.rejects(executeRuleCaptures({ query: ruleCapturesQuery, authUserId: owner }, { rpc: async () => ({ data: null, error: { message: "attendance_rule_capture_limit" } }) }), /attendance_rule_capture_limit/);
});
