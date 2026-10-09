import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseScheduleDelegationQuery, parseScheduleDelegationHttpQuery, parseScheduleDelegationBody, parseScheduleDelegationJson,
  parseScheduleDelegationResult, parseScheduleDelegationResponse, scheduleDelegationQueryString, scheduleDelegationFingerprintText,
  scheduleDelegationFingerprint, scheduleDelegationReceiptMatches, type ScheduleDelegationCommand } from "./merchantAttendanceScheduleDelegation";
import { scheduleDelegationQuery as query, scheduleDelegationGrantCommand as grant, scheduleDelegationCommand as command,
  scheduleDelegationWire as wire, scheduleDelegationReceiptHttp as receipt, scheduleDelegationId as id } from "../../scripts/fixtures/attendance-schedule-delegation-model";

test("exact query modes/selectors and 31 civil date maximum round trip", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "schedule", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.deepEqual(parseScheduleDelegationHttpQuery(`https://local/?${scheduleDelegationQueryString(q)}`), q); }
  assert.doesNotThrow(() => parseScheduleDelegationQuery({ ...query("delegate", "schedule"), fromDate: "2026-10-01", throughDate: "2026-10-31" }));
  for (const q of [{ ...query(), mode: "list" }, { ...query("owner"), mode: "grants" }, { ...query(), grantId: id(4) }, { ...query("owner", "detail"), catalog: "workers" },
    { ...query("delegate", "schedule"), throughDate: "2026-11-07" }, { ...query("delegate", "schedule"), fromDate: "2026-02-30" }, { ...query(), actorId: id(1) }]) assert.throws(() => parseScheduleDelegationQuery(q));
  assert.throws(() => parseScheduleDelegationHttpQuery(`https://local/?${scheduleDelegationQueryString(query())}&siteId=98400198`));
});
test("strict command scope, sorted canonical actions, exact minute slots and no self grant", () => {
  const q = query("delegate", "schedule"), c = command(); assert.deepEqual(parseScheduleDelegationBody({ query: q, command: c }), { query: q, command: c });
  assert.doesNotThrow(() => parseScheduleDelegationBody({ query: query("owner"), command: grant() }));
  const decision = c.decision;
  for (const bad of [{ ...grant(), actions: ["cancel", "publish"] }, { ...grant(), actions: ["publish", "publish"] }, { ...grant(), actions: [] },
    { ...grant(), delegateEmployeeId: grant().employeeId }, { ...grant(), delegateAuthUserId: grant().employeeAuthUserId }, { ...grant(), validFrom: "2026-02-30T00:00:00.000000Z" },
    { ...grant(), reason: " bad" }, { ...grant(), actorId: id(1) }]) assert.throws(() => parseScheduleDelegationBody({ query: query("owner"), command: bad }));
  for (const d of [{ ...decision, slots: [["2026-10-07T09:00:01.000Z", "2026-10-07T17:00:00.000Z"]] },
    { ...decision, slots: [["2026-10-07T09:00:00.000Z", "2026-10-08T09:01:00.000Z"]] }, { ...decision, expectedRevision: -0 }, { ...decision, grantId: id(10) }])
    assert.throws(() => parseScheduleDelegationBody({ query: q, command: { expectedGrantRevision: 1, decision: d } }));
  assert.throws(() => parseScheduleDelegationBody({ query: { ...q, operationId: id(30) }, command: c }));
  assert.throws(() => parseScheduleDelegationBody({ query: query("owner", "detail"), command: { action: "revoke", operationId: id(30), grantId: id(11), expectedRevision: 1, reason: "Revoke" } }));
});
test("all four fingerprints use PG scalar spacing and compact nested slots without altering reason spaces", async () => {
  const pairs: [ReturnType<typeof query>, ScheduleDelegationCommand][] = [[query("owner"), grant()], [query("owner", "detail"), { action: "revoke", operationId: id(30), grantId: id(10), expectedRevision: 1, reason: "a  b" }],
    [query("delegate", "schedule"), command()], [query("delegate", "schedule"), command("cancel")]];
  for (const [q, c] of pairs) { const text = scheduleDelegationFingerprintText(q, c); assert.ok(text.startsWith('["attendance-schedule-delegation-v1", "98400198", '));
    assert.equal(await scheduleDelegationFingerprint(q, c), createHash("sha256").update(text).digest("hex"));
    const tuple = JSON.parse(text); assert.equal(JSON.stringify(tuple.map((x: unknown) => x)), JSON.stringify(JSON.parse(text)));
    const r = await receipt(q, c); assert.equal(scheduleDelegationReceiptMatches(r.receipt, q, c, r.receipt.commandFingerprint), true);
    assert.equal(scheduleDelegationReceiptMatches({ ...r.receipt, actorId: id(90), commandFingerprint: "0".repeat(64) }, q, c, r.receipt.commandFingerprint), false);
  }
  const tuple = JSON.parse(scheduleDelegationFingerprintText(query("delegate", "schedule"), command())); assert.equal(tuple[11], "明确  排班");
  assert.equal(tuple[14], JSON.stringify((command().decision as { slots: unknown }).slots));
  assert.notEqual(await scheduleDelegationFingerprint(query("delegate", "schedule"), command()), await scheduleDelegationFingerprint({ ...query("delegate", "schedule"), throughDate: "2026-10-09" }, command()));
});
test("result exact shape, identities, field relationships and minimal receipt exclusivity", async () => {
  for (const q of [query(), query("owner"), query("owner", "catalog"), query("owner", "detail"), query("delegate", "schedule"), query("delegate", "recover")]) assert.deepEqual(parseScheduleDelegationResult(wire(q), q), wire(q));
  const q = query("delegate", "schedule"), original = wire(q);
  for (const alter of [(v: typeof original) => { v.actorId = id(77); }, (v: typeof original) => { v.employeeId = id(77); },
    (v: typeof original) => { v.schedule!.grant.worker.authUserId = id(3); }, (v: typeof original) => { v.schedule!.entries[0].locationId = id(77); },
    (v: typeof original) => { v.schedule!.entries[0].cancelled = true; }, (v: typeof original) => { v.schedule!.rangeLimited = true; },
    (v: typeof original) => { v.schedule!.entries[0].revision = 2; }, (v: typeof original) => { v.schedule!.grant.usableActions = ["publish"]; }]) {
    const v = structuredClone(original); alter(v); assert.throws(() => parseScheduleDelegationResult(v, q, { employeeId: id(2), authUserId: id(3) })); }
  const c = command(), r = await receipt(q, c); assert.doesNotThrow(() => parseScheduleDelegationResponse(r, q, { authUserId: id(3) }, c));
  for (const bad of [{ ...r, schedule: original.schedule }, { ...r, command: c }, { ...r, canWrite: true }, { ...r, receipt: { ...r.receipt, scheduleRevision: 9 } },
    { ...r, receipt: { ...r.receipt, actorId: id(1) } }, { ...r, receipt: null }]) assert.throws(() => parseScheduleDelegationResponse(bad, q, {}, c));
});
test("saved zone labels and server usable observation are not reinterpreted at a later readAt", () => {
  const q = query("delegate", "schedule"), r = wire(q); r.readAt = "2027-01-01T00:00:00.000000Z"; r.schedule!.timeZone = "Current/Zone"; r.schedule!.grant.location.timeZone = "Saved/RetiredZone";
  r.schedule!.entries[0].timeZone = "Saved/OtherZone"; assert.doesNotThrow(() => parseScheduleDelegationResult(r, q));
});
test("bounded parser rejects duplicate JSON, getters, sparse arrays, symbols, cycles, malformed Unicode and size excess", () => {
  assert.throws(() => parseScheduleDelegationJson('{"a":1,"a":2}')); assert.throws(() => parseScheduleDelegationJson('"' + "x".repeat(131073) + '"'));
  const q = query(), r = wire(q);
  for (const raw of [{ ...r, readAt: "2026-02-30T00:00:00.000000Z" }, { ...r, readAt: "2026-10-06T12:00:00.123Z" }, { ...r, grants: new Array(1) },
    { ...r, [Symbol("hidden")]: true }, { ...r, bad: "\ud800" }, Object.defineProperty({ ...r }, "actorId", { get() { throw Error("must not run"); }, enumerable: true })]) assert.throws(() => parseScheduleDelegationResult(raw, q));
  const cyclic: Record<string, unknown> = { ...r }; cyclic.extra = cyclic; assert.throws(() => parseScheduleDelegationResult(cyclic, q));
});
