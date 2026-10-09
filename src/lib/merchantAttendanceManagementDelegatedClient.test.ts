// Deterministic browser transport/storage doubles; not actual SQL or Auth.
import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceManagementClient, attendanceManagementPendingKey, type ManagementStorage } from "./merchantAttendanceManagementDelegatedClient";
import * as m from "./merchantAttendanceManagementDelegation";
import * as a from "./merchantAttendanceDelegatedAudit";
import * as g from "./merchantAttendanceDelegatedGroups";
import * as cfg from "./merchantAttendanceDelegatedConfiguration";
import * as rules from "./merchantAttendanceDelegatedRules";
import * as credentials from "./merchantAttendanceDelegatedCredentials";
import * as revisions from "./merchantAttendanceDelegatedRevisions";
import { revisionApprovalResponse } from "../../scripts/fixtures/attendance-revision-approval-model";
import { emptyAttendanceRuleDraft } from "./merchantAttendanceRuleDraft";
import type { GroupsCommand } from "./merchantAttendanceGroups";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const siteId = "99990203", actorId = id(1), at = "2026-10-08T13:00:00.000001Z", readAt = "2026-10-08T14:00:00.000000Z";
const command: m.ManagementDelegationCommand = { action: "revoke", operationId: id(3), grantId: id(2), expectedRevision: 1, reason: "Synthetic explicit action" };
const credentialSecret = "A".repeat(43), credentialPin = "12345678", credentialQuery = { siteId, grantId: id(207), mode: "context" as const, operationId: null };
function credentialTerminal(action: credentials.DelegatedTerminalAction = "terminal_prepare"): credentials.DelegatedTerminalCommand {
  const common = { operationId: id(208), terminalId: id(209), locationId: id(210), reason: "Synthetic explicit terminal" };
  return action === "terminal_prepare" ? { ...common, action, label: "Synthetic front desk", pairHash: "a".repeat(64) } : { ...common, action };
}
function credentialPinCommand(kind: "member_pin" | "independent_pin" = "member_pin", action: credentials.DelegatedPinAction = "pin_issue"): credentials.DelegatedPinCommand {
  const common = { action, operationId: id(211), workerId: id(212), reason: "Synthetic explicit PIN" };
  return kind === "member_pin" ? { ...common, kind, employeeId: id(213), employeeAuthUserId: id(214), workerNo: "Synthetic207", expectedRevision: 3 }
    : { ...common, kind, subjectId: id(215), expectedSubjectRevision: 4, expectedGeneration: 2, expectedWorkerVersion: 7, expectedSettingsVersion: 9, expectedCredentialRevision: 6 };
}
async function setupCredentials(command: credentials.DelegatedCredentialsCommand = credentialTerminal()) {
  const terminal = command.action === "terminal_prepare" || command.action === "terminal_revoke", reference = terminal
    ? { kind: "terminal", terminalId: command.terminalId, locationId: command.locationId, auditAction: command.action === "terminal_prepare" ? "create" : "revoke" }
    : command.kind === "member_pin" ? { kind: command.kind, workerId: command.workerId, employeeId: command.employeeId, employeeAuthUserId: command.employeeAuthUserId, revision: command.expectedRevision + 1 }
      : { kind: command.kind, workerId: command.workerId, subjectId: command.subjectId, subjectRevision: command.expectedSubjectRevision + 1,
        generation: command.expectedGeneration + (command.action === "pin_revoke" ? 1 : 0), workerVersion: command.expectedWorkerVersion + 1, credentialRevision: command.expectedCredentialRevision + 1 };
  const commandFingerprint = terminal ? await credentials.delegatedTerminalCommandFingerprint(credentialQuery, actorId, command)
    : await credentials.delegatedPinCommandFingerprint(credentialQuery, actorId, command),
    saved = { protocol: terminal ? credentials.DELEGATED_TERMINALS_PROTOCOL : credentials.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "receipt", receipt: {
      operationId: command.operationId, actorId, grantId: credentialQuery.grantId, action: command.action, reference, commandFingerprint, businessFingerprint: "b".repeat(64), recordedAt: at } };
  const db = store(), calls: { url: string; init?: RequestInit }[] = []; let writable = true, current = true,
    respond: (url: string, init?: RequestInit) => Promise<Response> = async () => json(saved);
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => current, canWrite: () => writable,
    apiFetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); } });
  const submit = () => command.action === "terminal_prepare" ? client.submitTerminalPrepare(credentials.parseDelegatedTerminalPrepareEphemeralBody({ query: credentialQuery, command, pairSecret: credentialSecret }))
    : command.action === "terminal_revoke" ? client.submitTerminalRevoke({ query: credentialQuery, command })
      : command.action === "pin_issue" ? client.submitPinIssue(credentials.parseDelegatedPinIssueEphemeralBody({ query: credentialQuery, command, pin: credentialPin }))
        : client.submitPinRevoke({ query: credentialQuery, command });
  return { ...db, client, calls, saved, command, submit, writable: (v: boolean) => { writable = v; }, current: (v: boolean) => { current = v; }, respond: (v: typeof respond) => { respond = v; } };
}
function store() {
  const map = new Map<string, string>(), storage: ManagementStorage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } };
  return { map, storage };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } });
