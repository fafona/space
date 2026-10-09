import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleOnsiteClock, onsiteClockDependencies } from "./route-handler";
import { signOnsiteToken } from "@/lib/merchantAttendanceOnsiteQr.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const base = "https://www.faolla.com/api/merchant-enterprise/attendance/onsite-clock", id = "00000000-0000-4000-8000-000000000001";
function token() {
  const prior = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  try { process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = "12".repeat(32);
    return signOnsiteToken({ v: 1, purpose: "faolla.attendance.onsite", siteId: "99990001", terminalId: id, locationId: id, pairedAtMs: 1, issuedAtMs: 2, expiresAtMs: 45002, nonce: id });
  } finally { if (prior === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET; else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = prior; }
}
const body = () => ({ siteId: "99990001", token: token(), command: { expectedWorkerId: id, expectedEmployeeId: id, locationId: id, operationId: id, action: "clock_in", expectedSequence: 0 } });
const get = () => new Request(base + "?siteId=99990001&operationId=" + id);
const post = (value: unknown = body()) => new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: JSON.stringify(value) });
function setup(extra: Partial<typeof onsiteClockDependencies> = {}) {
  const calls: Parameters<typeof onsiteClockDependencies.execute>[0][] = [];
  const deps: typeof onsiteClockDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof onsiteClockDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { workerId: id, employeeId: id, locationId: id, state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false }; }, ...extra };
  return { deps, calls };
}
test("onsite clock gate/origin/method refuse before authentication", async () => {
  let auth = 0; const { deps } = setup({ authenticate: async () => { auth++; throw Error("unexpected"); } });
  assert.equal((await handleOnsiteClock(get(), { ...deps, enabled: () => false })).status, 404);
  assert.equal((await handleOnsiteClock(new Request(base, { method: "DELETE" }), deps)).status, 405);
  assert.equal((await handleOnsiteClock(new Request(get().url.replace("www.", "other.")), deps)).status, 403);
  assert.equal((await handleOnsiteClock(new Request(base, { method: "POST", headers: { Origin: "https://foreign.invalid" } }), deps)).status, 403);
  assert.equal(auth, 0);
});
for (const methods of [[], ["oauth"], ["magiclink"], ["password", "recovery"], ["invite"]]) test(`onsite clock rejects session ${methods}`, async () => {
  const { deps, calls } = setup({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
  assert.equal((await handleOnsiteClock(get(), deps)).status, 403); assert.equal((await handleOnsiteClock(post(), deps)).status, 403); assert.equal(calls.length, 0);
});
test("current authenticated employee and server admission passed for every call; recovery needs no QR", async () => {
  const { deps, calls } = setup();
  for (const request of [get(), post()]) { const result = await handleOnsiteClock(request, deps); assert.equal(result.status, 200); assert.match(result.headers.get("cache-control")!, /no-store/); assert.equal(result.headers.get("referrer-policy"), "no-referrer"); }
  assert.equal(calls.length, 2); assert(calls.every(i => i.authUserId === id && !i.allowNew));
  assert.deepEqual(calls[0], { siteId: "99990001", operationId: id, command: null, token: null, authUserId: id, allowNew: false });
  assert.equal(calls[1].command?.expectedEmployeeId, id); assert.equal(calls[1].operationId, null);
});
test("onsite QR only in POST body, strict authority and command fields, bounded body", async () => {
  const { deps, calls } = setup();
  for (const request of [new Request(get().url + "&token=secret"), new Request(get().url + "&siteId=99990001"), new Request(base + "?x=1", post()),
    post({ ...body(), authUserId: id }), post({ ...body(), allowNew: true }), post({ ...body(), command: null }), post({ ...body(), command: { ...body().command, source: "kiosk" } })])
    assert.equal((await handleOnsiteClock(request, deps)).status, 400);
  assert.equal((await handleOnsiteClock(post({ padding: "x".repeat(5000) }), deps)).status, 413);
  assert.equal((await handleOnsiteClock(new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com" }, body: "{}" }), deps)).status, 415); assert.equal(calls.length, 0);
});
test("onsite QR known errors and limits are explicit; unknown errors reveal no credentials", async () => {
  for (const code of ["attendance_qr_invalid", "attendance_qr_expired", "attendance_qr_used", "attendance_terminal_denied", "attendance_sequence_conflict"]) {
    const { deps } = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const result = await handleOnsiteClock(post(), deps); assert([400, 403, 409].includes(result.status)); assert.deepEqual(await result.json(), { ok: false, error: code });
  }
  const { deps } = setup({ execute: async () => { throw Error("private token"); } });
  const failed = await handleOnsiteClock(post(), deps); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, error: "attendance_unavailable" });
  const limited = await handleOnsiteClock(get(), { ...deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
});
