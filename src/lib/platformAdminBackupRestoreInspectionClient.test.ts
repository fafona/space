import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePlatformAdminBackupRestoreInspection, inspectPlatformAdminBackupRestoreOnce } from "./platformAdminBackupRestoreInspectionClient";
import { inspectPlatformAdminBackupRestoreForAttempt } from "./platformAdminBackupRestoreInspectionWorkflow";
import { STORAGE_KEY, type RestoreJournalStorage } from "./platformAdminBackupRestoreJournal";
import { createPlatformAdminBackupRestoreSyncGuard } from "./platformAdminBackupRestoreClient";

function fixture() {
  const binding = { operationId: "00000000-0000-4000-8000-000000000001", scope: "user_manage" as const,
    backupId: "synthetic-backup", confirmationToken: `v1.${"a".repeat(64)}` };
  const attempt = { binding, deviceId: "verified-synthetic-device" };
  const receipt = { version: 1, ...binding, planHash: "b".repeat(64), resultHash: "c".repeat(64), committedAt: "2026-09-09T12:00:00.000001Z" };
  const result = { ok: true, outcome: "committed", receipt,
    inspection: { version: 1, observedAt: "2026-09-09T12:01:00.000002Z", targetState: "matches_commit", targetHash: receipt.resultHash } };
  return { binding, attempt, receipt, result };
}
const unknown = () => ({ ok: true, outcome: "unknown", receipt: null, inspection: null });
const identity = (deviceId = fixture().attempt.deviceId) => Response.json({ ok: true, authenticated: true, deviceId });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const safeError = /^Error: super_admin_backup_restore_inspection_unconfirmed$/;
function storage(value: string | null = JSON.stringify({ version: 1, attempt: fixture().attempt })) {
  let raw = value; let reads = 0; let writes = 0;
  const api: RestoreJournalStorage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); reads++; return raw; },
    setItem() { writes++; assert.fail("inspection must not write storage"); },
    removeItem() { writes++; assert.fail("inspection must not clear storage"); },
  };
  return { api, get raw() { return raw; }, set raw(next: string | null) { raw = next; },
    get reads() { return reads; }, get writes() { return writes; } };
}

test("inspection parser accepts only the exact hash relationship and captures detached metadata", () => {
  const { binding, result } = fixture();
  const parsed = parsePlatformAdminBackupRestoreInspection(result, binding);
  assert.deepEqual(parsed, result);
  result.inspection.targetHash = "d".repeat(64);
  assert.equal(parsePlatformAdminBackupRestoreInspection(result, binding), null);
  result.inspection.targetState = "differs_from_commit";
  assert.deepEqual(parsePlatformAdminBackupRestoreInspection(result, binding), result);
  result.inspection.targetHash = result.receipt.resultHash;
  assert.equal(parsePlatformAdminBackupRestoreInspection(result, binding), null);
  assert.equal(parsed?.inspection?.targetHash, "c".repeat(64));
});

test("missing receipt can only be unknown with no observation, never proof of no execution", () => {
  const { binding, result } = fixture();
  assert.deepEqual(parsePlatformAdminBackupRestoreInspection(unknown(), binding), unknown());
  for (const value of [{ ...unknown(), inspection: result.inspection }, { ...unknown(), receipt: result.receipt },
    { ...result, receipt: null }, { ...result, inspection: null }, { ...unknown(), outcome: "not_started" },
    { ...unknown(), canResolve: true }]) assert.equal(parsePlatformAdminBackupRestoreInspection(value, binding), null);
});

