import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { boundedDelegationRecoveryAuth, DELEGATION_RECOVERY_AUTH_TIMEOUT_MS, listKnownDelegationRecoveries, parseKnownDelegationRecovery, recoverKnownDelegation, type DelegationRecoveryStorage } from "./merchantAttendanceDelegationRecovery";
import { missingDelegationPendingKey } from "./merchantAttendanceMissingDelegationClient";
import { applicationDelegationPendingKey } from "./merchantAttendanceApplicationDelegationClient";
import { missingDelegationCommandFingerprint, parseMissingDelegationHttpQuery } from "./merchantAttendanceMissingDelegation";
import { applicationDelegationCommandFingerprint, parseApplicationDelegationHttpQuery } from "./merchantAttendanceApplicationDelegation";
import { missingDelegationId as id, missingDelegationCommand as missingCommand, missingDelegationQuery as missingQuery,
  missingDelegationReceiptHttp as missingReceipt } from "../../scripts/fixtures/attendance-missing-delegation-model";
import { applicationDelegationCommand as applicationCommand, applicationDelegationQuery as applicationQuery,
  applicationDelegationReceiptHttp as applicationReceipt, applicationDelegationGrantCommand } from "../../scripts/fixtures/attendance-application-delegation-model";

function memory() { const values = new Map<string, string>(); const storage: DelegationRecoveryStorage = { get length() { return values.size; }, key: n => [...values.keys()][n] ?? null,
  getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; return { values, storage }; }
const isCurrentAuth = () => true;
async function fixture(kind: "missing" | "leave" | "work_arrangement" | "owner" = "missing") {
  const mem = memory(), owner = kind === "owner", auth = owner ? id(1) : id(3), anchor = owner ? id(1) : id(2);
  const access = owner ? "owner" : "delegate", missing = kind === "missing", category = kind === "work_arrangement" ? "work_arrangement" : "leave";
  const command = missing ? missingCommand() : owner ? applicationDelegationGrantCommand() : applicationCommand(category);
  const query = missing ? missingQuery("delegate", "decide") : applicationQuery(access, owner ? "list" : "decide");
  const key = missing ? missingDelegationPendingKey(query.siteId, access, anchor) : applicationDelegationPendingKey(query.siteId, access, anchor);
  const fingerprint = missing ? await missingDelegationCommandFingerprint(query.siteId, access, missingCommand())
    : await applicationDelegationCommandFingerprint(query.siteId, access, owner ? applicationDelegationGrantCommand() : applicationCommand(category));
  const raw = JSON.stringify({ version: 1, anchorId: anchor, actorId: auth, employeeId: owner ? null : anchor, query, command, commandFingerprint: fingerprint });
  mem.storage.setItem(key, raw); const entry = await parseKnownDelegationRecovery(key, raw, auth); assert(entry);
  return { ...mem, auth, entry, key, raw, command, missing };
}

test("scan only exposes verified current-account IDs, never local body or foreign account", async () => {
  const f = await fixture("missing"), other = await fixture("leave");
  f.storage.setItem(other.key, other.raw.replace(id(3), id(99))); f.storage.setItem("unrelated", "not parsed");
  const found = await listKnownDelegationRecoveries(f.storage, f.auth, isCurrentAuth);
  assert.equal(found.entries.length, 1); assert.equal(found.invalid, false);
  assert.doesNotMatch(JSON.stringify(found), /Synthetic|reason|proposal|employeeAuth|000000000099/);
  assert.equal(f.storage.getItem(f.key), f.raw);
});

for (const kind of ["missing", "leave", "work_arrangement", "owner"] as const) {
  test(`${kind} authenticates exact persisted intent and sends one GET only with flags off`, async () => {
    const f = await fixture(kind), calls: string[] = [];
    const receipt = await recoverKnownDelegation(f.entry, { storage: f.storage, authenticatedUserId: f.auth, signal: new AbortController().signal, isCurrentAuth,
      apiFetch: async (path, init) => { assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); calls.push(path);
        const raw = kind === "missing" ? await missingReceipt(parseMissingDelegationHttpQuery("https://example.test" + path), missingCommand())
          : await applicationReceipt(parseApplicationDelegationHttpQuery("https://example.test" + path), kind === "owner" ? applicationDelegationGrantCommand() : applicationCommand(kind));
        return Response.json(raw); } });
    assert.equal(calls.length, 1); assert(calls[0].includes("mode=recover")); assert.equal(receipt?.operationId, f.entry.operationId);
    assert.equal(f.storage.getItem(f.key), null); assert.doesNotMatch(JSON.stringify(receipt), /Synthetic|reason|command|workerName|category/);
  });
}

