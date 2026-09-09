import assert from "node:assert/strict";
import test from "node:test";
import {
  capturePlatformAdminBackupRestoreReceiptBinding, createPlatformAdminBackupRestoreOperationId,
  lookupPlatformAdminBackupRestoreReceiptOnce, parsePlatformAdminBackupRestoreReceiptLookup,
  PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES,
  type PlatformAdminBackupRestoreReceiptBinding, type PlatformAdminBackupRestoreReceiptLookup,
} from "./platformAdminBackupRestoreReceiptClient";
import { createPlatformAdminBackupRestoreSyncGuard } from "./platformAdminBackupRestoreClient";

const operationId = "00000000-0000-4000-8000-000000000001";
const binding = (): PlatformAdminBackupRestoreReceiptBinding => ({ operationId, scope: "support_messages",
  backupId: "备份-10000000?x=&y", confirmationToken: `v1.${"a".repeat(64)}` });
const committed = (): PlatformAdminBackupRestoreReceiptLookup => ({ ok: true, outcome: "committed", receipt: {
  version: 1, ...binding(), planHash: "b".repeat(64), resultHash: "c".repeat(64), committedAt: "2026-09-09T12:00:00.123456+02:00",
} });
const unknown = (): PlatformAdminBackupRestoreReceiptLookup => ({ ok: true, outcome: "unknown", receipt: null });
const unconfirmed = { message: "super_admin_backup_restore_receipt_lookup_unconfirmed" };
const invalid = { message: "super_admin_backup_restore_receipt_invalid_request" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }

test("binding capture accepts exact public fields only and detaches caller values", () => {
  const input = binding(); const result = capturePlatformAdminBackupRestoreReceiptBinding(input);
  assert.deepEqual(result, input); assert.notEqual(result, input);
  input.backupId = "changed"; assert.equal(result.backupId, binding().backupId);
  const nullPrototype = Object.assign(Object.create(null), binding());
  assert.deepEqual(capturePlatformAdminBackupRestoreReceiptBinding(nullPrototype), binding());
});

test("operation ID generation is explicit cryptographic UUID and never occurs during lookup", async () => {
  const id = createPlatformAdminBackupRestoreOperationId();
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(id, createPlatformAdminBackupRestoreOperationId());
  let calls = 0;
  const generated = { ...binding(), operationId: id };
  await lookupPlatformAdminBackupRestoreReceiptOnce(async (url) => {
    calls++; assert.equal(new URL(url, "https://example.test").searchParams.get("operationId"), id); return Response.json(unknown());
  }, generated);
  assert.equal(calls, 1); assert.equal(generated.operationId, id);
});

for (const [field, value] of [
  ["operationId", "ABCDEFAB-0000-4000-8000-000000000001"], ["operationId", "not-a-uuid"], ["operationId", operationId + " "],
  ["scope", "backup_catalog"], ["scope", "support_messages "], ["backupId", ""], ["backupId", " trimmed "],
  ["backupId", "x".repeat(501)], ["confirmationToken", `v1.${"A".repeat(64)}`], ["confirmationToken", `v2.${"a".repeat(64)}`],
] as const) {
  test(`invalid ${field} binding is refused before any request`, async () => {
    const input = { ...binding(), [field]: value } as PlatformAdminBackupRestoreReceiptBinding; let calls = 0;
    assert.throws(() => capturePlatformAdminBackupRestoreReceiptBinding(input), invalid);
    assert.equal(parsePlatformAdminBackupRestoreReceiptLookup(committed(), input), null);
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; return Response.json(unknown()); }, input), invalid);
    assert.equal(calls, 0);
  });
}

test("binding extra/missing/actor fields and getters are rejected without invoking getters", () => {
  for (const input of [null, [], {}, { ...binding(), actorKey: "private" }, { ...binding(), secret: "private" }]) {
    assert.throws(() => capturePlatformAdminBackupRestoreReceiptBinding(input), invalid);
  }
  let reads = 0; const input = binding();
  Object.defineProperty(input, "backupId", { enumerable: true, get() { reads++; throw new Error("PRIVATE"); } });
  assert.throws(() => capturePlatformAdminBackupRestoreReceiptBinding(input), invalid); assert.equal(reads, 0);
  const proxy = new Proxy(binding(), { ownKeys() { throw new Error("PRIVATE proxy details"); } });
  assert.throws(() => capturePlatformAdminBackupRestoreReceiptBinding(proxy), invalid);
});

test("committed and unknown envelopes are exact, detached and do not contain actor or raw backup data", () => {
  const input = committed(); const result = parsePlatformAdminBackupRestoreReceiptLookup(input, binding());
  assert.deepEqual(result, input); assert.notEqual(result, input);
  assert.ok(input.outcome === "committed"); input.receipt.planHash = "d".repeat(64);
  assert.ok(result?.outcome === "committed"); assert.equal(result.receipt.planHash, "b".repeat(64));
  assert.deepEqual(parsePlatformAdminBackupRestoreReceiptLookup(unknown(), binding()), unknown());
  assert.deepEqual(Object.keys(result.receipt).sort(), ["version", "operationId", "scope", "backupId", "confirmationToken", "planHash", "resultHash", "committedAt"].sort());
});

