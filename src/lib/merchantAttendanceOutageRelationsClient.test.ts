import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AttendanceOutageClient, outageClientCommandMatchesRead, outageClientPendingKey, type OutageClientStorage } from "./merchantAttendanceOutageClient";
import { OUTAGE_APIS, outageHttpQueryString, parseOutageHttpBody, parseOutageHttpQuery, parseOutageHttpResponse } from "./merchantAttendanceOutageHttp";
import { outageRelationsCommandFingerprintText } from "./merchantAttendanceOutageRelations";
import type { OutageRelationsCommand, OutageRelationsQuery, OutageRelationsResult } from "./merchantAttendanceOutageRelationsContract";
import type { AttendanceApiFetch } from "./merchantAttendanceSelfClient";
import { OUTAGE_RELATIONS_MODEL as m, outageRelationsModelId as id, outageRelationsModelQuery as query,
  outageRelationsModelCommand as command, outageRelationsModelEntry as entry, outageRelationsModelResult as result,
  outageRelationsModelSaved as saved } from "../../scripts/fixtures/attendance-outage-relations-model";

const digest = (q: OutageRelationsQuery, c: OutageRelationsCommand) => createHash("sha256").update(outageRelationsCommandFingerprintText(q, c), "utf8").digest("hex");
const envelope = (data: OutageRelationsResult, canWrite = true) => ({ ok: true, canWrite, data });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const draft = (c: OutageRelationsCommand = command()) => { const { operationId: _id, ...body } = c; void _id; return body; };
const recovered = () => saved({ ...query(), mode: "recover", operationId: m.operation }, command(), digest(query(), command()));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
class Memory implements OutageClientStorage {
  values = new Map<string, string>(); writes = 0; removes = 0;
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => { this.writes++; this.values.set(key, value); };
  removeItem = (key: string) => { this.removes++; this.values.delete(key); };
}
function setup(respond: AttendanceApiFetch, storage = new Memory(), enabled = true, actorId = m.owner, access: "owner" | "self" = "owner") {
  const calls: { path: string; method?: string }[] = [];
  const client = new AttendanceOutageClient({ kind: "relations", siteId: m.siteId, actorId, access, enabled, storage: () => storage,
    operationId: () => m.operation, apiFetch: async (path, init) => { calls.push({ path, method: init?.method }); return respond(path, init); } });
  return { client, storage, calls };
}
async function ready(respond: AttendanceApiFetch) {
  const h = setup(async (path, init) => init?.method === "GET" && !path.includes("mode=recover") ? json(envelope(result())) : respond(path, init));
  await h.client.initialize(); assert.equal(h.calls.length, 0); await h.client.load(query());
  assert.equal(h.client.getSnapshot().phase, "ready"); return h;
}
function putPending(storage: Memory, c = command(), q: OutageRelationsQuery = query()) {
  const key = outageClientPendingKey("relations", m.siteId, "owner", m.owner);
  storage.setItem(key, JSON.stringify({ version: 1, kind: "relations", actorId: m.owner, query: q, command: c })); return key;
}