async function setupRevisions(action: "approve" | "reject" = "approve") {
  const review = revisionApprovalResponse(), query = revisions.parseDelegatedRevisionsQuery({ siteId: review.siteId, grantId: id(880), mode: "context", requestId: review.requestId });
  if (query.mode !== "context") throw Error("fixture context");
  const command = revisions.parseDelegatedRevisionsCommand({ action, operationId: id(881), requestId: query.requestId, expectedRevision: review.review.submittedRevision,
    expectedEvidence: review.evidenceToken, expectedBaseOperationId: review.review.base.operationId, reason: "Synthetic reviewed revision" }), app = review.review.review.application;
  const context = { protocol: revisions.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId, readAt: review.asOf, kind: "context", grantId: query.grantId,
    action: action === "approve" ? "revision_approve" : "revision_reject", scope: { kind: "revision", workerId: app.workerId, employeeId: app.employeeId,
      employeeAuthUserId: id(882), locationIds: [app.basis.events[0].locationId], includePending: true }, context: { review, canApprove: action === "approve", canReject: action === "reject" } };
  const saved = { protocol: revisions.DELEGATED_REVISIONS_PROTOCOL, siteId: query.siteId, actorId, readAt, kind: "receipt", receipt: { operationId: command.operationId, actorId,
    grantId: query.grantId, action: context.action, commandFingerprint: await revisions.delegatedRevisionsCommandFingerprint(query, actorId, command), businessFingerprint: "b".repeat(64), recordedAt: at,
    reference: { kind: "revision", requestId: query.requestId, rootRequestId: review.review.base.lineage.rootRequestId, workerId: app.workerId, employeeId: app.employeeId,
      employeeAuthUserId: id(882), requestRevision: command.expectedRevision, baseOperationId: command.expectedBaseOperationId, effectRevision: action === "approve" ? review.review.base.revision + 1 : null } } };
  const db = store(), calls: { url: string; init?: RequestInit }[] = []; let writable = true, current = true, respond: (url: string, init?: RequestInit) => Promise<Response> = async () => json(saved);
  const client = new AttendanceManagementClient({ siteId: query.siteId, actorId, storage: () => db.storage, canWrite: () => writable, isCurrentAuth: () => current,
    apiFetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); } });
  return { ...db, client, calls, query, command, context, saved, submit: () => client.submitRevisions(query, command),
    writable: (v: boolean) => { writable = v; }, current: (v: boolean) => { current = v; }, respond: (v: typeof respond) => { respond = v; } };
}
test("208 local initialization is inert and only an explicit exact grant/request context GET reads a revision", async () => {
  const st = await setupRevisions(); await st.client.initialize(); assert.equal(st.calls.length, 0); st.respond(async () => json(st.context));
  const result = await st.client.readRevisions(st.query); assert.equal(result.protocol, revisions.DELEGATED_REVISIONS_PROTOCOL); assert.equal(result.kind, "context");
  const url = new URL(st.calls[0].url, "https://local.invalid"); assert.equal(url.searchParams.get("requestId"), st.query.requestId); assert.equal(st.calls[0].init?.method, "GET");
  assert.throws(() => st.client.readRevisions({ siteId: st.query.siteId, grantId: st.query.grantId, mode: "recover", operationId: st.command.operationId }));
  assert.equal(st.calls.length, 1); assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
});
test("208 both explicit decisions persist full command and SHA before one POST, block every occupied domain, and flagoff GET alone clears", async () => {
  for (const action of ["approve", "reject"] as const) {
    const st = await setupRevisions(action); st.respond(async (_url, init) => { const raw = st.storage.getItem(st.client.storageKey); assert(raw); const p = JSON.parse(raw);
      assert.equal(p.domain, "revisions"); assert.deepEqual(p.query, st.query); assert.deepEqual(p.command, st.command); assert.equal(p.commandFingerprint, st.saved.receipt.commandFingerprint);
      if (init?.method === "POST") assert.deepEqual(JSON.parse(String(init.body)), { query: st.query, command: st.command }); return json(st.saved); });
    await Promise.allSettled([st.submit(), st.submit()]); assert.equal(st.calls.length, 1); assert.equal(st.client.getSnapshot().pending?.domain, "revisions");
    await assert.rejects(st.client.readManagement({ siteId: st.query.siteId, mode: "list", afterId: null, state: "all", delegatedAction: null }));
    await assert.rejects(st.client.submitManagement(command)); assert.equal(st.calls.length, 1); st.writable(false);
    await st.client.recover(); assert.equal(st.calls.length, 2); assert.equal(st.calls[1].init?.method, "GET"); assert.equal(st.calls[1].init?.body, undefined);
    assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
  }
});
test("208 null receipt, wrong full SHA, request/base/revision/action and storage replacement never clear the original slot", async () => {
  for (const mode of ["null", "sha", "request", "base", "revision", "action", "cas"] as const) {
    const st = await setupRevisions(); await st.submit(); const raw = st.storage.getItem(st.client.storageKey); assert(raw);
    st.respond(async (_url, init) => { assert.equal(init?.method, "GET"); const value = structuredClone(st.saved);
      if (mode === "null") return json({ ...value, receipt: null });
      if (mode === "sha") value.receipt.commandFingerprint = "c".repeat(64); else if (mode === "request") value.receipt.reference.requestId = id(999);
      else if (mode === "base") value.receipt.reference.baseOperationId = id(999); else if (mode === "revision") value.receipt.reference.requestRevision++;
      else if (mode === "action") { value.receipt.action = "revision_reject"; value.receipt.reference.effectRevision = null; } else st.storage.setItem(st.client.storageKey, "replacement");
      return json(value); });
    if (mode === "null") await st.client.recover(); else await assert.rejects(st.client.recover());
    assert.equal(st.storage.getItem(st.client.storageKey), mode === "cas" ? "replacement" : raw); assert.equal(st.calls.filter(c => c.init?.method === "POST").length, 1); st.client.dispose();
  }
});
test("208 flag/Auth fences prevent new writes and late responses cannot restore a body or clear durable original intent", async () => {
  const st = await setupRevisions(); st.writable(false); await assert.rejects(st.submit()); assert.equal(st.calls.length, 0);
  st.writable(true); st.current(false); await assert.rejects(st.submit()); assert.equal(st.calls.length, 0); st.current(true);
  let enter!: () => void, release!: (r: Response) => void; const entered = new Promise<void>(resolve => { enter = resolve; });
  st.respond(async () => { enter(); return new Promise<Response>(resolve => { release = resolve; }); }); const pending = st.submit(); await entered;
  const raw = st.storage.getItem(st.client.storageKey); assert(raw); st.current(false); st.client.pause(); await assert.rejects(pending);
  release(json(st.saved)); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(st.client.getSnapshot().result, null); assert.equal(st.storage.getItem(st.client.storageKey), raw); st.client.dispose();
});
async function setup() {
  const saved: m.ManagementDelegationResult = { protocol: m.MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId, readAt, kind: "receipt", receipt: {
    operationId: command.operationId, actorId, action: "revoke", grantId: id(2), revision: 2,
    commandFingerprint: await m.managementDelegationCommandFingerprint(siteId, actorId, command), recordedAt: at,
  } };
  const db = store(), calls: { url: string; init?: RequestInit }[] = []; let current = true, writable = true;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => current, canWrite: () => writable,
    apiFetch: async (url, init) => { calls.push({ url, init }); return json(saved); } });
  return { client, calls, saved, ...db, current: (value: boolean) => { current = value; }, writable: (value: boolean) => { writable = value; } };
}
test("207 initialization remains zero HTTP and explicit credential contexts cannot select recover or unscoped inventory", async () => {
  const st = await setupCredentials(); await st.client.initialize(); assert.equal(st.calls.length, 0);
  const context = { protocol: credentials.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId: credentialQuery.grantId, action: "terminal_prepare",
    scope: { kind: "terminal", terminalId: id(209), locationId: id(210), create: true },
    context: { terminal: null, location: { locationId: id(210), name: "Synthetic location", timeZone: "UTC", version: 2, active: true } } };
  st.respond(async () => json(context)); const result = await st.client.readTerminals(credentialQuery); assert.equal(result.kind, "context"); assert.equal(st.calls[0].init?.method, "GET");
  assert.throws(() => st.client.readTerminals({ ...credentialQuery, mode: "recover", operationId: id(208) })); assert.equal(st.calls.length, 1); assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
});
test("207 prepare persists exact NONSECRET command first, sends one ephemeral secret POST, then secretfree fullSHA GET", async () => {
  const st = await setupCredentials(); st.respond(async (_url, init) => { const raw = st.storage.getItem(st.client.storageKey); assert(raw);
    assert(!raw.includes(credentialSecret)); assert(!raw.includes('"pairSecret"')); if (init?.method === "POST") assert.equal(JSON.parse(String(init.body)).pairSecret, credentialSecret); return json(st.saved); });
  await st.submit(); const raw = st.storage.getItem(st.client.storageKey); assert(raw); const pending = JSON.parse(raw);
  assert.equal(pending.domain, "terminals"); assert.deepEqual(pending.command, st.command); assert(!JSON.stringify(st.client.getSnapshot()).includes(credentialSecret));
  st.writable(false); await st.client.recover(); assert.equal(st.calls.length, 2); assert.equal(st.calls[1].init?.method, "GET"); assert.equal(st.calls[1].init?.body, undefined);
  assert(!st.calls[1].url.includes(credentialSecret)); assert.equal(new URL(st.calls[1].url, "https://local.invalid").searchParams.get("grantId"), credentialQuery.grantId); assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
});
test("207 member and independent issue keep PIN out of pending/snapshot and recover every real identity/CAS reference", async () => {
  for (const kind of ["member_pin", "independent_pin"] as const) {
    const st = await setupCredentials(credentialPinCommand(kind)); await st.submit(); const raw = st.storage.getItem(st.client.storageKey); assert(raw);
    assert(!raw.includes(credentialPin)); assert(!raw.includes('"pin":')); assert(!JSON.stringify(st.client.getSnapshot()).includes(credentialPin));
    const body = credentials.parseDelegatedPinIssueEphemeralBody(JSON.parse(String(st.calls[0].init?.body))); assert.equal(body.pin, credentialPin); assert.equal(body.command.kind, kind);
    st.writable(false); await st.client.recover(); assert.equal(st.calls.length, 2); assert.equal(st.calls[1].init?.method, "GET"); assert.equal(st.calls[1].init?.body, undefined); assert.equal(st.storage.getItem(st.client.storageKey), null); st.client.dispose();
  }
});
test("207 all fresh credential writes including revoke require current Auth and corresponding write gate", async () => {
  for (const c of [credentialTerminal(), credentialTerminal("terminal_revoke"), credentialPinCommand(), credentialPinCommand("member_pin", "pin_revoke")]) {
    const st = await setupCredentials(c); st.writable(false); await assert.rejects(st.submit()); assert.equal(st.calls.length, 0); assert.equal(st.storage.getItem(st.client.storageKey), null);
    st.writable(true); st.current(false); await assert.rejects(st.submit()); assert.equal(st.calls.length, 0); st.current(true); await st.submit(); assert.equal(st.calls.length, 1); st.client.dispose();
  }
});
test("207 null, wrong SHA/reference and storage CAS preserve original credential intent with no retry or secret recovery", async () => {
  for (const mode of ["null", "sha", "reference", "cas"] as const) {
    const st = await setupCredentials(credentialPinCommand()); await st.submit(); const raw = st.storage.getItem(st.client.storageKey); assert(raw);
    st.respond(async (_url, init) => { assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); const value = JSON.parse(JSON.stringify(st.saved));
      if (mode === "null") value.receipt = null; else if (mode === "sha") value.receipt.commandFingerprint = "c".repeat(64);
      else if (mode === "reference") value.receipt.reference.employeeAuthUserId = id(99); else st.storage.setItem(st.client.storageKey, "foreign replacement"); return json(value); });
    if (mode === "null") await st.client.recover(); else await assert.rejects(st.client.recover());
    assert.equal(st.calls.filter(call => call.init?.method === "POST").length, 1); assert.equal(st.storage.getItem(st.client.storageKey), mode === "cas" ? "foreign replacement" : raw); st.client.dispose();
  }
});
test("207 pause/Auth loss fence a late secret POST response without restoring any secret or clearing original", async () => {
  const st = await setupCredentials(); let enter!: () => void, release!: (r: Response) => void; const entered = new Promise<void>(r => { enter = r; });
  st.respond(async () => { enter(); return new Promise<Response>(r => { release = r; }); }); const pending = st.submit(); await entered;
  const raw = st.storage.getItem(st.client.storageKey); assert(raw); st.current(false); st.client.pause(); await assert.rejects(pending); release(json(st.saved)); await new Promise<void>(r => setImmediate(r));
  assert.equal(st.client.getSnapshot().result, null); assert.equal(st.client.getSnapshot().pending, null); assert.equal(st.storage.getItem(st.client.storageKey), raw); assert.equal(st.calls.length, 1); st.client.dispose();
});
test("207 uses the same actor slot as202–206 and rejects any secret-bearing durable original before HTTP", async () => {
  const st = await setupCredentials(); await st.submit(); const raw = st.storage.getItem(st.client.storageKey); assert(raw);
  await assert.rejects(st.client.submitManagement(command)); await assert.rejects(st.client.readRules({ siteId, grantId: id(33), mode: "context", operationId: null })); assert.equal(st.calls.length, 1);
  st.client.pause(); const bad = JSON.stringify({ ...JSON.parse(raw), pairSecret: credentialSecret }); st.storage.setItem(st.client.storageKey, bad);
  await assert.rejects(st.client.initialize()); assert.equal(st.storage.getItem(st.client.storageKey), bad); assert.equal(st.calls.length, 1);
  const badCommand = JSON.stringify({ ...JSON.parse(raw), command: { ...JSON.parse(raw).command, pin: credentialPin } }); st.storage.setItem(st.client.storageKey, badCommand);
  await assert.rejects(st.client.initialize()); assert.equal(st.storage.getItem(st.client.storageKey), badCommand); st.client.dispose();
});
test("207 stalled secret dispatch times out once, cancels response and preserves only nonsecret original", async () => {
  const db = store(); let calls = 0, cancels = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, timeoutMs: 15, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async () => { calls++; return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancels++; } }), { headers: { "content-type": "application/json" } }); } });
  await assert.rejects(client.submitPinIssue(credentials.parseDelegatedPinIssueEphemeralBody({ query: credentialQuery, command: credentialPinCommand(), pin: credentialPin })));
  assert.equal(calls, 1); assert.equal(cancels, 1); const raw = db.storage.getItem(client.storageKey); assert(raw); assert(!raw.includes(credentialPin)); assert(!JSON.stringify(client.getSnapshot()).includes(credentialPin)); client.dispose();
});
test("202/203 constructor and initialization are local, actor/domain bound and use one durable slot", async () => {
  const st = await setup(); assert.equal(st.calls.length, 0); assert.equal(await st.client.initialize(), null); assert.equal(st.calls.length, 0);
  assert.equal(st.client.hasLeaveRisk(), false); assert.notEqual(attendanceManagementPendingKey(siteId, actorId), attendanceManagementPendingKey(siteId, id(99)));
  assert.throws(() => attendanceManagementPendingKey("invalid", actorId)); st.client.dispose();
});
test("202 full original is saved before a single POST, retained on success, then only exact GET retires it", async () => {
  const st = await setup(); await st.client.initialize(); await st.client.submitManagement(command);
  assert.equal(st.calls.length, 1); assert.equal(st.calls[0].init?.method, "POST"); assert.equal(st.calls[0].init?.redirect, "error");
  const original = st.storage.getItem(st.client.storageKey); assert(original); const pending = JSON.parse(original);
  assert.deepEqual(pending.command, command); assert.equal(pending.actorId, actorId); assert.equal(pending.domain, "management");
  assert.equal(pending.commandFingerprint, await m.managementDelegationCommandFingerprint(siteId, actorId, command));
  assert.equal(st.client.getSnapshot().phase, "unconfirmed"); assert.equal(st.client.hasLeaveRisk(), true);
  st.writable(false); await st.client.recover(); assert.equal(st.calls.length, 2); assert.equal(st.calls[1].init?.method, "GET"); assert.equal(st.calls[1].init?.body, undefined);
  assert.equal(new URL(st.calls[1].url, "https://www.faolla.com").searchParams.get("operationId"), command.operationId);
  assert.equal(st.storage.getItem(st.client.storageKey), null); assert.equal(st.client.hasLeaveRisk(), false); st.client.dispose();
});
test("202/203 malformed, foreign, unknown and occupied slots are retained and block both fresh domains", async () => {
  for (const raw of ["", "{broken", "{}", '{"protocol":"unknown"}']) {
    const st = await setup(); st.storage.setItem(st.client.storageKey, raw); await assert.rejects(st.client.initialize());
    await assert.rejects(st.client.submitManagement(command)); assert.equal(st.calls.length, 0); assert.equal(st.storage.getItem(st.client.storageKey), raw); assert(st.client.hasLeaveRisk()); st.client.dispose();
  }
  const st = await setup(); await st.client.submitManagement(command); const original = st.storage.getItem(st.client.storageKey)!;
  await assert.rejects(st.client.submitAudit({ siteId, grantId: id(4), mode: "export", source: "config", fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z" }, { action: "export", operationId: id(5) }));
  assert.equal(st.calls.length, 1); assert.equal(st.storage.getItem(st.client.storageKey), original);
  for (const patch of [{ actorId: id(99) }, { commandFingerprint: "a".repeat(64) }, { domain: "audit" }]) {
    st.storage.setItem(st.client.storageKey, JSON.stringify({ ...JSON.parse(original), ...patch })); await assert.rejects(st.client.recover()); assert.equal(st.calls.length, 1);
  }
  st.client.dispose();
});
test("202 untrusted input is detached before await and late response/pause never restores hidden bodies", async () => {
  const st = await setup(), db = store(); let enter!: () => void, release!: (r: Response) => void;
  const entered = new Promise<void>(r => { enter = r; }), calls: string[] = [];
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async (_url, init) => { calls.push(init?.body as string); enter(); return new Promise<Response>(r => { release = r; }); } });
  const mutable = { ...command }, pending = client.submitManagement(mutable); mutable.reason = "Changed after start"; mutable.grantId = id(99);
  await entered; assert.deepEqual(JSON.parse(calls[0]).command, command); const raw = db.storage.getItem(client.storageKey); assert(raw);
  client.pause(); await assert.rejects(pending); release(json(st.saved)); await new Promise<void>(r => setImmediate(r));
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().pending, null); assert.equal(db.storage.getItem(client.storageKey), raw); client.dispose(); st.client.dispose();
});
test("202 recovery null/wrong SHA/late storage replacement never clears or reposts original", async () => {
  for (const mode of ["null", "wrong", "cas"] as const) {
    const st = await setup(), db = store(); let calls = 0;
    const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
      apiFetch: async (_url, init) => { calls++; if (init?.method === "POST") return json(st.saved);
        if (mode === "cas") db.storage.setItem(client.storageKey, "foreign replacement");
        return json(mode === "null" ? { ...st.saved, receipt: null } : mode === "wrong" ? { ...st.saved, receipt: { ...st.saved.receipt!, commandFingerprint: "a".repeat(64) } } : st.saved); } });
    await client.submitManagement(command); const raw = db.storage.getItem(client.storageKey);
    if (mode === "null") { await client.recover(); assert.equal(client.getSnapshot().phase, "unconfirmed"); } else await assert.rejects(client.recover());
    assert.equal(calls, 2); assert.equal(db.storage.getItem(client.storageKey), mode === "cas" ? "foreign replacement" : raw); assert(client.hasLeaveRisk()); client.dispose(); st.client.dispose();
  }
});
test("202/203 Auth/write gates deny before dispatch; emergency revoke remains SQL-authorized when new grants are off", async () => {
  const st = await setup(); st.current(false); await assert.rejects(st.client.submitManagement(command)); assert.equal(st.calls.length, 0);
  st.current(true); st.writable(false);
  const grant: m.ManagementDelegationCommand = { action: "grant", operationId: id(10), delegateEmployeeId: id(11), delegateAuthUserId: id(12), delegatedAction: "audit_view", scope: { kind: "audit_company", sources: ["config"] }, validFrom: at, validUntil: readAt, reason: "Synthetic new grant" };
  await assert.rejects(st.client.submitManagement(grant)); assert.equal(st.calls.length, 0); assert.equal(st.storage.getItem(st.client.storageKey), null);
  await st.client.submitManagement(command); assert.equal(st.calls.length, 1); st.client.dispose();
});
test("202/203 timeout covers stalled response and loses no original; no automatic retry is scheduled", async () => {
  const db = store(); let calls = 0, cancels = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, timeoutMs: 15, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async () => { calls++; return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); }, cancel() { cancels++; } }), { headers: { "content-type": "application/json" } }); } });
  await assert.rejects(client.submitManagement(command)); assert.equal(calls, 1); assert.equal(cancels, 1); assert(db.storage.getItem(client.storageKey)); assert(client.hasLeaveRisk()); client.dispose();
});
test("203 export uses its own exact command SHA; original GET recovery cannot redownload body", async () => {
  const db = store(), query: a.DelegatedAuditExportQuery = { siteId, grantId: id(20), mode: "export", source: "config", fromAt: "2026-10-07T00:00:00.000000Z", toAt: "2026-10-08T00:00:00.000000Z" };
  const command: a.DelegatedAuditCommand = { action: "export", operationId: id(21) }, receipt: a.DelegatedAuditReceipt = { operationId: command.operationId, actorId, grantId: query.grantId, action: "export",
    commandFingerprint: await a.delegatedAuditCommandFingerprint(query, actorId, command), asOf: at, count: 0, resultFingerprint: "a".repeat(64), recordedAt: at };
  const calls: string[] = [], base = { protocol: a.DELEGATED_AUDIT_PROTOCOL, siteId, actorId, readAt };
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async (url, init) => { calls.push(url); return json(init?.method === "POST" ? { ...base, kind: "export", grantId: query.grantId, source: "config", scopeKind: "audit_company", target: null,
      payload: { schemaVersion: 1, fromAt: query.fromAt, toAt: query.toAt, asOf: at, count: 0, rows: [] }, receipt } : { ...base, kind: "receipt", receipt }); } });
  const exported = await client.submitAudit(query, command); assert.equal(exported.kind, "export"); assert(db.storage.getItem(client.storageKey));
  const recovered = await client.recover(); assert.equal(recovered.kind, "receipt"); assert(!("payload" in recovered)); assert.equal(calls.length, 2);
  assert(calls[1].includes("mode=recover")); assert.equal(db.storage.getItem(client.storageKey), null); client.dispose();
});