test("user-management receipts and maximum-length backup bindings use the same strict public contract", () => {
  const expected: PlatformAdminBackupRestoreReceiptBinding = { ...binding(), scope: "user_manage", backupId: "x".repeat(500) };
  const input = committed(); assert.ok(input.outcome === "committed"); Object.assign(input.receipt, expected);
  assert.deepEqual(capturePlatformAdminBackupRestoreReceiptBinding(expected), expected);
  assert.deepEqual(parsePlatformAdminBackupRestoreReceiptLookup(input, expected), input);
});

test("contradictory outcomes, unknown properties and incomplete receipt fields cannot confirm a commit", () => {
  const valid = committed(); assert.ok(valid.outcome === "committed");
  const values = [null, [], {}, { ...valid, ok: false }, { ...valid, outcome: "pending" }, { ...valid, outcome: "unknown" },
    { ...valid, receipt: null }, { ...valid, actorKey: "private" }, { ...valid, receipt: { ...valid.receipt, actorKey: "private" } },
    { ...unknown(), receipt: {} }, { ...unknown(), extra: true }];
  for (const key of Object.keys(valid.receipt)) {
    const receipt = { ...valid.receipt }; Reflect.deleteProperty(receipt, key); values.push({ ...valid, receipt });
  }
  for (const value of values) assert.equal(parsePlatformAdminBackupRestoreReceiptLookup(value, binding()), null);
});

for (const [field, value] of [
  ["version", 2], ["operationId", "00000000-0000-4000-8000-000000000002"], ["scope", "user_manage"],
  ["backupId", "another backup"], ["confirmationToken", `v1.${"d".repeat(64)}`],
  ["planHash", "b".repeat(63)], ["planHash", "B".repeat(64)], ["resultHash", "z".repeat(64)], ["resultHash", 0],
] as const) {
  test(`receipt ${field} must match binding/schema exactly`, () => {
    const valueToRead = committed(); assert.ok(valueToRead.outcome === "committed");
    Object.assign(valueToRead.receipt, { [field]: value });
    assert.equal(parsePlatformAdminBackupRestoreReceiptLookup(valueToRead, binding()), null);
  });
}

test("committed timestamp preserves six-digit precision/offset and validates real Gregorian calendar", () => {
  const valid = ["2026-09-09T12:00:00Z", "2024-02-29T23:59:59.1Z", "2000-02-29T12:00:00.123456-03:30",
    "2026-01-31T12:00:00+02:00", "2026-04-30T12:00:00.000001Z"];
  const invalidDates = ["2026-02-29T12:00:00Z", "1900-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-09-31T12:00:00Z",
    "2026-00-01T12:00:00Z", "2026-13-01T12:00:00Z", "2026-01-00T12:00:00Z", "2026-01-32T12:00:00Z",
    "0000-01-01T12:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T23:60:00Z", "2026-01-01T23:59:60Z",
    "2026-01-01T12:00:00+24:00", "2026-01-01T12:00:00+00:60", "2026-01-01T12:00:00.1234567Z",
    "2026-01-01 12:00:00Z", "2026-01-01T12:00:00", "2026-01-01T12:00:00Z ", "infinity"];
  for (const committedAt of [...valid, ...invalidDates]) {
    const input = committed(); assert.ok(input.outcome === "committed"); input.receipt.committedAt = committedAt;
    const result = parsePlatformAdminBackupRestoreReceiptLookup(input, binding());
    if (valid.includes(committedAt)) { assert.ok(result?.outcome === "committed"); assert.equal(result.receipt.committedAt, committedAt); }
    else assert.equal(result, null, committedAt);
  }
});

test("lookup sends one fixed-origin no-store GET with all encoded binding fields and no body", async () => {
  let calls = 0;
  const actual = await lookupPlatformAdminBackupRestoreReceiptOnce(async (url, init) => {
    calls++; const parsed = new URL(url, "https://example.test");
    assert.equal(parsed.pathname, "/api/super-admin/data-backups/restore-operations");
    assert.deepEqual(Object.fromEntries(parsed.searchParams), binding());
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store");
    assert.equal(init.mode, "same-origin"); assert.equal(init.redirect, "error"); assert.equal(init.body, undefined);
    return Response.json(committed());
  }, binding());
  assert.equal(calls, 1); assert.deepEqual(actual, committed());
});