test("relations HTTP roundtrips exact list/pair/history/recover without broadening old kinds", () => {
  const qs: OutageRelationsQuery[] = [query(), query("self"), { siteId: m.siteId, access: "self", declarationId: m.declaration, mode: "list" },
    { ...query(), mode: "history", beforeRevision: null }, { ...query(), mode: "history", beforeRevision: 101 },
    { ...query(), mode: "recover", operationId: m.operation }];
  for (const q of qs) assert.deepEqual(parseOutageHttpQuery("relations", "https://local.invalid" + OUTAGE_APIS.relations + "?" + outageHttpQueryString("relations", q)), q);
  const url = "https://local.invalid" + OUTAGE_APIS.relations + "?" + outageHttpQueryString("relations", query());
  for (const bad of [url + "&relatedDeclarationId=" + m.related, url + "&sources=[]", url + "&beforeRevision=1", url + "#fragment", url + "&bad=%FF"])
    assert.throws(() => parseOutageHttpQuery("relations", bad), { code: "attendance_invalid_request" });
  for (const kind of ["links", "reviews"] as const) assert.throws(() => parseOutageHttpQuery(kind, url), { code: "attendance_invalid_request" });
});
test("relations HTTP requires exact owner detail body, duplicate-aware JSON and actual actor", () => {
  assert.deepEqual(parseOutageHttpBody("relations", { query: query(), command: command() }, m.owner), { query: query(), command: command() });
  for (const body of [{ query: query("self"), command: command() }, { query: query(), command: command(), allow: true },
    { query: { ...query(), mode: "recover", operationId: m.operation }, command: command() },
    JSON.stringify({ query: query(), command: command() }).replace('"kind":"possible_duplicate"', '"kind":"possible_duplicate","kind":"complementary"')])
    assert.throws(() => parseOutageHttpBody("relations", body, m.owner), { code: "attendance_invalid_request" });
  assert.throws(() => parseOutageHttpResponse("relations", envelope(result(), false), query(), m.owner), { code: "attendance_outage_relations_invalid" });
  assert.equal(parseOutageHttpResponse("relations", envelope({ ...result(), canWrite: false }), query(), m.owner).canWrite, true);
});
test("relations current-read CAS pins both directed IDs and preview; safe revoke uses saved fingerprint", () => {
  assert.equal(outageClientCommandMatchesRead("relations", result(), query(), query(), command()), true);
  for (const q of [{ ...query(), relatedDeclarationId: id(99) }, { ...query(), declarationId: m.related, relatedDeclarationId: m.declaration }])
    assert.equal(outageClientCommandMatchesRead("relations", result(), query(), q, command()), false);
  for (const c of [command({ expectedRevision: 1 }), command({ expectedFingerprint: "b".repeat(64) })])
    assert.equal(outageClientCommandMatchesRead("relations", result(), query(), query(), c), false);
  const r = result(query(), entry()); r.preview = { evidence: null, fingerprint: null, eligible: false, blockers: ["identity_changed", "settings_disabled"] };
  const revoke: OutageRelationsCommand = { action: "revoke", operationId: id(31), expectedRevision: 1, expectedFingerprint: m.fingerprint, reason: "仅撤销关联" };
  assert.equal(outageClientCommandMatchesRead("relations", r, query(), query(), revoke), true);
  assert.equal(outageClientCommandMatchesRead("relations", r, query(), query(), command({ expectedRevision: 1 })), false);
});
test("relations applies exactly once, persists before POST and verifies the complete original digest", async () => {
  const h = await ready(async (_path, init) => {
    assert.equal(init?.method, "POST"); assert.equal(h.storage.writes, 1);
    assert.deepEqual(JSON.parse(String(init?.body)), { query: query(), command: command() });
    return json(envelope(saved(query(), command(), digest(query(), command()))));
  });
  await h.client.submit(query(), draft());
  assert.equal(h.calls.filter(c => c.method === "POST").length, 1); assert.equal(h.storage.removes, 1);
  assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.client.getSnapshot().result?.receipt?.entry.kind, "possible_duplicate");
});
test("relations lost POST reloads flag-off and recovers only the original directed pair by GET", async () => {
  const first = await ready(async () => { throw Error("lost response"); }); await first.client.submit(query(), draft());
  const raw = first.storage.getItem(first.client.storageKey); assert.ok(raw);
  const h = setup(async (path, init) => {
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    const q = parseOutageHttpQuery("relations", "https://local.invalid" + path);
    assert.deepEqual(q, { ...query(), mode: "recover", operationId: m.operation });
    return json(envelope(recovered(), false));
  }, first.storage, false);
  await h.client.initialize(); assert.equal(h.calls.length, 0); await h.client.recover();
  assert.equal(h.calls.length, 1); assert.equal(h.client.getSnapshot().pending, null); assert.equal(h.storage.removes, 1);
});
test("relations reverse-direction digest, changed kind or other actor never clears pending", async () => {
  for (const mode of ["direction", "kind", "actor", "fingerprint"] as const) {
    const storage = new Memory(), key = putPending(storage), original = storage.getItem(key), value = recovered();
    if (mode === "direction") value.receipt!.commandFingerprint = digest({ ...query(), declarationId: m.related, relatedDeclarationId: m.declaration }, command());
    if (mode === "kind") value.receipt!.entry.kind = "complementary";
    if (mode === "actor") value.receipt!.entry.actorId = id(88);
    if (mode === "fingerprint") value.receipt!.entry.fingerprint = "b".repeat(64);
    const h = setup(async () => json(envelope(value)), storage); await h.client.initialize(); await h.client.recover();
    assert.equal(storage.getItem(key), original, mode); assert.equal(storage.removes, 0); assert.equal(h.client.getSnapshot().result, null);
  }
});
test("relations self cannot recover/write and another Auth cannot discover the owner's pending key", async () => {
  const storage = new Memory(), key = putPending(storage), h = setup(async () => json(envelope(result(query("self")))), storage, true, m.auth, "self");
  await h.client.initialize(); await h.client.recover(); assert.equal(h.calls.length, 0); assert.equal(h.client.getSnapshot().pending, null);
  await h.client.load(query("self")); await h.client.submit(query("self"), draft());
  assert.equal(h.calls.length, 1); assert.ok(storage.getItem(key)); assert.equal(storage.removes, 0);
});
test("relations explicit exact POST rejection may be ended; malformed/GET/unknown rejects never retire it", async () => {
  const h = await ready(async () => json({ ok: false, error: "attendance_outage_relations_changed" }, 409));
  await h.client.submit(query(), draft()); assert.equal(h.client.getSnapshot().canEndRejectedAttempt, true); assert.equal(h.storage.removes, 0);
  await h.client.endRejectedAttempt(); assert.equal(h.storage.removes, 1);
  for (const [code, status] of [["attendance_outage_relations_changed", 503], ["attendance_outage_relations_disabled", 403], ["attendance_outage_relations_not_found", 404]] as const) {
    const bad = await ready(async () => json({ ok: false, error: code }, status)); await bad.client.submit(query(), draft());
    assert.equal(bad.client.getSnapshot().canEndRejectedAttempt, false); await bad.client.endRejectedAttempt(); assert.equal(bad.storage.removes, 0);
  }
  const storage = new Memory(); putPending(storage);
  const get = setup(async () => json({ ok: false, error: "attendance_outage_relations_changed" }, 409), storage);
  await get.client.initialize(); await get.client.recover(); assert.equal(get.client.getSnapshot().canEndRejectedAttempt, false); assert.equal(storage.removes, 0);
});
test("relations replacement storage CAS wins while a successful recovery response is delayed", async () => {
  const storage = new Memory(), key = putPending(storage), gate = deferred<Response>(), h = setup(async () => gate.promise, storage);
  await h.client.initialize(); const reading = h.client.recover(); await Promise.resolve(); await Promise.resolve();
  const replacement = storage.getItem(key)!.replace(m.operation, id(88)); storage.values.set(key, replacement);
  gate.resolve(json(envelope(recovered()))); await reading;
  assert.equal(storage.getItem(key), replacement); assert.equal(storage.removes, 0); assert.equal(h.client.getSnapshot().result, null);
});
test("relations pause before late GET/crypto completion leaves original bytes and no old display", async t => {
  const storage = new Memory(), key = putPending(storage), real = crypto.subtle.digest.bind(crypto.subtle), gate = deferred<ArrayBuffer>(), entered = deferred<void>();
  t.mock.method(crypto.subtle, "digest", async () => { entered.resolve(); return gate.promise; });
  const h = setup(async () => json(envelope(recovered())), storage); await h.client.initialize(); const reading = h.client.recover();
  await entered.promise; h.client.pause(); gate.resolve(await real("SHA-256", new TextEncoder().encode(outageRelationsCommandFingerprintText(query(), command())))); await reading;
  assert.ok(storage.getItem(key)); assert.equal(storage.removes, 0); assert.equal(h.client.getSnapshot().result, null);
});
test("relations disabled new instance permits explicit detail reads but never creates a write", async () => {
  const h = setup(async () => json(envelope({ ...result(), canWrite: false }, false)), new Memory(), false);
  await h.client.initialize(); await h.client.load(query()); await h.client.submit(query(), draft());
  assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0); assert.equal(h.client.getSnapshot().phase, "ready");
});
test("relations wrong-scope submit is rejected before durable intent or POST", async () => {
  const h = await ready(async () => { throw Error("must not POST"); });
  await h.client.submit({ ...query(), relatedDeclarationId: id(999) }, draft());
  assert.equal(h.calls.length, 1); assert.equal(h.storage.writes, 0); assert.equal(h.client.getSnapshot().phase, "blocked");
});