async function groupSetup() {
  const query: Extract<g.DelegatedGroupsQuery, { mode: "context" }> = { siteId, grantId: id(40), mode: "context", operationId: null };
  const command: GroupsCommand = { action: "save_group", operationId: id(41), groupId: id(41), expectedRevision: 0,
    name: "Kitchen", description: "", active: true, reason: "Explicit scoped creation" };
  const base = { protocol: g.DELEGATED_GROUPS_PROTOCOL, siteId, actorId, readAt };
  const saved: g.DelegatedGroupsResult = { ...base, kind: "receipt", receipt: { operationId: command.operationId, actorId, grantId: query.grantId,
    action: "group_save", referenceId: command.groupId, revision: 1, commandFingerprint: await g.delegatedGroupsCommandFingerprint(query, actorId, command),
    businessFingerprint: "a".repeat(64), recordedAt: at } };
  const context: g.DelegatedGroupsResult = { ...base, kind: "context", grantId: query.grantId, action: "group_save",
    scope: { kind: "group", groupId: command.groupId, create: true }, context: { protocol: "groups-v1", siteId, actorId, settingsVersion: 1,
      timeZone: "Europe/Madrid", view: "context", group: null, worker: null, items: [], nextCursor: null, detail: null, receipt: null } };
  return { query, command, saved, context };
}

