import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseApplicationDelegationQuery, parseApplicationDelegationHttpQuery, applicationDelegationQueryString, parseApplicationDelegationBody,
  parseApplicationDelegationResponse, parseApplicationDelegationJson, applicationDelegationFingerprintText, applicationDelegationCommandFingerprint,
  applicationDelegationReceiptMatches } from "./merchantAttendanceApplicationDelegation";
import { applicationDelegationQuery as query, applicationDelegationHttp as http, applicationDelegationCommand as command, applicationDelegationGrantCommand as grantCommand,
  applicationDelegationReceiptHttp as receipt, applicationDelegationId as id } from "../../scripts/fixtures/attendance-application-delegation-model";

test("strict owner/delegate query modes reject locations, free identities, duplicate and whitespace parameters", () => {
  for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.deepEqual(parseApplicationDelegationHttpQuery(`https://x.invalid/?${applicationDelegationQueryString(q)}`), q); }
  for (const patch of [{ siteId: "99990001\n" }, { actorId: id(1) }, { grantId: id(10) }, { beforeId: id(5) }]) assert.throws(() => parseApplicationDelegationQuery({ ...query(), ...patch }));
  assert.throws(() => parseApplicationDelegationQuery({ ...query("owner", "catalog"), catalog: "locations" }));
  for (const extra of ["&siteId=99990001", "&category=leave", "&actorId=" + id(1)]) assert.throws(() => parseApplicationDelegationHttpQuery(`https://x.invalid/?${applicationDelegationQueryString(query())}${extra}`));
  assert.throws(() => parseApplicationDelegationHttpQuery(`https://x.invalid/?${applicationDelegationQueryString(query("delegate", "decide"))}`));
});
test("category/kinds/includePending are explicit and cannot silently inherit historical or other-category authority", () => {
  for (const category of ["leave", "work_arrangement"] as const) assert.deepEqual(parseApplicationDelegationBody({ query: query("owner"), command: grantCommand(category) }).command, grantCommand(category));
  for (const patch of [{ includePending: undefined }, { kinds: ["trip"] }, { category: "both" }, { locationId: id(7) }, { employeeAuthUserId: id(3) }])
    assert.throws(() => parseApplicationDelegationBody({ query: query("owner"), command: { ...grantCommand(), ...patch } }));
  for (const kinds of [[], ["field", "trip"], ["trip", "trip"], ["other"]]) assert.throws(() => parseApplicationDelegationBody({ query: query("owner"), command: { ...grantCommand("work_arrangement"), kinds } }));
});
test("old exact5/exact7 decision is isolated from fixed outer authority and evidence", () => {
  for (const category of ["leave", "work_arrangement"] as const) { const c = command(category); assert.equal(Object.keys(c.decision).length, category === "leave" ? 5 : 7); assert.deepEqual(parseApplicationDelegationBody({ query: query("delegate", "decide"), command: c }).command, c); }
  const c = command("work_arrangement"); for (const bad of [{ ...c, expectedGrantRevision: 2 }, { ...c, expectedEvidenceFingerprint: "a".repeat(32) },
    { ...c, decision: { ...c.decision, action: "reject" } }, { ...c, decision: { ...c.decision, grantId: id(10) } }, { ...c, decision: { ...c.decision, action: "cancel" } }])
    assert.throws(() => parseApplicationDelegationBody({ query: query("delegate", "decide"), command: bad }));
});
test("fixed scalar tuple preserves boolean/null/kind order and WebCrypto matches SHA256", async () => {
  const c = grantCommand("work_arrangement"); c.reason = 'Quoted "\\ 日本😀';
  const text = applicationDelegationFingerprintText("99990001", "owner", c);
  assert(text.includes('"trip,field,remote", false,')); assert.equal(await applicationDelegationCommandFingerprint("99990001", "owner", c), createHash("sha256").update(text).digest("hex"));
  const leave = applicationDelegationFingerprintText("99990001", "delegate", command()); assert(leave.endsWith('"Synthetic review", null, null]'));
  assert.notEqual(await applicationDelegationCommandFingerprint("99990001", "owner", c), await applicationDelegationCommandFingerprint("99990001", "owner", { ...c, includePending: true }));
});
test("valid views use immutable UTC and saved zone without current Intl or readAt monotonic assumptions", () => {
  for (const category of ["leave", "work_arrangement"] as const) for (const [access, modes] of [["owner", ["list", "catalog", "detail", "recover"]], ["delegate", ["grants", "list", "detail", "recover"]]] as const)
    for (const mode of modes) { const q = query(access, mode); assert.equal(parseApplicationDelegationResponse(http(q, category), q).mode, mode); }
  const q = query("delegate", "detail"), w = http(q); if (w.protocol !== "delegated-applications-v1" || !w.detail) throw Error("fixture"); w.detail.timeZone = "Historical/Zone"; w.readAt = "2001-01-01T00:00:00.000000Z";
  const saved = Object.getOwnPropertyDescriptor(Intl, "DateTimeFormat")!; Object.defineProperty(Intl, "DateTimeFormat", { configurable: true, value: () => { throw Error("no current zone"); } });
  try { assert.equal(parseApplicationDelegationResponse(w, q).mode, "detail"); } finally { Object.defineProperty(Intl, "DateTimeFormat", saved); }
});
test("minimal conflicts cannot carry IDs, reasons or wrong categories; blocked/sealed never permits approval", () => {
  const q = query("delegate", "detail"), w = http(q, "work_arrangement"); if (w.protocol !== "delegated-applications-v1" || !w.detail) throw Error("fixture"); const d = w.detail;
  const conflict = { source: "schedule", kind: null, startAt: d.startAt, endAt: d.endAt, timeZone: d.timeZone };
  assert.equal(parseApplicationDelegationResponse({ ...w, detail: { ...d, conflicts: [conflict] } }, q).mode, "detail");
  for (const patch of [{ id: id(8) }, { reason: "private" }, { kind: "leave" }, { startAt: d.endAt }]) assert.throws(() => parseApplicationDelegationResponse({ ...w, detail: { ...d, conflicts: [{ ...conflict, ...patch }] } }, q));
  for (const patch of [{ blocked: true }, { sealed: true }, { canReject: false }, { category: "leave" }, { startAt: d.startAt.replace(".000Z", ".000000Z") }])
    assert.throws(() => parseApplicationDelegationResponse({ ...w, detail: { ...d, ...patch } }, q));
  assert.throws(() => parseApplicationDelegationResponse({ ...w, detail: { ...d, conflicts: Array(101).fill(conflict) } }, q));
});
test("receipt-only original recovery matches op/grant/request/action/hash without granting body access", async () => {
  for (const category of ["leave", "work_arrangement"] as const) { const q = query("delegate", "recover"), c = command(category), w = await receipt(q, c, category), r = parseApplicationDelegationResponse(w, q, { authUserId: id(3), employeeId: id(2) });
    assert(r.receipt && "category" in r.receipt); assert(applicationDelegationReceiptMatches(r.receipt, c, await applicationDelegationCommandFingerprint(q.siteId, q.access, c)));
    assert.throws(() => parseApplicationDelegationResponse({ ...w, receipt: { ...w.receipt, reason: "private" } }, q));
    assert.throws(() => parseApplicationDelegationResponse(w, q, { authUserId: id(99) }));
    assert(!applicationDelegationReceiptMatches({ ...r.receipt, category: category === "leave" ? "work_arrangement" : "leave" }, c, r.receipt.commandFingerprint)); }
});
test("unsafe graphs, duplicate JSON, lone surrogate, sparse array and request/body caps fail closed", () => {
  assert.throws(() => parseApplicationDelegationJson('{"a":1,"a":2}')); assert.throws(() => parseApplicationDelegationJson('"' + "x".repeat(8192) + '"', "request"));
  assert.throws(() => parseApplicationDelegationQuery({ ...query(), siteId: "\ud800" })); const w = http(); assert.throws(() => parseApplicationDelegationResponse({ ...w, grants: new Array(1) }, query()));
  assert.throws(() => parseApplicationDelegationResponse(Object.defineProperty({ ...w }, "actorId", { get: () => { throw Error("getter"); } }), query()));
});