test("lookup captures the complete expected binding before awaiting the request", async () => {
  const expected = binding(); const gate = deferred<Response>(); let sent = "";
  const operation = lookupPlatformAdminBackupRestoreReceiptOnce(async (url) => { sent = url; return gate.promise; }, expected);
  Object.assign(expected, { operationId: "00000000-0000-4000-8000-000000000099", backupId: "changed", scope: "user_manage", confirmationToken: `v1.${"e".repeat(64)}` });
  gate.resolve(Response.json(committed()));
  assert.deepEqual(await operation, committed()); assert.deepEqual(Object.fromEntries(new URL(sent, "https://example.test").searchParams), binding());
});

test("lookup decoding preserves multibyte characters split across chunks", async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(committed()));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte)); controller.close();
  } });
  assert.deepEqual(await lookupPlatformAdminBackupRestoreReceiptOnce(async () => new Response(body), binding()), committed());
});

test("unknown lookup leaves existing unknown synchronization guard blocked", async () => {
  for (const response of [unknown(), committed()]) {
    const guard = createPlatformAdminBackupRestoreSyncGuard(); guard.block();
    assert.deepEqual(await lookupPlatformAdminBackupRestoreReceiptOnce(async () => Response.json(response), binding()), response);
    assert.equal(guard.isPaused(), true); assert.equal(guard.resume(), false);
  }
});

for (const status of [201, 204, 301, 401, 403, 404, 409, 500, 503]) {
  test(`HTTP ${status} cannot be reinterpreted as unknown or retried`, async () => {
    let calls = 0;
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => {
      calls++; return new Response(status === 204 ? null : JSON.stringify(committed()), { status });
    }, binding()), unconfirmed);
    assert.equal(calls, 1);
  });
}

test("network rejection and malformed or contradictory 200 responses use one fixed failure", async () => {
  const responses = ["not json", "", '{"ok":true}', JSON.stringify({ ...unknown(), outcome: "committed" }),
    JSON.stringify({ ...unknown(), actorKey: "PRIVATE" })];
  for (const body of responses) {
    let calls = 0;
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; return new Response(body); }, binding()), unconfirmed);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; throw new Error("PRIVATE transport details"); }, binding()), unconfirmed);
  assert.equal(calls, 1);
});

test("oversized declared or streamed body is refused and cancelled, including stalled cancellation", { timeout: 5000 }, async () => {
  for (const declared of [String(PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES + 1), "NaN", "-1"]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(committed()))); }, cancel() { cancelled = true; } });
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => new Response(body, { headers: { "content-length": declared } }), binding()), unconfirmed);
    assert.equal(cancelled, true);
  }
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(PLATFORM_ADMIN_BACKUP_RESTORE_RECEIPT_MAX_BYTES + 1)); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); } });
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => new Response(body), binding(), { timeoutMs: 30 }), unconfirmed);
  assert.equal(cancelled, true);
});

test("invalid UTF-8 is not silently replaced in receipt fields", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(committed())); bytes[40] = 0xff;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => new Response(bytes), binding()), unconfirmed);
});

test("deadline covers headers even when fetch ignores abort, and disposes any late body", { timeout: 5000 }, async () => {
  const gate = deferred<Response>(); let calls = 0; let requestSignal: AbortSignal | null | undefined;
  const operation = lookupPlatformAdminBackupRestoreReceiptOnce(async (_url, init) => { calls++; requestSignal = init.signal; return gate.promise; }, binding(), { timeoutMs: 5 });
  await assert.rejects(operation, unconfirmed); assert.equal(calls, 1); assert.equal(requestSignal?.aborted, true);
  let cancelled = false;
  gate.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise((resolve) => setTimeout(resolve, 0)); assert.equal(cancelled, true);
});

test("deadline includes stalled response body and cancellation does not extend it", { timeout: 5000 }, async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); },
    cancel() { cancelled = true; return new Promise<void>(() => undefined); } });
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => new Response(body), binding(), { timeoutMs: 5 }), unconfirmed);
  assert.equal(cancelled, true);
});

test("caller abort is honored before sending and during body read without a retry", { timeout: 5000 }, async () => {
  const before = new AbortController(); before.abort(); let calls = 0;
  await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; return Response.json(committed()); }, binding(), { signal: before.signal }), unconfirmed);
  assert.equal(calls, 0);
  const during = new AbortController(); const entered = deferred<void>(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { entered.resolve(); }, cancel() { cancelled = true; } });
  const operation = lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; return new Response(body); }, binding(), { signal: during.signal });
  await entered.promise; during.abort(); await assert.rejects(operation, unconfirmed); assert.equal(calls, 1); assert.equal(cancelled, true);
});

test("invalid deadline options fail before network access", async () => {
  for (const timeoutMs of [0, -1, 1.5, NaN, 60_001]) {
    let calls = 0;
    await assert.rejects(lookupPlatformAdminBackupRestoreReceiptOnce(async () => { calls++; return Response.json(unknown()); }, binding(), { timeoutMs }), invalid);
    assert.equal(calls, 0);
  }
});