test("204 scoped reads and a single durable POST share the actor slot; only full original GET retires it", async () => {
  const fixture = await groupSetup(), db = store(), calls: { url: string; method: string }[] = []; let writable = true;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => writable,
    apiFetch: async (url, init) => { calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") { const pending = JSON.parse(db.storage.getItem(client.storageKey)!); assert.equal(pending.domain, "groups"); assert.deepEqual(pending.command, fixture.command); }
      return json(new URL(url, "https://www.faolla.com").searchParams.get("mode") === "context" ? fixture.context : fixture.saved); } });
  await client.initialize(); assert.equal(calls.length, 0);
  assert.equal((await client.readGroups(fixture.query)).kind, "context");
  assert.equal((await client.submitGroups(fixture.query, fixture.command)).kind, "receipt"); const original = db.storage.getItem(client.storageKey); assert(original);
  await assert.rejects(client.submitManagement(command)); await assert.rejects(client.readGroups(fixture.query)); assert.equal(calls.length, 2);
  writable = false; await client.recover(); assert.equal(calls.length, 3); assert.equal(calls[2].method, "GET");
  const query = new URL(calls[2].url, "https://www.faolla.com").searchParams; assert.equal(query.get("grantId"), fixture.query.grantId);
  assert.equal(query.get("operationId"), fixture.command.operationId); assert.equal(db.storage.getItem(client.storageKey), null); client.dispose();
});