test("different authenticated user and tampered hash/key refuse locally and preserve the intent", async () => {
  const f = await fixture("leave"); let called = 0;
  await assert.rejects(recoverKnownDelegation(f.entry, { authenticatedUserId: id(99), storage: f.storage, signal: new AbortController().signal, isCurrentAuth, apiFetch: async () => { called++; throw Error(); } }));
  assert.equal(await parseKnownDelegationRecovery(f.key, f.raw, id(99)), null);
  await assert.rejects(parseKnownDelegationRecovery(f.key.replace("99990001", "99990002"), f.raw, f.auth));
  const bad = JSON.parse(f.raw); bad.command.decision.reason = "altered";
  await assert.rejects(parseKnownDelegationRecovery(f.key, JSON.stringify(bad), f.auth));
  assert.equal(called, 0); assert.equal(f.storage.getItem(f.key), f.raw);
});

test("storage changed after discovery, missing receipt, denied or malformed replies never settle", async () => {
  for (const mode of ["changed", "missing", "denied", "malformed"] as const) {
    const f = await fixture("leave"); let calls = 0;
    if (mode === "changed") f.storage.setItem(f.key, f.raw + " ");
    const run = recoverKnownDelegation(f.entry, { authenticatedUserId: f.auth, storage: f.storage, signal: new AbortController().signal, isCurrentAuth,
      apiFetch: async path => { calls++;
        if (mode === "denied") return Response.json({ ok: false, error: "attendance_access_denied" }, { status: 403 });
        if (mode === "malformed") return Response.json({ ok: true, detail: { reason: "must not expose" } });
        const r = await applicationReceipt(parseApplicationDelegationHttpQuery("https://example.test" + path), applicationCommand()); return Response.json({ ...r, receipt: null }); } });
    // Whitespace does not change the validated intent; it is still safe to query
    // the exact same operation, but a missing receipt must retain those bytes.
    assert.equal(await run, null); assert.equal(calls, 1); assert.equal(f.storage.getItem(f.key), f.raw + (mode === "changed" ? " " : ""));
  }
});

test("abort and replacement while GET is outstanding cannot clear another intent", async () => {
  for (const mode of ["abort", "replacement"] as const) {
    const f = await fixture("missing"), controller = new AbortController(); let release!: (r: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; }); let started!: () => void; const start = new Promise<void>(resolve => { started = resolve; });
    const operation = recoverKnownDelegation(f.entry, { authenticatedUserId: f.auth, storage: f.storage, signal: controller.signal, isCurrentAuth,
      apiFetch: async path => { const receipt = await missingReceipt(parseMissingDelegationHttpQuery("https://example.test" + path), missingCommand());
        started(); void pending.then(() => {}); setTimeout(() => release(Response.json(receipt)), 10); return pending; } });
    await start; if (mode === "abort") controller.abort(); else f.storage.setItem(f.key, f.raw + " ");
    if (mode === "abort") await assert.rejects(operation); else assert.equal(await operation, null);
    assert.equal(f.storage.getItem(f.key), f.raw + (mode === "replacement" ? " " : ""));
  }
});

test("malformed local records remain untouched and bounded scan rejects excessive keys", async () => {
  const f = await fixture(); f.storage.setItem(f.key, "{bad");
  const found = await listKnownDelegationRecoveries(f.storage, f.auth, isCurrentAuth); assert.equal(found.entries.length, 0); assert(found.invalid);
  assert.equal(f.storage.getItem(f.key), "{bad");
  for (let n = 0; n < 65; n++) f.storage.setItem("faolla:attendance:missing-delegation:v1:" + n, "{}");
  await assert.rejects(listKnownDelegationRecoveries(f.storage, f.auth, isCurrentAuth));
});

test("live Auth invalidation during a local scan returns no identifiers without relying on abort or React cleanup", async () => {
  for (const moment of ["before", "during_hash", "storage_reentry"] as const) {
    const f = await fixture(); let current = moment !== "before", reads = 0;
    const storage = { ...f.storage, getItem: (key: string) => { reads++; if (moment === "storage_reentry") current = false; return f.storage.getItem(key); } };
    const controller = new AbortController();
    const result = listKnownDelegationRecoveries(storage, f.auth, () => current, controller.signal);
    if (moment === "during_hash") current = false;
    await assert.rejects(result, /recovery_scope_changed/);
    assert.equal(controller.signal.aborted, false); assert.equal(f.storage.getItem(f.key), f.raw);
    if (moment === "before") assert.equal(reads, 0);
  }
});

