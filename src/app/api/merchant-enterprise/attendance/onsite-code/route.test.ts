import assert from "node:assert/strict";
import test from "node:test";
import { handleOnsiteCode, onsiteCodeDependencies, onsiteQrEnabled } from "./route-handler";
import { TERMINAL_COOKIE } from "@/lib/merchantAttendanceTerminal";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const base = "https://www.faolla.com/api/merchant-enterprise/attendance/onsite-code", terminalId = "00000000-0000-4000-8000-000000000070", secret = "A".repeat(43);
const cookie = `${TERMINAL_COOKIE}=99990001.${terminalId}.${secret}`;
const req = (body: unknown = {}, value = cookie) => new Request(base, { method: "POST", headers: { origin: "https://www.faolla.com", "content-type": "application/json", cookie: value }, body: JSON.stringify(body) });
const entitlement = async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof onsiteCodeDependencies.entitlement>>;
test("onsite channel requires all three explicit server flags", () => {
  const keys = ["FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_TERMINALS_ENABLED", "FAOLLA_ATTENDANCE_ONSITE_QR_ENABLED"];
  const prior = keys.map(k => process.env[k]);
  try { for (const k of keys) process.env[k] = "1"; assert.equal(onsiteQrEnabled(), true);
    for (const k of keys) { delete process.env[k]; assert.equal(onsiteQrEnabled(), false); process.env[k] = "1"; }
  } finally { keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); }
});
test("issuer rejects disabled, method, foreign origin, body authority and absent/duplicate device credentials", async () => {
  let calls = 0; const d = { enabled: () => true, allow: () => true, entitlement, execute: async () => { calls++; throw Error("unexpected"); } };
  assert.equal((await handleOnsiteCode(req(), { ...d, enabled: () => false })).status, 404);
  assert.equal((await handleOnsiteCode(new Request(base), d)).status, 405);
  assert.equal((await handleOnsiteCode(new Request(base.replace("www.", "foreign."), req()), d)).status, 403);
  for (const body of [{ siteId: "99990002" }, { expiresAtMs: 1 }, { verified: true }, { secret }, [], null]) assert.equal((await handleOnsiteCode(req(body), d)).status, 400);
  for (const value of ["", cookie + "; " + cookie, "session=owner", `${TERMINAL_COOKIE}=broken`]) assert.equal((await handleOnsiteCode(req({}, value), d)).status, 403);
  assert.equal(calls, 0);
});
test("issuer derives tenant from device only, retains paused finish access and never sets identity cookies", async () => {
  let calls = 0;
  const result = await handleOnsiteCode(req(), { enabled: () => true, allow: () => true, entitlement, execute: async input => {
    calls++; assert.deepEqual(input, { siteId: "99990001", terminalId, secret });
    return { siteId: input.siteId, terminalId, locationId: terminalId, token: "synthetic", issuedAtMs: 1, expiresAtMs: 45001 };
  } });
  assert.equal(calls, 1); assert.equal(result.status, 200); assert.equal((await result.json()).moduleEnabled, false);
  assert.equal(result.headers.get("cache-control"), "private, no-store"); assert.equal(result.headers.get("referrer-policy"), "no-referrer"); assert.equal(result.headers.get("set-cookie"), null);
});
test("issuer size/query/rate/entitlement and unknown failures are closed and redacted", async () => {
  const d = { enabled: () => true, allow: () => true, entitlement, execute: async () => { throw Error("private " + secret); } };
  assert.equal((await handleOnsiteCode(req({ padding: "x".repeat(5000) }), d)).status, 413);
  assert.equal((await handleOnsiteCode(new Request(base + "?token=secret", req()), d)).status, 400);
  const limited = await handleOnsiteCode(req(), { ...d, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal((await handleOnsiteCode(req(), { ...d, entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } })).status, 403);
  assert.equal((await handleOnsiteCode(req(), { ...d, execute: async () => { throw new MerchantAttendanceError("attendance_terminal_denied"); } })).status, 403);
  const result = await handleOnsiteCode(req(), d); assert.equal(result.status, 503); assert.deepEqual(await result.json(), { ok: false, error: "attendance_unavailable" });
});