test("204 null, wrong grant/reference/revision/full SHA and storage replacement preserve original without repost", async () => {
  const fixture = await groupSetup(); assert.equal(fixture.saved.kind, "receipt"); if (fixture.saved.kind !== "receipt" || !fixture.saved.receipt) assert.fail();
  for (const mode of ["null", "grant", "reference", "revision", "sha", "cas"] as const) {
    const db = store(); let calls = 0;
    const bad: g.DelegatedGroupsResult = mode === "null" ? { ...fixture.saved, receipt: null } : { ...fixture.saved, receipt: { ...fixture.saved.receipt,
      ...(mode === "grant" ? { grantId: id(99) } : mode === "reference" ? { referenceId: id(99) }
        : mode === "revision" ? { revision: 2 } : mode === "sha" ? { commandFingerprint: "f".repeat(64) } : {}) } };
    const client: AttendanceManagementClient = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
      apiFetch: async (_url, init): Promise<Response> => { calls++; if (init?.method === "POST") return json(fixture.saved);
        if (mode === "cas") db.storage.setItem(client.storageKey, "other original"); return json(bad); } });
    await client.submitGroups(fixture.query, fixture.command); const original = db.storage.getItem(client.storageKey);
    if (mode === "null") await client.recover(); else await assert.rejects(client.recover());
    assert.equal(calls, 2); assert.equal(db.storage.getItem(client.storageKey), mode === "cas" ? "other original" : original); client.dispose();
  }
});