test("live Auth epoch invalidation before headers or body wins over a valid old receipt without cleanup", async () => {
  for (const kind of ["missing", "leave"] as const) for (const phase of ["headers", "body"] as const) {
    const f = await fixture(kind); let current = true, release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), start = new Promise<void>(resolve => { started = resolve; });
    const controller = new AbortController(); let calls = 0, removals = 0;
    const storage = { ...f.storage, removeItem: (key: string) => { removals++; f.storage.removeItem(key); } };
    const result = recoverKnownDelegation(f.entry, { authenticatedUserId: f.auth, storage, signal: controller.signal, isCurrentAuth: () => current,
      apiFetch: async path => { calls++;
        const raw = kind === "missing" ? await missingReceipt(parseMissingDelegationHttpQuery("https://example.test" + path), missingCommand())
          : await applicationReceipt(parseApplicationDelegationHttpQuery("https://example.test" + path), applicationCommand());
        if (phase === "headers") { started(); await held; return Response.json(raw); }
        return new Response(new ReadableStream<Uint8Array>({ async start(body) { started(); await held; body.enqueue(new TextEncoder().encode(JSON.stringify(raw))); body.close(); } }),
          { headers: { "content-type": "application/json" } });
      } });
    await start; current = false; release(); // Auth changed synchronously, but no component has cleaned up.
    await assert.rejects(result, /recovery_scope_changed/);
    assert.equal(calls, 1); assert.equal(removals, 0); assert.equal(controller.signal.aborted, false); assert.equal(f.storage.getItem(f.key), f.raw);
  }
});

test("Auth invalidation inside the final CAS read prevents storage removal", async () => {
  const f = await fixture("missing"); let current = true, removals = 0, armed = false, receiptReads = 0;
  const storage = { ...f.storage,
    getItem: (key: string) => { if (armed && ++receiptReads === 3) current = false; return f.storage.getItem(key); },
    removeItem: (key: string) => { removals++; f.storage.removeItem(key); } };
  const result = recoverKnownDelegation(f.entry, { authenticatedUserId: f.auth, storage, signal: new AbortController().signal, isCurrentAuth: () => current,
    apiFetch: async path => { const raw = await missingReceipt(parseMissingDelegationHttpQuery("https://example.test" + path), missingCommand()); armed = true; return Response.json(raw); } });
  await assert.rejects(result, /recovery_scope_changed/); assert.equal(receiptReads, 3); assert.equal(removals, 0); assert.equal(f.storage.getItem(f.key), f.raw);
});

test("authentication deadlines bound both session and user validation; late completion cannot win", async () => {
  assert.equal(DELEGATION_RECOVERY_AUTH_TIMEOUT_MS, 12000);
  assert.equal(await boundedDelegationRecoveryAuth(async () => "verified"), "verified");
  for (const step of ["getSession", "getUser"] as const) {
    let release!: (value: string) => void, accepted = false;
    const held = new Promise<string>(resolve => { release = resolve; });
    const result = boundedDelegationRecoveryAuth(() => held, 5).then(value => { accepted = true; return value; });
    await assert.rejects(result, /recovery_auth_timeout/); release(step); await Promise.resolve(); assert.equal(accepted, false);
  }
  let called = false;
  for (const timeout of [0, -1, 12001, NaN]) await assert.rejects(boundedDelegationRecoveryAuth(async () => { called = true; }, timeout), /recovery_auth_timeout/);
  assert.equal(called, false);
});

test("entry bypasses only the attendance navigation, never authentication or existing API guards", () => {
  const page = readFileSync("src/app/enterprise/attendance-recovery/page.tsx", "utf8");
  const wrapper = readFileSync("src/components/enterprise/MerchantAttendanceDelegationRecoveryPage.tsx", "utf8");
  const panel = readFileSync("src/components/enterprise/MerchantAttendanceDelegationRecoveryPanel.tsx", "utf8");
  const selector = readFileSync("src/app/enterprise/EnterpriseSelectorClient.tsx", "utf8");
  assert(!page.includes("notFound")); assert(wrapper.includes("supabase.auth.getUser")); assert(wrapper.includes("isEnterpriseLogoutBlocked"));
  assert(wrapper.includes('credentials: "omit"')); assert(wrapper.includes('headers.set("x-merchant-access-token"'));
  assert(selector.includes('href="/enterprise/attendance-recovery"')); assert.doesNotMatch(wrapper, /attendance\.self\.view|memberships|\.load\(/);
  assert(wrapper.includes("isCurrentAuth={isCurrentAuth}")); assert(wrapper.includes("generation.current === auth.generation"));
  assert(wrapper.includes("boundedDelegationRecoveryAuth(() => supabase.auth.getSession())"));
  assert(wrapper.includes("boundedDelegationRecoveryAuth(() => supabase.auth.getUser(session.access_token), timeoutMs)"));
  assert(wrapper.includes("DELEGATION_RECOVERY_AUTH_TIMEOUT_MS - (performance.now() - startedAt)"));
  assert(panel.includes("listKnownAttendanceRecoveries(storage(), authUserId, isCurrentAuth, controller.signal)"));
  assert(panel.includes("signal: controller.signal, isCurrentAuth")); assert(panel.includes("isCurrentAuth() && receipt"));
});
