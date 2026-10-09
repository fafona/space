import assert from "node:assert/strict";
import test from "node:test";
import { parseMissingBody, parseMissingQuery, parseMissingResult, missingQueryString, missingProposal, type MissingQuery, type MissingResult, type MissingCommand } from "./merchantAttendanceMissing";
import { executeAttendanceMissing } from "./merchantAttendanceMissing.server";
import { AttendanceMissingClient } from "./merchantAttendanceMissingClient";
import { correctionDraftProposal, correctionTimeOffsets } from "./merchantAttendanceCorrectionForm";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q: MissingQuery = { siteId: "99990001", access: "self", fromDate: "2026-09-01", throughDate: "2026-10-01", requestId: null, operationId: null, beforeAt: null, beforeId: null };
const cmd: MissingCommand = { operationId: id(401), reason: "整段漏卡", action: "submit", expectedWorkerId: id(201), expectedSettingsVersion: 1, expectedPolicyRevision: 1,
  locationId: id(301), timeZone: "Europe/Madrid", proposal: { startAt: "2026-09-30T07:00:00.000000Z", endAt: "2026-09-30T15:00:00.000000Z", breaks: [] } };
const result = (): MissingResult => ({ siteId: q.siteId, access: "self", employeeId: id(101), workerId: id(201), locationId: id(301), timeZone: "Europe/Madrid", canRequest: true,
  settingsVersion: 1, policyRevision: 1, fromDate: q.fromDate, throughDate: q.throughDate, asOf: "2026-10-01T10:00:00.000000Z", items: [], nextCursor: null, detail: null, receipt: null, includedInTimesheet: false, moduleEnabled: true });