test("204 shared pending is locally decoded after pause/replay and preserves malformed/foreign identities", async () => {
  const fixture = await groupSetup(), db = store(); let calls = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async () => { calls++; return json(fixture.saved); } });
  await client.submitGroups(fixture.query, fixture.command); const original = db.storage.getItem(client.storageKey)!; client.pause();
  const pending = await client.initialize(); assert.equal(pending?.domain, "groups"); assert.equal(calls, 1); assert.equal(client.getSnapshot().result, null);
  for (const patch of [{ actorId: id(99) }, { query: { ...fixture.query, grantId: id(99) } }, { commandFingerprint: "f".repeat(64) }]) {
    const raw = JSON.stringify({ ...JSON.parse(original), ...patch }); db.storage.setItem(client.storageKey, raw);
    await assert.rejects(client.initialize()); await assert.rejects(client.recover()); assert.equal(calls, 1); assert.equal(db.storage.getItem(client.storageKey), raw);
  }
  client.dispose();
});

test("204 separate write gate refuses fresh groups but does not block original recovery", async () => {
  const fixture = await groupSetup(), db = store(); let calls = 0, writable = false;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => writable,
    apiFetch: async () => { calls++; return json(fixture.saved); } });
  await assert.rejects(client.submitGroups(fixture.query, fixture.command)); assert.equal(calls, 0); assert.equal(db.storage.getItem(client.storageKey), null);
  writable = true; await client.submitGroups(fixture.query, fixture.command); writable = false; await client.recover(); assert.equal(calls, 2); client.dispose();
});

async function configurationSetup() {
  const query: Extract<cfg.DelegatedConfigurationQuery, { mode: "context" }> = { siteId, grantId: id(60), mode: "context", operationId: null };
  const command: cfg.DelegatedConfigurationCommand = { kind: "location", operationId: id(61), expectedVersion: 3,
    values: { id: id(62), name: "Kitchen", timeZone: "Europe/Madrid", active: true } };
  const base = { protocol: cfg.DELEGATED_CONFIGURATION_PROTOCOL, siteId, actorId, readAt };
  const saved: cfg.DelegatedConfigurationResult = { ...base, kind: "receipt", receipt: { operationId: command.operationId, actorId, grantId: query.grantId,
    action: "location_save", referenceId: command.values.id, revision: command.expectedVersion + 1,
    commandFingerprint: await cfg.delegatedConfigurationCommandFingerprint(query, actorId, command), businessFingerprint: "a".repeat(64), recordedAt: at } };
  const context: cfg.DelegatedConfigurationResult = { ...base, kind: "context", grantId: query.grantId, action: "location_save",
    scope: { kind: "location", locationId: command.values.id, create: false }, context: { settingsVersion: 3, targetVersion: 2, worker: null, employee: null, locations: [command.values] } };
  return { query, command, saved, context };
}