test("inspection parser rejects wrong bindings, missing fields, raw data and error envelopes", () => {
  const { binding, result } = fixture();
  for (const value of [null, [], {}, { ...result, ok: false }, { ...result, error: "PRIVATE SQL" },
    { ...result, target: { blocks: [{ private: "PRIVATE PII" }] } }, { ...result, actorKey: "PRIVATE" },
    { ...result, inspection: { ...result.inspection, pages: [] } },
    { ...result, receipt: { ...result.receipt, deviceId: "PRIVATE" } },
    { ...result, receipt: { ...result.receipt, backupId: "foreign" } },
    { ...result, receipt: { ...result.receipt, scope: "support_messages" } },
    { ...result, receipt: { ...result.receipt, operationId: "00000000-0000-4000-8000-000000000002" } },
    { ...result, receipt: { ...result.receipt, confirmationToken: `v1.${"e".repeat(64)}` } },
  ]) assert.equal(parsePlatformAdminBackupRestoreInspection(value, binding), null);
  for (const key of Object.keys(result)) {
    const missing: Record<string, unknown> = { ...result }; delete missing[key];
    assert.equal(parsePlatformAdminBackupRestoreInspection(missing, binding), null);
  }
  for (const key of Object.keys(result.inspection)) {
    const missing: Record<string, unknown> = { ...result.inspection }; delete missing[key];
    assert.equal(parsePlatformAdminBackupRestoreInspection({ ...result, inspection: missing }, binding), null);
  }
});

test("inspection parser strictly validates observation dates, version, hashes and status", () => {
  const { binding, result } = fixture();
  for (const change of [{ observedAt: "2026-02-30T12:00:00Z" }, { observedAt: "2026-09-09" },
    { observedAt: "2026-09-09T24:00:00Z" }, { observedAt: "2026-09-09T12:00:00+99:00" },
    { observedAt: "infinity" }, { observedAt: 1 }, { version: "1" }, { version: 2 },
    { targetState: "matches" }, { targetState: "not_started" }, { targetHash: "C".repeat(64) },
    { targetHash: "c".repeat(63) }, { targetHash: null }]) {
    assert.equal(parsePlatformAdminBackupRestoreInspection({ ...result, inspection: { ...result.inspection, ...change } }, binding), null);
  }
});

test("inspection parser does not execute getters or accept hidden fields, symbols or prototypes", () => {
  const { binding, result } = fixture(); let reads = 0;
  const getter = Object.defineProperty({ ...result }, "inspection", { enumerable: true, get() { reads++; return result.inspection; } });
  const nested = Object.defineProperty({ ...result.inspection }, "targetHash", { enumerable: true, get() { reads++; return "PRIVATE"; } });
  const hidden = Object.defineProperty({ ...result }, "private", { enumerable: false, value: "PRIVATE" });
  for (const value of [getter, hidden, { ...result, inspection: nested }, { ...result, [Symbol("private")]: 1 },
    Object.assign(Object.create({ private: true }), result)]) assert.equal(parsePlatformAdminBackupRestoreInspection(value, binding), null);
  assert.equal(reads, 0);
});

test("inspection sends exactly one fixed GET and never sends a body or actor metadata", async () => {
  const { binding, result } = fixture(); let calls = 0;
  const received = await inspectPlatformAdminBackupRestoreOnce(async (url, init) => {
    calls++;
    const parsed = new URL(url, "https://synthetic.invalid");
    assert.equal(parsed.pathname, "/api/super-admin/data-backups/restore-inspection");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), binding);
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "same-origin"); assert.equal(init.mode, "same-origin");
    assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error"); assert.equal(init.body, undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(result);
  }, binding);
  assert.deepEqual(received, result); assert.equal(calls, 1);
});

test("inspection does not retry HTTP failures, redirected responses, malformed data or thrown internals", async () => {
  const { binding } = fixture();
  for (const reply of [() => new Response(null, { status: 401 }), () => new Response(null, { status: 403 }),
    () => new Response(null, { status: 500 }), () => new Response("not-json"),
    () => Response.json({ ...unknown(), error: "PRIVATE database" }),
    () => Object.defineProperty(Response.json(unknown()), "redirected", { value: true }),
    () => { throw new Error("PRIVATE SQL credential"); }]) {
    let calls = 0;
    await assert.rejects(inspectPlatformAdminBackupRestoreOnce(async () => { calls++; return reply(); }, binding), safeError);
    assert.equal(calls, 1);
  }
});

