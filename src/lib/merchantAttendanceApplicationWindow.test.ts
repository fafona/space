// Synthetic pure wire/adapter checks, not real SQL/Auth/activation acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { applicationWindowFixture, windowId as id, windowActor, windowAt, signWindowSource } from "./merchantAttendanceApplicationWindowTestFixtures";
import { APPLICATION_WINDOW_FAMILIES, applicationWindowQueryString, parseApplicationWindowHttpQuery, parseApplicationWindowQuery, parseApplicationWindowBody,
  parseApplicationWindowJson, parseApplicationWindowResult, parseApplicationWindowRpcResult, applicationWindowCommandFingerprint, applicationWindowDeadline,
  applicationWindowFingerprint, type ApplicationWindowQuery } from "./merchantAttendanceApplicationWindow";
import { executeApplicationWindow, applicationWindowEnabled } from "./merchantAttendanceApplicationWindow.server";

test("194 exact scalar four-family queries and old submit schemas preserve root/scope and literal null", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family), text = applicationWindowQueryString(f.query);
    assert.deepEqual(parseApplicationWindowHttpQuery("https://local.invalid/?" + text), f.query); assert.deepEqual(parseApplicationWindowBody({ query: f.query, command: f.command }).command, f.command);
    assert.throws(() => parseApplicationWindowHttpQuery("https://local.invalid/?" + text + "&siteId=99990001"));
    assert.throws(() => parseApplicationWindowBody({ query: f.query, command: { ...f.command, command: { ...f.command.command, actorId: windowActor } } }));
    assert.throws(() => parseApplicationWindowBody({ query: { siteId: f.query.siteId, family, mode: "recover", operationId: id(300) }, command: f.command }));
  }
  const f = await applicationWindowFixture("missing"); assert.match(applicationWindowQueryString(f.query), /supersedesRequestId=null/);
  for (const patch of [{ throughDate: "2026-11-01" }, { supersedesRequestId: id(400) }, { proposedStartAt: "2026-09-28T08:00:00.000Z" }, { ownerId: id(1) }]) assert.throws(() => parseApplicationWindowQuery({ ...f.query, ...patch }));
});
test("194 zero-getter bounded JSON and unsafe Unicode/UUID/null inputs fail closed", async () => {
  const f = await applicationWindowFixture(); let calls = 0; const q = { ...f.query }; Object.defineProperty(q, "siteId", { enumerable: true, get() { calls++; return "99990001"; } });
  assert.throws(() => parseApplicationWindowQuery(q)); assert.equal(calls, 0);
  for (const bad of [null, undefined, [], { ...f.query, workerId: id(2) + "\n" }, { ...f.query, extra: "\ud800" }, { ...f.query, extra: "\0" }]) assert.throws(() => parseApplicationWindowQuery(bad));
  assert.throws(() => parseApplicationWindowJson('{"query":null,"query":null}', "request")); assert.throws(() => parseApplicationWindowJson(" ".repeat(16385), "request"));
  const c = { ...f.command.command }; Object.defineProperty(c, "reason", { enumerable: true, get() { calls++; return "unsafe"; } });
  assert.throws(() => parseApplicationWindowBody({ query: f.query, command: { ...f.command, command: c } })); assert.equal(calls, 0);
});
test("194 all four actual-shaped applications parse with independently checked source and compact projection", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family), r = await parseApplicationWindowRpcResult(f.raw, f.input);
    assert.equal(r.family, family); assert.equal(r.canSubmit, true); assert(!Object.hasOwn(r, "source")); assert(Object.isFrozen(r));
    assert.equal(r.window?.employeeAuthUserId, windowActor); assert.equal(r.application?.workerId, id(2));
    if (family === "correction_revision") assert.equal(r.window?.anchorAt, "2026-09-28T08:00:00.000000Z");
    if (family === "missing_revision") assert.equal("detail" in r.application! && r.application.detail?.requestId, id(400));
  }
});
test("194 original policy, selected layer, source/time/hash and exact natural-day deadline all bind", async () => {
  const f = await applicationWindowFixture();
  for (const patch of [{ workerId: id(99) }, { employeeId: id(99) }, { employeeAuthUserId: id(99) }, { sourceFingerprint: "b".repeat(64) }, { windowFingerprint: "b".repeat(64) },
    { observedAt: "2026-09-30T14:00:00.000001Z" }, { selectedDays: 1 }, { baselineDeadlineAt: "2026-10-06T00:00:00.000000Z" }, { effectiveDeadlineAt: "2026-10-05T22:00:00.000000Z" }])
    await assert.rejects(parseApplicationWindowRpcResult({ ...f.raw, result: { ...f.result, window: { ...f.result.window!, ...patch } } }, f.input));
  const source = signWindowSource({ ...f.source, workerIdentity: { ...f.source.workerIdentity, employeeAuthUserId: id(99) } });
  await assert.rejects(parseApplicationWindowRpcResult({ ...f.raw, source }, f.input));
  const disabled = await applicationWindowFixture("correction", null); assert.equal((await parseApplicationWindowRpcResult(disabled.raw, disabled.input)).window?.selectedDays, null);
});
test("194 disabled activation/read authority cannot promote nested old capability; expiry equality rejects canSubmit", async () => {
  const f = await applicationWindowFixture(); await assert.rejects(parseApplicationWindowRpcResult(f.raw, { ...f.input, allowWrite: false }));
  const w = { ...f.result.window!, activationRevision: 0 }; w.windowFingerprint = await applicationWindowFingerprint("correction", w, f.source);
  await assert.rejects(parseApplicationWindowRpcResult({ ...f.raw, result: { ...f.result, window: w } }, f.input));
  assert.equal((await parseApplicationWindowRpcResult({ ...f.raw, result: { ...f.result, window: w, canSubmit: false } }, f.input)).canSubmit, false);
  await assert.rejects(parseApplicationWindowResult({ ...f.result, readAt: f.result.window!.effectiveDeadlineAt }, f.input));
  const missing = await applicationWindowFixture("missing_revision"), app = missing.result.application;
  assert(app && "detail" in app && app.detail); await assert.rejects(parseApplicationWindowResult({ ...missing.result, application: { ...app, detail: { ...app.detail, lineage: null } } }, missing.input));
});
test("194 local-day deadlines preserve DST/skipped days and old beyond2100 SQL authority", () => {
  assert.equal(applicationWindowDeadline("2026-03-28T23:00:00.000000Z", 0, "Europe/Madrid"), "2026-03-29T22:00:00.000000Z");
  assert.equal(applicationWindowDeadline("2011-12-29T20:00:00.000000Z", 0, "Pacific/Apia"), "2011-12-30T10:00:00.000000Z");
  assert.equal(applicationWindowDeadline("2100-12-31T08:00:00.000000Z", 365, "UTC"), null);
});
test("194 command hashes include actual actor, full family/root query and original full submit", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family), before = await applicationWindowCommandFingerprint(f.query, f.command, windowActor);
    assert.notEqual(await applicationWindowCommandFingerprint(f.query, f.command, id(90)), before);
    assert.notEqual(await applicationWindowCommandFingerprint(f.query, { ...f.command, command: { ...f.command.command, reason: "Changed synthetic reason" } }, windowActor), before);
    assert.notEqual(await applicationWindowCommandFingerprint(f.query, { ...f.command, expectedWindowFingerprint: "c".repeat(64) }, windowActor), before);
  }
});
test("194 POST and exact original-number recovery return minimal receipt; no current source or permission", async () => {
  for (const family of APPLICATION_WINDOW_FAMILIES) { const f = await applicationWindowFixture(family);
    const r = await parseApplicationWindowRpcResult({ result: f.post, source: null }, { ...f.postInput, allowWrite: false }); assert.equal(r.mode, "receipt"); assert.equal(r.canSubmit, false);
    const query: ApplicationWindowQuery = { siteId: f.query.siteId, family, mode: "recover", operationId: id(300) };
    const recovered = await parseApplicationWindowRpcResult({ result: { ...f.post, mode: "recover" }, source: null }, { query, authUserId: windowActor, command: null, allowWrite: false }); assert.deepEqual(recovered.receipt, r.receipt);
    assert.equal((await parseApplicationWindowResult({ ...f.post, mode: "recover", receipt: null }, { query, authUserId: windowActor, command: null })).receipt, null);
    for (const patch of [{ actorId: id(99) }, { commandFingerprint: "b".repeat(64) }, { windowFingerprint: "b".repeat(64) }, { workerId: id(99) }]) await assert.rejects(parseApplicationWindowResult({ ...f.post, receipt: { ...f.post.receipt!, ...patch } }, f.postInput));
    await assert.rejects(parseApplicationWindowRpcResult({ result: f.post, source: f.source }, f.postInput));
  }
});
test("194 async source verification owns snapshots and never freezes caller inputs", async t => {
  const f = await applicationWindowFixture(), clone = structuredClone(f.raw), raw = { ...clone, result: { ...clone.result }, source: { ...clone.source } }, before = structuredClone(raw), actual = crypto.subtle.digest.bind(crypto.subtle); let once = false;
  t.mock.method(crypto.subtle, "digest", async (...args: Parameters<typeof crypto.subtle.digest>) => { if (!once) { once = true; raw.result.window = { ...raw.result.window!, employeeAuthUserId: id(99) }; raw.source.workerIdentity = { ...raw.source.workerIdentity, employeeAuthUserId: id(99) }; } return actual(...args); });
  const r = await parseApplicationWindowRpcResult(raw, f.input); assert.deepEqual(r, before.result); assert.equal(Object.isFrozen(raw), false);
});
test("194 service sends one real four-argument RPC and strips source, with exact old/new error mapping", async () => {
  const f = await applicationWindowFixture(); let count = 0;
  const result = await executeApplicationWindow(f.input, { rpc: async (name, args) => { count++; assert.equal(name, "faolla_attendance_application_window_v1"); assert.deepEqual(args, { p_query: f.query, p_auth_user_id: windowActor, p_command: null, p_allow_write: true }); return { data: f.raw, error: null }; } });
  assert.equal(count, 1); assert(!Object.hasOwn(result, "source"));
  for (const code of ["attendance_application_window_changed", "attendance_correction_basis_changed"]) await assert.rejects(executeApplicationWindow(f.input, { rpc: async () => ({ data: null, error: { message: code } }) }), new RegExp(code));
  await assert.rejects(executeApplicationWindow(f.input, { rpc: async () => ({ data: null, error: { message: "private postgres detail" } }) }), /attendance_application_window_invalid/);
  await assert.rejects(executeApplicationWindow(f.input, { rpc: async () => { throw Error("network"); } }), /attendance_application_window_invalid/);
});
test("194 new flags do not bypass original correction/revision/missing family flags or site allowlist", t => {
  const names = ["FAOLLA_ATTENDANCE_APPLICATION_WINDOW_ENABLED", "FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS", "FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED", "FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_REVISION_REQUESTS_ENABLED", "FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED", "FAOLLA_ATTENDANCE_MISSING_ENABLED"];
  const saved = names.map(k => [k, process.env[k]] as const); t.after(() => { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  for (const k of names) process.env[k] = "1"; process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS = "99990001";
  for (const f of APPLICATION_WINDOW_FAMILIES) assert.equal(applicationWindowEnabled("99990001", f), true);
  delete process.env.FAOLLA_ATTENDANCE_REVISION_CYCLES_ENABLED; assert.equal(applicationWindowEnabled("99990001", "correction_revision"), false); assert.equal(applicationWindowEnabled("99990001", "correction"), true);
  delete process.env.FAOLLA_ATTENDANCE_MISSING_ENABLED; assert.equal(applicationWindowEnabled("99990001", "missing_revision"), false);
  process.env.FAOLLA_ATTENDANCE_APPLICATION_WINDOW_SITE_IDS = "99990001\n"; assert.equal(applicationWindowEnabled("99990001", "correction"), false); assert.equal(windowAt.length, 27);
});
