import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { updateMerchantEnterpriseEmployee, type MerchantEnterpriseStoreClient } from "./merchantEnterpriseStore.server";
import { getMerchantEnterpriseEmployeeMutationErrorResponse, PATCH } from "../app/api/merchant-enterprise/employees/route-handler";
import { accountSuspensionId as id } from "../../scripts/fixtures/attendance-account-suspension-model";
const base = { siteId: "99990001", employeeId: id(2), actorId: id(1), actorType: "owner" as const, version: 1, status: "disabled" as const, offboardingMode: "unassign" as const };
function fixture() { const calls: Record<string, unknown>[] = []; const store = { from() { throw Error("unexpected table access"); }, rpc: async (name: string, args: Record<string, unknown>) => {
  assert.equal(name, "faolla_update_merchant_enterprise_employee_v1"); calls.push(args.p_input as Record<string, unknown>); return { error: null, data: { employee: { id: id(2), merchant_id: "99990001", auth_user_id: id(3), email: "synthetic@example.invalid", display_name: "合成", role_id: id(4), status: "disabled",
    invited_at: "2026-10-06T09:00:00.000Z", accepted_at: "2026-10-06T09:01:00.000Z", last_active_at: null, invitation_version: 1, invitation_expires_at: null, invitation_revoked_at: null, invitation_sent_at: null, invitation_delivery_status: "sent", version: 2, created_at: "2026-10-06T09:00:00.000Z", updated_at: "2026-10-06T10:00:00.000Z" } } }; } } as unknown as MerchantEnterpriseStoreClient; return { store, calls }; }
test("old flag-off/no-op Store bytes stay exact; server flag or original operation are the only opt-ins", async t => {
  const saved = process.env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED;
  t.after(() => { if (saved === undefined) delete process.env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED; else process.env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED = saved; });
  const original = { merchant_id: "99990001", employee_id: id(2), expected_version: 1, actor_type: "owner", actor_id: id(1), status: "disabled", offboarding_mode: "unassign" };
  for (const value of [undefined, "true", " 1", "1\n", "1"]) { if (value === undefined) delete process.env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED; else process.env.FAOLLA_ATTENDANCE_ACCOUNT_SUSPENSION_ENABLED = value;
    const f = fixture(); await updateMerchantEnterpriseEmployee(f.store, base); assert.deepEqual(f.calls, [{ ...original, ...(value === "1" ? { attendance_suspension_enabled: true } : {}) }]);
    await updateMerchantEnterpriseEmployee(f.store, { ...base, operationId: id(20) }); assert.deepEqual(f.calls[1], { ...original, attendance_operation_id: id(20), attendance_suspension_enabled: value === "1" }); }
});
test("original operation does not expand profile/role/invitation writes and is validated before RPC", async () => {
  const f = fixture(); for (const patch of [{ operationId: "text" }, { operationId: id(20), displayName: "mixed" }, { operationId: id(20), status: "invited" as const, offboardingMode: undefined }, { operationId: id(20), roleId: id(7), roleVersion: 1 }]) await assert.rejects(updateMerchantEnterpriseEmployee(f.store, { ...base, ...patch })); assert.equal(f.calls.length, 0);
});
test("old employee route rejects operation authority/profile injection before authorization and retains version preflight", async () => {
  const headers = { origin: "https://www.faolla.com", "content-type": "application/json", "sec-fetch-site": "same-origin" };
  for (const patch of [{ operationId: "text" }, { operationId: id(20), roleId: id(9) }, { operationId: id(20), attendance_suspension_enabled: true }, { operationId: id(20), status: "invited" }]) {
    const r = await PATCH(new Request("https://www.faolla.com/api/merchant-enterprise/employees", { method: "PATCH", headers, body: JSON.stringify({ siteId: base.siteId, employeeId: base.employeeId, version: 1, status: "active", ...patch }) })); assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_employee_update"); }
  const source = readFileSync(new URL("../app/api/merchant-enterprise/employees/route-handler.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("currentEmployee.version !== body.version") < source.lastIndexOf("const employee = await updateMerchantEnterpriseEmployee"));
  for (const [code, status] of [["attendance_account_suspension_invalid", 503], ["attendance_account_suspension_changed", 409], ["attendance_account_suspended", 409], ["attendance_operation_conflict", 409]] as const) assert.equal(getMerchantEnterpriseEmployeeMutationErrorResponse(Error(code))?.status, status);
});
