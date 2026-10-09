import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as c from "./merchantAttendanceDelegatedCredentials";
import * as ui from "./merchantAttendanceDelegatedCredentialsUi";
//Synthetic DTO/helper examples, not an Auth, SQL, KDF or device acceptance.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, siteId = "99990207", actorId = id(1), grantId = id(2),
  at = "2026-10-09T12:00:00.000001Z", readAt = "2026-10-09T12:02:00.000000Z", secret = "A".repeat(43),
  q = ui.managementCredentialsQuery(siteId, grantId), draft = { label: "Front desk", reason: "Explicit scoped action", acknowledged: true };
function terminal(action: c.DelegatedTerminalAction = "terminal_prepare") {
  return { protocol: c.DELEGATED_TERMINALS_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "terminal", terminalId: id(3), locationId: id(4), create: action === "terminal_prepare" },
    context: { terminal: action === "terminal_prepare" ? null : { id: id(3), label: "Front desk", locationId: id(4), locationName: "Location", timeZone: "UTC", state: "pending",
      createdAt: at, pairExpiresAt: "2026-10-09T12:05:00.000001Z", pairedAt: null, deviceExpiresAt: null, revokedAt: null },
    location: { locationId: id(4), name: "Location", timeZone: "UTC", version: 5, active: true } } };
}
function member(action: c.DelegatedPinAction = "pin_issue") {
  return { protocol: c.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "member_pin", workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), locationIds: [id(4)] },
    context: { employeeAuthUserId: id(7), status: { siteId, workerId: id(5), employeeId: id(6), workerNo: "Staff-01", workerName: "Member", ready: true,
      revision: 3, enabled: true, bindingCurrent: true, changedAt: at, receipt: null } } };
}
function independent(action: c.DelegatedPinAction = "pin_issue") {
  return { protocol: c.DELEGATED_PIN_PROTOCOL, siteId, actorId, readAt, kind: "context", grantId, action,
    scope: { kind: "independent_pin", workerId: id(5), subjectId: id(8), generation: 2, locationIds: [id(4)] },
    context: { settingsVersion: 9, detail: { kind: "detail", subject: { subjectId: id(8), workerId: id(5), workerNo: "Independent-01", displayName: "Independent", startsOn: "2026-10-01",
      locationId: id(4), enabled: true, generation: 2, revision: 4, workerVersion: 7, state: "independent", createdAt: at },
    credential: { credentialId: id(9), revision: 6, enabled: true, generation: 2, changedAt: at },
    head: { sequence: 0, status: "off", lastEventId: null, lastAction: null, lastAt: null }, binding: null } } };
}
test("207 owner four-action structured scopes require acknowledgment and real fixed identities", () => {
  for (const action of c.DELEGATED_CREDENTIALS_ACTIONS) {
    const scope = action.startsWith("terminal_") ? terminal(action as c.DelegatedTerminalAction).scope : member(action as c.DelegatedPinAction).scope,
      raw = { delegateEmployeeId: id(10), delegateAuthUserId: id(11), delegatedAction: action, scope,
        validFrom: "2026-10-09T12:00", validUntil: "2026-10-10T12:00", reason: "Explicit exact scope", acknowledged: true };
    assert.equal(ui.buildManagementCredentialsGrant(raw, id(12)).delegatedAction, action);
    assert.throws(() => ui.buildManagementCredentialsGrant({ ...raw, acknowledged: false }, id(12)));
    assert.throws(() => ui.buildManagementCredentialsGrant({ ...raw, pin: "12345678" }, id(12)));
  }
  assert.throws(() => ui.buildManagementCredentialsGrant({ delegatedAction: "audit_view" }, id(12)));
});
test("207 prepare uses browser SHA identical to old UTF8 SHA; secret exists only in ephemeral dispatch body", async () => {
  assert.equal(await ui.managementPairHash(secret), createHash("sha256").update(secret, "utf8").digest("hex"));
  const body = await ui.buildManagementTerminalBody(terminal(), q, actorId, draft, id(12), secret);
  assert("pairSecret" in body); assert.equal(body.pairSecret, secret); assert.equal(body.command.terminalId, id(3)); assert.equal(body.command.locationId, id(4));
  assert(!JSON.stringify(body.command).includes(secret)); assert.equal(body.command.action, "terminal_prepare");
  await assert.rejects(ui.buildManagementTerminalBody(terminal(), q, actorId, draft, id(12)));
});
test("207 terminal revoke accepts no secret and takes resource identity only from strict scoped context", async () => {
  const body = await ui.buildManagementTerminalBody(terminal("terminal_revoke"), q, actorId, draft, id(12));
  assert.deepEqual(body.command, { action: "terminal_revoke", operationId: id(12), terminalId: id(3), locationId: id(4), reason: draft.reason });
  assert(!("pairSecret" in body)); await assert.rejects(ui.buildManagementTerminalBody(terminal("terminal_revoke"), q, actorId, draft, id(12), secret));
  await assert.rejects(ui.buildManagementTerminalBody(terminal(), q, id(90), draft, id(12), secret));
});
test("207 member PIN issue uses actual context triple, workerNo and revision; no user CAS override", async () => {
  const body = await ui.buildManagementPinBody(member(), q, actorId, draft, id(12), "12345678"); assert("pin" in body);
  assert.deepEqual(body.command, { action: "pin_issue", operationId: id(12), kind: "member_pin", workerId: id(5), employeeId: id(6), employeeAuthUserId: id(7), workerNo: "Staff-01", expectedRevision: 3, reason: draft.reason });
  assert(!JSON.stringify(body.command).includes("12345678"));
  await assert.rejects(ui.buildManagementPinBody(member(), q, actorId, { ...draft, expectedRevision: 0 }, id(12), "12345678"));
  await assert.rejects(ui.buildManagementPinBody(member(), q, actorId, draft, id(12), "1234"));
});
test("207 independent PIN issue preserves saved subject generation plus every current CAS, not fake employee Auth", async () => {
  const body = await ui.buildManagementPinBody(independent(), q, actorId, draft, id(12), "12345678");
  assert.equal(body.command.kind, "independent_pin"); if (body.command.kind !== "independent_pin") assert.fail();
  assert.equal(body.command.subjectId, id(8)); assert.equal(body.command.expectedGeneration, 2); assert.equal(body.command.expectedSubjectRevision, 4);
  assert.equal(body.command.expectedWorkerVersion, 7); assert.equal(body.command.expectedSettingsVersion, 9); assert.equal(body.command.expectedCredentialRevision, 6);
  assert(!("employeeAuthUserId" in body.command)); await assert.rejects(ui.buildManagementPinBody(independent(), { ...q, grantId: id(99) }, actorId, draft, id(12), "12345678"));
});
test("207 both PIN revoke kinds forbid any PIN and retain context-only revisions", async () => {
  for (const context of [member("pin_revoke"), independent("pin_revoke")]) {
    const body = await ui.buildManagementPinBody(context, q, actorId, draft, id(12)); assert.equal(body.command.action, "pin_revoke"); assert(!("pin" in body));
    await assert.rejects(ui.buildManagementPinBody(context, q, actorId, draft, id(12), "12345678"));
  }
});
test("207 transient pair token expires exactly 15 seconds from generation and cannot reappear for a different operation", () => {
  const display = ui.managementPairDisplay(siteId, id(3), id(12), secret, 1000);
  assert.equal(display.token, `${siteId}.${id(3)}.${secret}`); assert.equal(display.expiresAt, 16000);
  assert(ui.managementPairDisplayCurrent(display, id(12), 15999)); assert(!ui.managementPairDisplayCurrent(display, id(12), 16000));
  assert(!ui.managementPairDisplayCurrent(display, id(99), 1100)); assert(!ui.managementPairDisplayCurrent(null, id(12), 1100));
  assert(!ui.managementPairDisplayCurrent(display, id(12), 999)); assert(!ui.managementPairDisplayCurrent(display, id(12), NaN));
});
test("207 helpers reject unacknowledged/poisoned drafts before async context or secret processing", async () => {
  for (const bad of [{ ...draft, acknowledged: false }, { ...draft, pairSecret: secret }, { ...draft, pin: "12345678" }]) {
    await assert.rejects(ui.buildManagementTerminalBody(terminal(), q, actorId, bad, id(12), secret));
    await assert.rejects(ui.buildManagementPinBody(member(), q, actorId, bad, id(12), "12345678"));
  }
  let reads = 0; await assert.rejects(ui.buildManagementPinBody(member(), q, actorId, { ...draft, get reason() { reads++; return "x"; } }, id(12), "12345678")); assert.equal(reads, 0);
});