test("inspection binding and abort/deadline validation fail before any request", async () => {
  const { binding } = fixture(); let calls = 0;
  const fetcher = async () => { calls++; return Response.json(unknown()); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(inspectPlatformAdminBackupRestoreOnce(fetcher, binding, { signal: controller.signal }), safeError);
  for (const timeoutMs of [0, -1, 0.5, Number.NaN, Infinity, 60_001]) {
    await assert.rejects(inspectPlatformAdminBackupRestoreOnce(fetcher, binding, { timeoutMs }), /inspection_invalid_request/);
  }
  await assert.rejects(inspectPlatformAdminBackupRestoreOnce(fetcher, { ...binding, operationId: "bad" }), /inspection_invalid_request/);
  assert.equal(calls, 0);
});

test("inspection enforces 32 KiB across body chunks, declarations and UTF-8 decoding", async () => {
  const { binding, result } = fixture();
  const json = JSON.stringify(result);
  const exactSize = json + " ".repeat(32_768 - Buffer.byteLength(json));
  assert.deepEqual(await inspectPlatformAdminBackupRestoreOnce(async () => new Response(exactSize), binding), result);
  const over = exactSize + " ";
  for (const response of [new Response(over), new Response(over, { headers: { "content-length": "1" } }),
    new Response(json, { headers: { "content-length": "32769" } }), new Response(json, { headers: { "content-length": "-1" } }),
    new Response(json, { headers: { "content-length": "bad" } }), new Response(new Uint8Array([0xff, 0xfe])),
    new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(json)); controller.enqueue(new Uint8Array(32_768).fill(32)); controller.close();
    } })),
  ]) await assert.rejects(inspectPlatformAdminBackupRestoreOnce(async () => response, binding), safeError);
});

test("inspection header timeout cancels a late response without retrying or exposing its result", { timeout: 2_000 }, async () => {
  const { binding } = fixture(); const pending = deferred<Response>(); let calls = 0; let cancelled = 0;
  await assert.rejects(inspectPlatformAdminBackupRestoreOnce(async () => { calls++; return pending.promise; }, binding, { timeoutMs: 1 }), safeError);
  pending.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await settle();
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});

test("inspection stalled body deadline and caller abort both cancel without waiting for stream cancellation", { timeout: 2_000 }, async () => {
  const { binding } = fixture();
  for (const mode of ["deadline", "abort"] as const) {
    let cancelled = 0; const entered = deferred<void>(); const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode("{")); },
      cancel() { cancelled++; return new Promise<void>(() => {}); },
    }));
    const active = inspectPlatformAdminBackupRestoreOnce(async () => { entered.resolve(); return response; }, binding,
      { timeoutMs: mode === "deadline" ? 1 : 1_000, signal: controller.signal });
    await entered.promise;
    if (mode === "abort") controller.abort();
    await assert.rejects(active, safeError); assert.ok(cancelled >= 1);
  }
});

test("inspection captures request binding before an awaiting fetch can mutate the caller input", async () => {
  const { binding, result } = fixture();
  const received = await inspectPlatformAdminBackupRestoreOnce(async () => {
    binding.backupId = "mutated"; return Response.json(result);
  }, binding);
  assert.equal(received.receipt?.backupId, "synthetic-backup");
});

test("workflow checks journal and both authenticated identities, sends only GETs and leaves journal and unknown guard intact", async () => {
  const { attempt, result } = fixture(); const s = storage(); const original = s.raw; const requests: string[] = [];
  const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
  const received = await inspectPlatformAdminBackupRestoreForAttempt(async (url, init) => {
    requests.push(url); assert.equal(init.method, "GET"); assert.equal(init.body, undefined);
    return url === "/api/super-admin/auth/session" ? identity() : Response.json(result);
  }, attempt, s.api);
  assert.deepEqual(received, result); assert.equal(requests.length, 3);
  assert.equal(requests[0], "/api/super-admin/auth/session"); assert.match(requests[1], /^\/api\/super-admin\/data-backups\/restore-inspection\?/);
  assert.equal(requests[2], "/api/super-admin/auth/session"); assert.ok(s.reads >= 3);
  assert.equal(s.raw, original); assert.equal(s.writes, 0); assert.equal(guard.resume(), false);
});