const submitted = (): MissingResult => {
  const summary = { requestId: id(401), employeeId: id(101), workerName: "员工甲", startAt: cmd.proposal.startAt, endAt: cmd.proposal.endAt, submittedAt: "2026-10-01T09:00:00.000000Z", revision: 1, status: "submitted" as const };
  return { ...result(), items: [summary], detail: { ...summary, lineage: null, reason: cmd.reason, proposal: cmd.proposal, locationName: "测试门店", timeZone: cmd.timeZone, policyRevision: 1,
    deadlineAt: "2026-10-31T00:00:00.000000Z", terminal: null, issues: [], evidenceToken: "a".repeat(32), canApprove: false, canReject: false }, receipt: { operationId: id(401), requestId: id(401), revision: 1, command: cmd } };
};
test("missing query bounds submission dates and rejects actor injection/duplicate/filter mixing", () => {
  assert.deepEqual(parseMissingQuery(`https://local.invalid/?${missingQueryString(q)}`), q);
  for (const suffix of ["&siteId=99990002", "&employeeId=" + id(102), "&allowWrite=true", "&beforeId=" + id(401)]) assert.throws(() => parseMissingQuery(`https://local.invalid/?${missingQueryString(q)}${suffix}`));
  for (const patch of [{ fromDate: "2026-08-31" }, { throughDate: "2026-08-01" }, { fromDate: "2026-02-30" }, { access: "employee" },
    { beforeAt: "2026-10-01T09:00:00.000000Z", beforeId: id(401), requestId: id(401) }]) assert.throws(() => parseMissingQuery(`https://local.invalid/?${missingQueryString({ ...q, ...patch } as MissingQuery)}`));
});
test("missing submit binds current worker, location, policy and settings; no raw-event reference required", () => {
  assert.deepEqual(parseMissingBody({ query: q, command: cmd }).command, cmd);
  for (const patch of [{ access: "owner" }, { operationId: id(401) }, { requestId: id(401) }, { beforeAt: null, employeeId: id(2) }]) assert.throws(() => parseMissingBody({ query: { ...q, ...patch }, command: cmd }));
  for (const patch of [{ actor: id(1) }, { startEventId: id(33) }, { reason: "" }, { reason: "x\ny" }, { reason: " x" }, { expectedPolicyRevision: 0 },
    { expectedWorkerId: null }, { expectedSettingsVersion: 1.5 }, { timeZone: "invalid" }]) assert.throws(() => parseMissingBody({ query: q, command: { ...cmd, ...patch } }));
});
test("missing revision is an exact self command with distinct operation and exact approved parent", () => {
  const revision = { ...cmd, action: "revise", operationId: id(500), supersedesRequestId: id(401), expectedApprovalOperationId: id(410) };
  assert.equal(parseMissingBody({ query: q, command: revision }).command.action, "revise");
  for (const patch of [{ supersedesRequestId: null }, { expectedApprovalOperationId: null }, { operationId: id(401) }, { operationId: id(410) }, { rootRequestId: id(401) }, { action: "submit" }])
    assert.throws(() => parseMissingBody({ query: q, command: { ...revision, ...patch } }));
  assert.throws(() => parseMissingBody({ query: { ...q, access: "owner" }, command: revision }));
  assert.throws(() => parseMissingBody({ query: { ...q, requestId: id(401) }, command: revision }));
});
function approvedMissing(): MissingResult {
  const s = submitted(), summary = { ...s.items[0], status: "approved" as const, revision: 2 };
  return { ...s, receipt: null, items: [summary], detail: { ...s.detail!, ...summary, terminal: { reason: "已核对", recordedAt: "2026-10-01T09:30:00.000000Z" },
    issues: ["terminal"], lineage: { rootRequestId: id(401), supersedesRequestId: null, currentRequestId: id(401), currentApprovalOperationId: id(410), canRevise: true } } };
}
test("missing lineage validates approval identity and forbids fabricated revision affordances", () => {
  const r = approvedMissing(), query = { ...q, requestId: id(401) };
  assert.equal(parseMissingResult(r, query).detail!.lineage!.canRevise, true);
  for (const patch of [{ currentApprovalOperationId: null }, { currentRequestId: null, currentApprovalOperationId: null, canRevise: false }, { rootRequestId: id(999) }, { supersedesRequestId: id(401) }, { canRevise: "true" }, { currentRequestId: id(999) }, { secret: "x" }])
    assert.throws(() => parseMissingResult({ ...r, detail: { ...r.detail, lineage: { ...r.detail!.lineage, ...patch } } }, query));
  assert.throws(() => parseMissingResult({ ...r, canRequest: false }, query));
  const historical = { ...r, detail: { ...r.detail!, lineage: { ...r.detail!.lineage!, currentRequestId: id(500), currentApprovalOperationId: id(501), canRevise: false } } };
  assert.equal(parseMissingResult(historical, query).detail!.lineage!.currentRequestId, id(500));
  // Old deployed schema responses have no lineage; no revision action invented.
  const legacy = { ...r.detail }; delete (legacy as Partial<typeof legacy>).lineage;
  assert.equal(parseMissingResult({ ...r, detail: legacy }, query).detail!.lineage, null);
});
test("revision receipt must match its parent and cannot masquerade as an ordinary new declaration", () => {
  const command = parseMissingBody({ query: q, command: { ...cmd, action: "revise", operationId: id(500), supersedesRequestId: id(401), expectedApprovalOperationId: id(410) } }).command;
  const s = submitted(), summary = { ...s.items[0], requestId: id(500) };
  const r = { ...s, items: [summary], detail: { ...s.detail!, ...summary, lineage: { rootRequestId: id(401), supersedesRequestId: id(401), currentRequestId: id(401), currentApprovalOperationId: id(410), canRevise: false } },
    receipt: { operationId: id(500), requestId: id(500), revision: 1, command } };
  const query = { ...q, operationId: id(500) };
  assert.equal(parseMissingResult(r, query).receipt!.command.action, "revise");
  for (const lineage of [null, { ...r.detail.lineage, supersedesRequestId: id(402) }, { ...r.detail.lineage, currentRequestId: id(500) }, { ...r.detail.lineage, currentRequestId: null, currentApprovalOperationId: null }])
    assert.throws(() => parseMissingResult({ ...r, detail: { ...r.detail, lineage } }, query));
});
test("missing revision client binds current approval and recovers a committed lost reply by GET only", async () => {
  const store = new Map<string, string>(), calls: string[] = []; let saved: MissingCommand | null = null;
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  const apiFetch = async (_url: string, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)).command; throw Error("lost"); }
    if (!saved) return Response.json({ ok: true, ...approvedMissing() });
    const s = submitted(), summary = { ...s.items[0], requestId: saved.operationId };
    return Response.json({ ok: true, ...s, items: [summary], detail: { ...s.detail, ...summary, lineage: { rootRequestId: id(401), supersedesRequestId: id(401), currentRequestId: id(401), currentApprovalOperationId: id(410), canRevise: false } },
      receipt: { operationId: saved.operationId, requestId: saved.operationId, revision: 1, command: saved } });
  };
  const client = new AttendanceMissingClient({ query: { ...q, requestId: id(401) }, actorId: id(101), apiFetch, storage: () => storage, randomId: () => id(500) });
  await client.initialize();
  await client.submit({ action: "revise", proposal: { ...cmd.proposal, endAt: "2026-09-30T14:00:00.000000Z" }, reason: "更正结束时间" });
  assert.equal(client.getSnapshot().phase, "unconfirmed");
  const pending = client.getSnapshot().pending!.command;
  assert.equal(pending.action, "revise"); if (pending.action !== "revise") throw Error("wrong action");
  assert.equal(pending.supersedesRequestId, id(401)); assert.equal(pending.expectedApprovalOperationId, id(410));
  await client.initialize(); assert.equal(client.getSnapshot().phase, "ready"); assert.equal(client.getSnapshot().pending, null);
  assert.deepEqual(calls, ["GET", "POST", "GET"]); assert.equal(store.size, 0);
});
test("missing intervals have microsecond-accurate 24h limit and bounded ordered contained breaks", () => {
  const p = { startAt: "2026-09-29T15:00:00.000000Z", endAt: "2026-09-30T15:00:00.000000Z", breaks: [] };
  assert.deepEqual(missingProposal(p), p); assert.throws(() => missingProposal({ ...p, endAt: "2026-09-30T15:00:00.000001Z" }));
  for (const breaks of [Array(9).fill({ startAt: p.startAt, endAt: p.endAt, paid: false }), [{ startAt: p.endAt, endAt: p.startAt, paid: false }],
    [{ startAt: p.startAt, endAt: p.endAt, paid: "true" }], [{ startAt: p.startAt, endAt: "2026-09-30T16:00:00.000000Z", paid: false }]]) assert.throws(() => missingProposal({ ...p, breaks }));
});
test("missing local-time form rejects DST gap, requires fold offset and preserves cross-midnight elapsed time", () => {
  assert.deepEqual(correctionTimeOffsets("2026-03-29T02:30", "Europe/Madrid"), []);
  assert.deepEqual(correctionTimeOffsets("2026-10-25T02:30", "Europe/Madrid"), ["+01:00", "+02:00"]);
  const draft = { start: { local: "2026-10-25T02:30", offset: "" }, end: { local: "2026-10-25T06:00", offset: "+01:00" }, breaks: [] };
  assert.throws(() => correctionDraftProposal(draft, "Europe/Madrid"));
  assert.equal(correctionDraftProposal({ ...draft, start: { local: "2026-10-24T22:00", offset: "+02:00" } }, "Europe/Madrid").startAt, "2026-10-24T20:00:00.000000Z");
});
test("only self can withdraw and only owner can approve/reject; decisions require exact request revision/evidence", () => {
  const query = { ...q, requestId: id(401) }, withdraw = { operationId: id(402), action: "withdraw", requestId: id(401), expectedRevision: 1, reason: "核对后撤回" };
  assert.equal(parseMissingBody({ query, command: withdraw }).command.action, "withdraw");
  assert.throws(() => parseMissingBody({ query: { ...query, access: "owner" }, command: withdraw }));
  for (const action of ["approve", "reject"]) {
    const decision = { ...withdraw, action, evidenceToken: "b".repeat(32) };
    assert.throws(() => parseMissingBody({ query, command: decision }));
    assert.equal(parseMissingBody({ query: { ...query, access: "owner" }, command: decision }).command.action, action);
    for (const patch of [{ expectedRevision: 2 }, { evidenceToken: "" }, { requestId: id(403) }]) assert.throws(() => parseMissingBody({ query: { ...query, access: "owner" }, command: { ...decision, ...patch } }));
  }
});
test("missing result binds identity, submission filters, cursor, receipts and explicit exclusion from timesheet", () => {
  assert.deepEqual(parseMissingResult(result(), q), result());
  const receivedQ = { ...q, operationId: id(401) }; assert.deepEqual(parseMissingResult(submitted(), receivedQ), submitted());
  for (const patch of [{ siteId: "99990002" }, { includedInTimesheet: true }, { fromDate: "2026-09-02" }, { moduleEnabled: "true" }, { items: Array(26).fill(submitted().items[0]) },
    { items: [{ ...submitted().items[0], employeeId: id(102) }] }, { nextCursor: { at: submitted().asOf, id: id(401) } },
    { receipt: { ...submitted().receipt, operationId: id(999) } }, { detail: { ...submitted().detail, canApprove: true } }]) assert.throws(() => parseMissingResult({ ...submitted(), ...patch }, receivedQ));
});
test("terminal result cannot invent a pending status or disagree with original submitted proposal", () => {
  for (const detail of [{ ...submitted().detail, status: "approved" }, { ...submitted().detail, proposal: { ...cmd.proposal, endAt: "2026-09-30T16:00:00.000000Z" } },
    { ...submitted().detail, issues: ["made_up"] }, { ...submitted().detail, terminal: { reason: "approved", recordedAt: result().asOf } }]) assert.throws(() => parseMissingResult({ ...submitted(), detail }, { ...q, operationId: id(401) }));
});
test("missing executor uses server auth/entitlement, sanitizes response and hides unknown database errors", async () => {
  const input = { query: q, command: null, authUserId: id(1), allowWrite: false };
  const r = await executeAttendanceMissing(input, { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_missing_v1"); assert.equal(args.p_auth_user_id, id(1)); assert.equal(args.p_allow_write, false); return { data: { ...result(), secret: "x" }, error: null }; } });
  assert.equal(Object.hasOwn(r, "secret"), false);
  await assert.rejects(executeAttendanceMissing(input, { rpc: async () => ({ data: null, error: { message: "private_sql" } }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceMissing({ ...input, command: cmd }, { rpc: async () => ({ data: result(), error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceMissing(input, { rpc: async () => ({ data: null, error: { message: "attendance_missing_basis_changed" } }) }), /attendance_missing_basis_changed/);
});
function fixture() {
  const storage = new Map<string, string>(), calls: string[] = []; let saved = false, lose = true, server = result(), reject: string | null = null;
  const apiFetch = async (url: string, init?: RequestInit) => { calls.push(init?.method ?? "GET");
    if (init?.method === "POST") { const body = parseMissingBody(JSON.parse(String(init.body))); assert.deepEqual(body.command, cmd);
      if (reject) return Response.json({ ok: false, error: reject }, { status: 409 });
      server = submitted(); saved = true; if (lose) { lose = false; throw Error("lost_response"); }
    }
    const receiptQuery = new URL(url, "https://local.invalid").searchParams.has("operationId");
    return Response.json({ ok: true, ...server, receipt: saved && (receiptQuery || init?.method === "POST") ? server.receipt : null });
  };
  const storageApi = () => ({ getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
  const client = new AttendanceMissingClient({ query: q, actorId: id(101), apiFetch, randomId: () => id(401), storage: storageApi });
  return { client, storage, calls, apiFetch, storageApi, setResult: (r: MissingResult) => { server = r; }, reject: (s: string) => { reject = s; } };
}
test("missing lost response persists original identity and receipt; initialize never auto-resubmits", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.submit(cmd); assert.equal(f.client.getSnapshot().phase, "unconfirmed"); assert.equal(f.storage.size, 1);
  await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "ready"); assert.equal(f.storage.size, 0); assert.deepEqual(f.calls, ["GET", "POST", "GET"]);
});
test("explicit retry queries existing receipt first, avoiding another POST after lost success", async () => {
  const f = fixture(); await f.client.initialize(); await f.client.submit(cmd); await f.client.retry(); assert.deepEqual(f.calls, ["GET", "POST", "GET"]); assert.equal(f.client.getSnapshot().pending, null);
});
test("bad stored operation is not deleted, replaced or transmitted", async () => {
  const f = fixture(); f.storage.set(f.client.storageKey, "{bad"); await f.client.initialize(); assert.equal(f.client.getSnapshot().phase, "blocked"); assert.equal(f.calls.length, 0); assert.equal(f.storage.size, 1);
});
test("platform pause blocks new requests, and foreign employee response is hidden", async () => {
  const f = fixture(); f.setResult({ ...result(), moduleEnabled: false }); await f.client.initialize(); await f.client.submit(cmd); assert.deepEqual(f.calls, ["GET"]);
  f.setResult({ ...result(), employeeId: id(102) }); await f.client.initialize(); assert.equal(f.client.getSnapshot().result, null); assert.equal(f.client.getSnapshot().phase, "blocked");
});
test("known first rejection clears attempted operation; operation collision remains uncertain", async () => {
  for (const code of ["attendance_missing_conflict", "attendance_operation_conflict"]) {
    const f = fixture(); f.reject(code); await f.client.initialize(); await f.client.submit(cmd);
    assert.equal(f.storage.size, code === "attendance_operation_conflict" ? 1 : 0); assert.equal(f.client.getSnapshot().result, null);
  }
});
test("storage change between read and submit never overwrites another pending operation", async () => {
  const f = fixture(); await f.client.initialize(); f.storage.set(f.client.storageKey, "{external"); await f.client.submit(cmd);
  assert.deepEqual(f.calls, ["GET"]); assert.equal(f.storage.get(f.client.storageKey), "{external");
});
test("hide aborts and late response cannot restore protected data", async () => {
  let release!: (r: Response) => void; const pending = new Promise<Response>(resolve => { release = resolve; });
  const client = new AttendanceMissingClient({ query: q, actorId: id(101), storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }), apiFetch: () => pending });
  const read = client.initialize(); client.pause(); release(Response.json({ ok: true, ...result() })); await read;
  assert.equal(client.getSnapshot().result, null); assert.equal(client.getSnapshot().phase, "blocked");
});
