import assert from "node:assert/strict";
import test from "node:test";
import { parseLocationSetupCommand, parseLocationSetupQuery, parseLocationSetupResult, setupReceiptMatches } from "./merchantAttendanceLocationSetup";
import { executeLocationSetup } from "./merchantAttendanceLocationSetup.server";
import { createLocationSetupModel, setupOwner, setupQuery } from "../../scripts/fixtures/attendance-location-setup-model";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const command = createLocationSetupModel().command(id(3));
const body = { siteId: setupQuery.siteId, locationId: setupQuery.locationId, ...command };
const url = `https://www.faolla.com/?siteId=${setupQuery.siteId}&locationId=${setupQuery.locationId}`;
test("setup commands accept only version-pinned actions, not client coordinates or identities", () => {
  assert.deepEqual(parseLocationSetupCommand(body), { query: setupQuery, command });
  for (const extra of [{ latitude: 0 }, { values: {} }, { ownerId: setupOwner }, { allowPrepare: true }, { action: "clear" }, { reason: "" },
    { expectedChannelVersion: 0 }, { expectedSettingsVersion: 9007199254740991 }, { expectedLocationVersion: "1" }, { draftRevision: 1.5 }, { draftRevision: 9007199254740990 }, { reason: "a\nb" }])
    assert.throws(() => parseLocationSetupCommand({ ...body, ...extra }));
  for (const action of ["enable", "pause"]) { assert.equal(parseLocationSetupCommand({ ...body, action, draftRevision: null }).command.action, action); assert.throws(() => parseLocationSetupCommand({ ...body, action })); }
});
test("setup query rejects duplicates, arbitrary target ownership and overbroad fields", () => {
  assert.deepEqual(parseLocationSetupQuery(url), setupQuery);
  for (const extra of ["&siteId=99990002", "&ownerId=x", "&latitude=0", "&allow=true", "&operationId=invalid"]) assert.throws(() => parseLocationSetupQuery(url + extra));
});
test("strict result projection binds owner and target and preserves microseconds", async () => {
  const m = createLocationSetupModel(); const response = await m.apiFetch("/api/merchant-enterprise/attendance/location-setup", { method: "POST", body: JSON.stringify(body) });
  const raw = await response.json(), expected = { ...setupQuery, ownerId: setupOwner, operationId: command.operationId };
  const result = parseLocationSetupResult({ ...raw, secret: "hidden" }, expected);
  assert.equal(result.receipt?.recordedAt, "2026-09-30T10:00:00.123456Z"); assert.equal(result.draft?.revision, 2); assert.equal(result.notice, null);
  assert.deepEqual(parseLocationSetupResult(JSON.parse(JSON.stringify(result)), expected), result); assert.doesNotMatch(JSON.stringify(result), /secret/);
  for (const extra of [{ siteId: "99990002" }, { ownerId: id(99) }, { locationId: id(99) }, { canEnable: true }, { canPause: true }, { noticeMatches: true },
    { receipt: { ...raw.receipt, recordedAt: "2026-02-30T10:00:00.123456Z" } },
    { receipt: { ...raw.receipt, after: { ...raw.receipt.after, locationVersion: 1 } } },
    { receipt: { ...raw.receipt, after: { ...raw.receipt.after, channelEnabled: true } } }]) assert.throws(() => parseLocationSetupResult({ ...raw, ...extra }, expected));
  assert.equal(setupReceiptMatches(result.receipt!, { ...command, reason: "another reason" }), false);
});
test("server calls owner RPC with server permission and insists on exact write receipt", async () => {
  const m = createLocationSetupModel(), data = await (await m.apiFetch("/api/merchant-enterprise/attendance/location-setup", { method: "POST", body: JSON.stringify(body) })).json();
  const input = { ...setupQuery, command, authUserId: setupOwner, allowPrepare: false };
  let count = 0;
  const result = await executeLocationSetup(input, { rpc: async (name, args) => {
    count++; assert.equal(name, "faolla_attendance_location_setup_v1"); assert.equal(args.p_auth_user_id, setupOwner); assert.equal(args.p_allow_prepare, false); assert.deepEqual(args.p_command, command);
    return { data, error: null };
  } }); assert.ok(result.receipt); assert.equal(count, 1);
  for (const bad of [{ ...data, receipt: null }, { ...data, ownerId: id(99) }, { ...data, receipt: { ...data.receipt, command: { ...command, reason: "different" } } }])
    await assert.rejects(executeLocationSetup(input, { rpc: async () => ({ data: bad, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeLocationSetup({ ...input, operationId: id(3) }, { rpc: async () => { throw Error("must not call"); } }), /attendance_invalid_request/);
});
test("server maps only known failures, never leaks raw database diagnostics", async () => {
  const input = { ...setupQuery, authUserId: setupOwner, command: null, allowPrepare: true };
  for (const [message, code] of [["attendance_setup_not_ready", "attendance_setup_not_ready"], ["attendance_setup_open_web_shift", "attendance_setup_open_web_shift"], ["private DB info", "attendance_unavailable"], ["constructor", "attendance_unavailable"]])
    await assert.rejects(executeLocationSetup(input, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(code));
  await assert.rejects(executeLocationSetup(input, null), /attendance_unavailable/);
});

test("ordinary open shifts disable preparation and contradictory capabilities fail closed", () => {
  const m = createLocationSetupModel(); m.openWebShift(true);
  const raw = m.current(), expected = { ...setupQuery, ownerId: setupOwner };
  assert.equal(parseLocationSetupResult(raw, expected).canPrepare, false);
  assert.throws(() => parseLocationSetupResult({ ...raw, canPrepare: true }, expected));
  assert.throws(() => parseLocationSetupResult({ ...raw, openWebShift: undefined }, expected));
  m.openWebShift(false); assert.equal(parseLocationSetupResult(m.current(), expected).canPrepare, true);
});