test("205 explicit scoped GET and one durable POST share the original actor slot with all older domains", async () => {
  const f = await configurationSetup(), db = store(), calls: { url: string; method: string }[] = []; let writable = true;
  const client: AttendanceManagementClient = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => writable,
    apiFetch: async (url, init): Promise<Response> => { calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") { const raw = JSON.parse(db.storage.getItem(client.storageKey)!); assert.equal(raw.domain, "configuration"); assert.deepEqual(raw.command, f.command); }
      return json(new URL(url, "https://www.faolla.com").searchParams.get("mode") === "context" ? f.context : f.saved); } });
  await client.initialize(); assert.equal(calls.length, 0); assert.equal((await client.readConfiguration(f.query)).kind, "context");
  await client.submitConfiguration(f.query, f.command); const raw = db.storage.getItem(client.storageKey); assert(raw);
  await assert.rejects(client.submitManagement(command)); await assert.rejects(client.readGroups((await groupSetup()).query));
  assert.equal(calls.length, 2); writable = false; await client.recover(); assert.equal(calls.length, 3);
  assert.equal(calls[2].method, "GET"); const q = new URL(calls[2].url, "https://www.faolla.com").searchParams;
  assert.equal(q.get("grantId"), f.query.grantId); assert.equal(q.get("operationId"), f.command.operationId);
  assert.equal(db.storage.getItem(client.storageKey), null); client.dispose();
});

test("205 unknown, wrong full intent or reference/version, and slot CAS changes never erase the original or repost", async () => {
  const f = await configurationSetup(); if (f.saved.kind !== "receipt" || !f.saved.receipt) assert.fail();
  for (const mode of ["null", "grant", "reference", "version", "sha", "cas"] as const) {
    const db = store(); let calls = 0;
    const bad: cfg.DelegatedConfigurationResult = { ...f.saved, receipt: mode === "null" ? null : { ...f.saved.receipt,
      ...(mode === "grant" ? { grantId: id(99) } : mode === "reference" ? { referenceId: id(99) } : mode === "version" ? { revision: 5 }
        : mode === "sha" ? { commandFingerprint: "f".repeat(64) } : {}) } };
    const client: AttendanceManagementClient = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
      apiFetch: async (_url, init): Promise<Response> => { calls++; if (init?.method === "POST") return json(f.saved);
        if (mode === "cas") db.storage.setItem(client.storageKey, "another original"); return json(bad); } });
    await client.submitConfiguration(f.query, f.command); const raw = db.storage.getItem(client.storageKey);
    if (mode === "null") await client.recover(); else await assert.rejects(client.recover());
    assert.equal(calls, 2); assert.equal(db.storage.getItem(client.storageKey), mode === "cas" ? "another original" : raw); client.dispose();
  }
});

test("205 local pause/replay detaches intent and rejects foreign identity or original mutation without HTTP", async () => {
  const f = await configurationSetup(), db = store(); let calls = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async () => { calls++; return json(f.saved); } });
  await client.submitConfiguration(f.query, f.command); const raw = db.storage.getItem(client.storageKey)!; client.pause();
  assert.equal((await client.initialize())?.domain, "configuration"); assert.equal(calls, 1); assert.equal(client.getSnapshot().result, null);
  for (const patch of [{ actorId: id(99) }, { query: { ...f.query, grantId: id(99) } }, { command: { ...f.command, expectedVersion: 4 } }]) {
    const changed = JSON.stringify({ ...JSON.parse(raw), ...patch }); db.storage.setItem(client.storageKey, changed);
    await assert.rejects(client.initialize()); await assert.rejects(client.recover()); assert.equal(calls, 1); assert.equal(db.storage.getItem(client.storageKey), changed);
  }
  client.dispose();
});

test("205 fresh configuration is gated while old original recovery remains independent", async () => {
  const f = await configurationSetup(), db = store(); let calls = 0, writable = false;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => writable,
    apiFetch: async () => { calls++; return json(f.saved); } });
  await assert.rejects(client.submitConfiguration(f.query, f.command)); assert.equal(calls, 0); assert.equal(db.storage.getItem(client.storageKey), null);
  writable = true; await client.submitConfiguration(f.query, f.command); writable = false; await client.recover();
  assert.equal(calls, 2); assert.equal(db.storage.getItem(client.storageKey), null); client.dispose();
});

async function rulesSetup() {
  const query: Extract<rules.DelegatedRulesQuery, { mode: "context" }> = { siteId, grantId: id(80), mode: "context", operationId: null };
  const command: rules.DelegatedRulesCommand = { family: "base", decision: { action: "save_draft", operationId: id(81), expectedRevision: 0,
    reason: "Explicit synthetic draft", expectedSettingsVersion: 3, expectedGroupRevision: null, timeZone: "UTC", rules: emptyAttendanceRuleDraft() } };
  const base = { protocol: rules.DELEGATED_RULES_PROTOCOL, siteId, actorId, readAt };
  const saved: rules.DelegatedRulesResult = { ...base, kind: "receipt", receipt: { operationId: command.decision.operationId, actorId, grantId: query.grantId,
    family: command.family, action: "rule_draft", referenceId: command.decision.operationId, revision: 1,
    commandFingerprint: await rules.delegatedRulesCommandFingerprint(query, actorId, command), businessFingerprint: "a".repeat(64), recordedAt: at } };
  const context: rules.DelegatedRulesResult = { ...base, kind: "context", grantId: query.grantId, action: "rule_draft",
    scope: { kind: "rules", family: "base", subject: { kind: "enterprise" }, allowedRuleKeys: ["lateGraceMinutes"], locationIds: [] },
    context: { family: "base", revision: 0, settingsVersion: 3, timeZone: "UTC", group: null, draft: null,
      baselineRules: emptyAttendanceRuleDraft(), baselineRevision: null, baselineKind: "default" } };
  return { query, command, saved, context };
}

