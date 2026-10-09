//Deterministic browser transport/storage doubles only, not SQL/Auth proof.
import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceDelegatedPlanExceptionsClient } from "./merchantAttendanceDelegatedPlanExceptionsClient";
import { AttendanceManagementClient, type ManagementStorage } from "./merchantAttendanceManagementDelegatedClient";
import { delegatedPlanExceptionsModel as model } from "../../scripts/fixtures/attendance-delegated-plan-exceptions-model";
import { retireManagementPlanExceptionsClients } from "./merchantAttendanceDelegatedPlanExceptionsUi";
const json = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { "content-type": "application/json" } });
function setup() {
  const f = model(), map = new Map<string, string>(), storage: ManagementStorage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } }, calls: { url: string; init?: RequestInit }[] = [];
  let current = true, writable = true, respond: (url: string, init?: RequestInit) => Promise<Response> = async () => json(f.receipt);
  const options = { siteId: f.query.siteId, actorId: f.actor, storage: () => storage, isCurrentAuth: () => current, canWrite: () => writable,
    apiFetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return respond(url, init); } };
  const client = new AttendanceDelegatedPlanExceptionsClient(options); return { f, storage, map, calls, options, client, current: (v: boolean) => { current = v; }, writable: (v: boolean) => { writable = v; }, respond: (v: typeof respond) => { respond = v; } };
}
test("209 initialize inert, explicit exact grant/worker/slot GET, bounded body and no list", async () => {
  const st = setup(); await st.client.initialize(); assert.equal(st.calls.length, 0); st.respond(async () => json(st.f.context)); await st.client.readContext(st.f.query);
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].init?.method, "GET"); const url = new URL(st.calls[0].url, "https://local.invalid"); assert.equal(url.searchParams.get("workerId"), st.f.query.workerId); assert.equal(url.searchParams.get("slotId"), st.f.query.slotId); assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
});
test("209 StrictMode cleanup pauses immediately; setup replay reuses live clients, true unmount retires both without clearing original", async () => {
  const st = setup(), management = new AttendanceManagementClient(st.options); let mounted = true;
  st.respond(async () => json(st.f.context)); await st.client.readContext(st.f.query); assert(st.client.getSnapshot().result);
  mounted = false; retireManagementPlanExceptionsClients([st.client, management], () => mounted);
  assert.equal(st.client.getSnapshot().result, null); assert.equal(management.getSnapshot().result, null);
  mounted = true; await Promise.resolve(); await st.client.initialize(); await management.initialize();
  assert.equal(st.calls.length, 1, "setup replay and local initialization are inert"); await st.client.readContext(st.f.query); assert.equal(st.calls.length, 2);
  st.respond(async () => json(st.f.receipt)); await st.client.submit(st.f.query, st.f.command); const original = st.storage.getItem(st.client.storageKey); assert(original);
  mounted = false; retireManagementPlanExceptionsClients([st.client, management], () => mounted); assert.equal(st.client.getSnapshot().result, null);
  await Promise.resolve(); await assert.rejects(st.client.initialize()); await assert.rejects(management.initialize());
  assert.equal(st.storage.getItem(st.client.storageKey), original); assert.equal(st.calls.length, 3);
});
test("209 StrictMode replay still aborts the old lease, rejects its late response and never revives old evidence", async () => {
  const st = setup(); let mounted = true, release!: () => void, entered!: () => void;
  const hold = new Promise<void>(yes => { release = yes; }), dispatched = new Promise<void>(yes => { entered = yes; });
  st.respond(async () => { entered(); await hold; return json(st.f.context); }); const prior = st.client.readContext(st.f.query), rejected = assert.rejects(prior);
  await dispatched; mounted = false; retireManagementPlanExceptionsClients([st.client], () => mounted); mounted = true; await Promise.resolve();
  release(); await rejected; assert.equal(st.client.getSnapshot().result, null); st.respond(async () => json(st.f.context));
  await st.client.readContext(st.f.query); assert(st.client.getSnapshot().result); assert.equal(st.calls.length, 2); st.client.dispose();
});
test("209 full intent/H persisted before one POST; all old domains share same occupied slot; flag-off only GET clears", async () => {
  const st = setup(); st.respond(async (_url, init) => { const raw = st.storage.getItem(st.client.storageKey); assert(raw); const pending = JSON.parse(raw); assert.equal(pending.domain, "plan-exceptions"); assert.deepEqual(pending.query, st.f.query); assert.deepEqual(pending.command, st.f.command);
    if (st.f.receipt.kind !== "receipt") assert.fail(); assert.equal(pending.commandFingerprint, st.f.receipt.receipt!.commandFingerprint); if (init?.method === "POST") assert.deepEqual(JSON.parse(String(init.body)), { query: st.f.query, command: st.f.command }); return json(st.f.receipt); });
  await Promise.allSettled([st.client.submit(st.f.query, st.f.command), st.client.submit(st.f.query, st.f.command)]); assert.equal(st.calls.length, 1);
  const old = new AttendanceManagementClient(st.options); assert.equal(old.storageKey, st.client.storageKey); await assert.rejects(old.initialize());
  await assert.rejects(old.submitManagement({ action: "revoke", operationId: "00000000-0000-4000-8000-000000999999", grantId: st.f.query.grantId, expectedRevision: 1, reason: "Synthetic" })); assert.equal(st.calls.length, 1);
  st.writable(false); await st.client.recover(); assert.equal(st.calls.length, 2); assert.equal(st.calls[1].init?.method, "GET"); assert.equal(st.calls[1].init?.body, undefined); assert.equal(st.storage.getItem(st.client.storageKey), null); old.dispose(); st.client.dispose();
});
test("209 null/wrong H/target/revision/identity and storage CAS replacement never clear original slot", async () => {
  for (const mode of ["null", "sha", "slot", "worker", "revision", "employee", "cas"] as const) {
    const st = setup(); await st.client.submit(st.f.query, st.f.command); const raw = st.storage.getItem(st.client.storageKey); assert(raw);
    st.respond(async (_url, init) => { assert.equal(init?.method, "GET"); const result = structuredClone(st.f.receipt); if (result.kind !== "receipt" || !result.receipt) assert.fail();
      if (mode === "null") return json({ ...result, receipt: null }); if (mode === "cas") st.storage.setItem(st.client.storageKey, "foreign replacement");
      const reference = { ...result.receipt.reference, ...(mode === "slot" ? { slotId: st.f.actor } : mode === "worker" ? { workerId: st.f.actor }
        : mode === "revision" ? { decisionRevision: result.receipt.reference.decisionRevision + 1 } : mode === "employee" ? { employeeId: st.f.actor } : {}) };
      return json({ ...result, receipt: { ...result.receipt, reference, ...(mode === "sha" ? { commandFingerprint: "c".repeat(64) } : {}) } }); });
    if (mode === "null") await st.client.recover(); else await assert.rejects(st.client.recover()); assert.equal(st.storage.getItem(st.client.storageKey), mode === "cas" ? "foreign replacement" : raw); st.client.dispose();
  }
});
test("209 auth loss/pause/timeout/late body keep pending, discard current evidence, no automatic retry", async () => {
  for (const mode of ["auth", "pause", "timeout"] as const) { const st = setup(); let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(done => { release = done; }), dispatch = new Promise<void>(done => { entered = done; });
    st.respond(async () => { entered(); await wait; return json(st.f.receipt); }); const client = mode === "timeout" ? new AttendanceDelegatedPlanExceptionsClient({ ...st.options, timeoutMs: 40 }) : st.client;
    const pending = client.submit(st.f.query, st.f.command), rejected = assert.rejects(pending); await dispatch; const saved = st.storage.getItem(client.storageKey); assert(saved);
    if (mode === "auth") st.current(false); if (mode === "pause") client.pause(); if (mode === "timeout") await rejected; release(); await rejected;
    assert.equal(st.calls.length, 1); assert.equal(st.storage.getItem(client.storageKey), saved); assert.equal(client.getSnapshot().result, null); client.dispose(); st.client.dispose();
  }
});
test("209 malformed redirect/HTML/overflow/fatal UTF8 and observer throws preserve intent without retry", async () => {
  for (const mode of ["html", "redirect", "overflow", "utf8"] as const) { const st = setup(); st.respond(async () => {
    if (mode === "html") return new Response("<html>login</html>", { headers: { "content-type": "text/html" } });
    if (mode === "redirect") return new Response("", { status: 302, headers: { "content-type": "application/json" } });
    if (mode === "overflow") return new Response(" ".repeat(524289), { headers: { "content-type": "application/json" } });
    return new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }); });
    const client = new AttendanceDelegatedPlanExceptionsClient({ ...st.options, onState: () => { throw Error("observer"); } }); await assert.rejects(client.submit(st.f.query, st.f.command));
    assert(st.storage.getItem(client.storageKey)); assert.equal(st.calls.length, 1); client.dispose(); st.client.dispose();
  }
});