test("workflow refuses missing, corrupt, foreign or unreadable journals before network access", async () => {
  const { attempt } = fixture(); let calls = 0;
  const fetcher = async () => { calls++; return identity(); };
  const foreign = JSON.stringify({ version: 1, attempt: { ...attempt, deviceId: "other-device" } });
  for (const raw of [null, "bad", foreign, JSON.stringify({ version: 1, attempt: { ...attempt,
    binding: { ...attempt.binding, backupId: "other-backup" } } })]) {
    const s = storage(raw); await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(fetcher, attempt, s.api), /continuity_unconfirmed/);
    assert.equal(s.raw, raw); assert.equal(s.writes, 0);
  }
  const unavailable = storage(); unavailable.api.getItem = () => { throw new Error("PRIVATE storage failure"); };
  await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(fetcher, attempt, unavailable.api), /continuity_unconfirmed/);
  await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(fetcher, attempt, null), /continuity_unconfirmed/);
  assert.equal(calls, 0);
});

test("workflow rejects identity changes before or after inspection and never clears the pending record", async () => {
  const { attempt, result } = fixture();
  for (const changedAt of [1, 2]) {
    const s = storage(); const before = s.raw; let identities = 0; let requests = 0;
    await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(async (url) => {
      requests++;
      if (url === "/api/super-admin/auth/session") return identity(++identities === changedAt ? "different-device" : attempt.deviceId);
      return Response.json(result);
    }, attempt, s.api), /identity_unconfirmed/);
    assert.equal(requests, changedAt === 1 ? 1 : 3); assert.equal(s.raw, before); assert.equal(s.writes, 0);
  }
});

test("workflow suppresses inspection when the journal is replaced or deleted across either awaited boundary", async () => {
  const { attempt, result } = fixture();
  for (const changeAt of [1, 2, 3]) {
    for (const replacement of [null, "bad", JSON.stringify({ version: 1, attempt: { ...attempt,
      binding: { ...attempt.binding, operationId: "00000000-0000-4000-8000-000000000002" } } })]) {
      const s = storage(); let calls = 0;
      await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(async (url) => {
        if (++calls === changeAt) s.raw = replacement;
        return url === "/api/super-admin/auth/session" ? identity() : Response.json(result);
      }, attempt, s.api), /continuity_unconfirmed/);
      assert.equal(calls, changeAt === 1 ? 1 : 3); assert.equal(s.raw, replacement); assert.equal(s.writes, 0);
    }
  }
});

test("workflow abort before launch sends nothing; in-flight abort suppresses even a matching report", async () => {
  const { attempt, result } = fixture(); const s = storage(); const original = s.raw;
  const early = new AbortController(); early.abort(); let calls = 0;
  await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(async () => { calls++; return identity(); }, attempt, s.api, early.signal), /continuity_unconfirmed/);
  assert.equal(calls, 0);
  const later = new AbortController();
  await assert.rejects(inspectPlatformAdminBackupRestoreForAttempt(async (url) => {
    calls++;
    if (url !== "/api/super-admin/auth/session") { later.abort(); return Response.json(result); }
    return identity();
  }, attempt, s.api, later.signal));
  assert.equal(calls, 2); assert.equal(s.raw, original); assert.equal(s.writes, 0);
});

test("workflow unknown report remains unknown and never authorizes a clear or background mutation", async () => {
  const { attempt } = fixture(); const s = storage(); const original = s.raw;
  assert.deepEqual(await inspectPlatformAdminBackupRestoreForAttempt(async (url, init) => {
    assert.equal(init.method, "GET"); return url === "/api/super-admin/auth/session" ? identity() : Response.json(unknown());
  }, attempt, s.api), unknown());
  assert.equal(s.raw, original); assert.equal(s.writes, 0);
  const source = readFileSync(new URL("./platformAdminBackupRestoreInspectionWorkflow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /clearRestoreJournal|writeRestoreJournal|\.removeItem\(|\.setItem\(|\.resume\(|method:\s*["'](?:PATCH|POST|DELETE)["']/);
});