test("206 explicit context and nested original operation share the durable actor slot; recovery remains GET-only when gated", async () => {
  const f = await rulesSetup(), db = store(), calls: { url: string; method: string }[] = []; let writable = true;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => writable,
    apiFetch: async (url, init) => { calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "POST") { const raw = JSON.parse(db.storage.getItem(client.storageKey)!); assert.equal(raw.domain, "rules"); assert.deepEqual(raw.command, f.command); }
      return json(new URL(url, "https://www.faolla.com").searchParams.get("mode") === "context" ? f.context : f.saved); } });
  await client.initialize(); assert.equal(calls.length, 0); await client.readRules(f.query); await client.submitRules(f.query, f.command);
  const raw = db.storage.getItem(client.storageKey); assert(raw); assert.equal(calls.length, 2);
  await assert.rejects(client.submitManagement(command)); await assert.rejects(client.readConfiguration((await configurationSetup()).query));
  writable = false; await client.recover(); assert.equal(calls.length, 3); assert.equal(calls[2].method, "GET");
  const q = new URL(calls[2].url, "https://www.faolla.com").searchParams;
  assert.equal(q.get("grantId"), f.query.grantId); assert.equal(q.get("operationId"), f.command.decision.operationId);
  assert.equal(db.storage.getItem(client.storageKey), null); client.dispose();
});

test("206 null, wrong nested intent/reference/revision/full SHA or storage CAS cannot erase or repost the original", async () => {
  const f = await rulesSetup(); if (f.saved.kind !== "receipt" || !f.saved.receipt) assert.fail();
  for (const mode of ["null", "grant", "reference", "revision", "family", "sha", "cas"] as const) {
    const db = store(); let calls = 0;
    const bad: unknown = { ...f.saved, receipt: mode === "null" ? null : { ...f.saved.receipt,
      ...(mode === "grant" ? { grantId: id(99) } : mode === "reference" ? { referenceId: id(99) } : mode === "revision" ? { revision: 2 }
        : mode === "family" ? { family: "personal", action: "personal_rule_approve" } : mode === "sha" ? { commandFingerprint: "f".repeat(64) } : {}) } };
    const client: AttendanceManagementClient = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
      apiFetch: async (_url, init): Promise<Response> => { calls++; if (init?.method === "POST") return json(f.saved);
        if (mode === "cas") db.storage.setItem(client.storageKey, "other original"); return json(bad); } });
    await client.submitRules(f.query, f.command); const raw = db.storage.getItem(client.storageKey);
    if (mode === "null") await client.recover(); else await assert.rejects(client.recover());
    assert.equal(calls, 2); assert.equal(db.storage.getItem(client.storageKey), mode === "cas" ? "other original" : raw); client.dispose();
  }
});

test("206 saved larger envelopes never widen the older16KiB domains; malformed nested identities remain local", async () => {
  const f = await rulesSetup(), db = store(); let calls = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => true,
    apiFetch: async () => { calls++; return json(f.saved); } });
  await client.submitRules(f.query, f.command); const raw = db.storage.getItem(client.storageKey)!; client.pause();
  db.storage.setItem(client.storageKey, raw + " ".repeat(20000)); assert.equal((await client.initialize())?.domain, "rules"); assert.equal(calls, 1);
  for (const changed of [raw + " ".repeat(rules.DELEGATED_RULES_REQUEST_BYTES + 1024),
    JSON.stringify({ ...JSON.parse(raw), command: { ...f.command, decision: { ...f.command.decision, operationId: id(99) } } }),
    JSON.stringify({ ...JSON.parse(raw), actorId: id(99) })]) {
    db.storage.setItem(client.storageKey, changed); await assert.rejects(client.initialize()); await assert.rejects(client.recover());
    assert.equal(db.storage.getItem(client.storageKey), changed); assert.equal(calls, 1);
  }
  const old = await setup(); await old.client.submitManagement(command); const olderRaw = old.storage.getItem(old.client.storageKey)! + " ".repeat(20000);
  old.storage.setItem(old.client.storageKey, olderRaw); await assert.rejects(old.client.initialize()); await assert.rejects(old.client.recover());
  assert.equal(old.calls.length, 1); assert.equal(old.storage.getItem(old.client.storageKey), olderRaw); old.client.dispose(); client.dispose();
});

test("206 nested command is detached before await; late response and Auth loss do not restore hidden bodies or repeat", async () => {
  const f = await rulesSetup(), db = store(); let entered!: () => void, release!: (value: Response) => void, current = true;
  const ready = new Promise<void>(resolve => { entered = resolve; }), bodies: string[] = [];
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => current, canWrite: () => true,
    apiFetch: async (_url, init) => { bodies.push(String(init?.body)); entered(); return new Promise<Response>(resolve => { release = resolve; }); } });
  const mutable = structuredClone(f.command), work = client.submitRules(f.query, mutable); Reflect.set(mutable.decision, "reason", "Changed after submit");
  await ready; assert.deepEqual(JSON.parse(bodies[0]).command, f.command); const raw = db.storage.getItem(client.storageKey);
  current = false; client.pause(); await assert.rejects(work); release(json(f.saved)); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().pending, null); assert.equal(db.storage.getItem(client.storageKey), raw);
  await assert.rejects(client.recover()); assert.equal(bodies.length, 1); client.dispose();
});

test("206 fresh rules are explicitly gated and read recovery is not a caller-selected fresh query", async () => {
  const f = await rulesSetup(), db = store(); let calls = 0;
  const client = new AttendanceManagementClient({ siteId, actorId, storage: () => db.storage, isCurrentAuth: () => true, canWrite: () => false,
    apiFetch: async () => { calls++; return json(f.saved); } });
  await assert.rejects(client.submitRules(f.query, f.command)); assert.equal(calls, 0); assert.equal(db.storage.getItem(client.storageKey), null);
  assert.throws(() => client.readRules({ siteId, grantId: f.query.grantId, mode: "recover", operationId: f.command.decision.operationId })); client.dispose();
});

