//Synthetic RPC response checks only; not PostgreSQL, real Auth or family use.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { executeManagementDelegation, managementDelegationSiteEnabled, MANAGEMENT_DELEGATION_RPC } from "./merchantAttendanceManagementDelegation.server";
import { MANAGEMENT_DELEGATION_PROTOCOL, managementDelegationFingerprintText, managementDelegationQueryString, parseManagementDelegationHttpQuery,
  type ManagementDelegationQuery, type ManagementDelegationCommand, type ManagementDelegationGrantCommand } from "./merchantAttendanceManagementDelegation";
import { DEFAULT_MERCHANT_ENTERPRISE_ROLES, MERCHANT_ENTERPRISE_PERMISSIONS, MERCHANT_ENTERPRISE_PERMISSION_CATALOG,
  normalizeMerchantEnterprisePermissions, normalizeMerchantEnterpriseRole, getMissingMerchantEnterprisePermissionDependencies,
  toggleMerchantEnterprisePermissionSelection, hasMerchantEnterprisePermission, type MerchantEnterpriseActor } from "./merchantEnterprise";
import { MANAGEMENT_DELEGATION_CAPABILITIES } from "./merchantAttendanceManagementDelegation";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
const id = (n: number) => `20200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990202", actor = id(1), at = "2026-10-08T12:00:00.000001Z";
const query: ManagementDelegationQuery = { siteId, mode: "write" };
const command: ManagementDelegationGrantCommand = { action: "grant", operationId: id(2), delegateEmployeeId: id(3), delegateAuthUserId: id(4),
  delegatedAction: "audit_view", scope: { kind: "audit_company", sources: ["config"] }, validFrom: at, validUntil: "2026-10-09T12:00:00.000001Z", reason: "合成限定审计授权" };
function receipt(c: ManagementDelegationCommand = command) { return { protocol: MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "receipt", receipt: {
  operationId: c.operationId, actorId: actor, action: c.action, grantId: c.action === "grant" ? c.operationId : c.grantId, revision: c.action === "grant" ? 1 : 2,
  commandFingerprint: createHash("sha256").update(managementDelegationFingerprintText(siteId, actor, c)).digest("hex"), recordedAt: at } }; }
test("202 fourteen role flags are explicit, independently selectable, enterprise-only dependent and absent from all old/default system roles", () => {
  const old = ["enterprise.view", "roles.view"] as const;
  assert.deepEqual(normalizeMerchantEnterprisePermissions(old), old);
  const row = normalizeMerchantEnterpriseRole({ id: id(80), merchant_id: siteId, name: "原系统管理员", permissions: [...old], status: "active", is_system: true, version: 1 });
  assert(row); assert.deepEqual(row.permissions, old); assert.equal(row.isSystem, true);
  const employee = { type: "employee", permissions: [...old] } as MerchantEnterpriseActor;
  for (const permission of MANAGEMENT_DELEGATION_CAPABILITIES) {
    assert(MERCHANT_ENTERPRISE_PERMISSIONS.includes(permission)); assert.equal(MERCHANT_ENTERPRISE_PERMISSION_CATALOG.filter(v => v.key === permission).length, 1);
    for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) assert(!role.permissions.includes(permission));
    assert.equal(hasMerchantEnterprisePermission(employee, permission), false);
    assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies([permission]), ["enterprise.view"]);
    const selected = toggleMerchantEnterprisePermissionSelection([], permission, true);
    assert.deepEqual(new Set(selected), new Set(["enterprise.view", permission]));
    assert.deepEqual(toggleMerchantEnterprisePermissionSelection(selected, "enterprise.view", false), []);
  }
});
test("202 gate is default-off and exact64 sites, no wildcard/duplicate/whitespace/substrings", () => {
  const env = { FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED: "1", FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_SITE_IDS: siteId };
  assert(managementDelegationSiteEnabled(siteId, env));
  for (const value of ["", "*", " " + siteId, siteId + "\n", siteId + ",", siteId + "," + siteId, Array.from({ length: 65 }, (_, i) => String(99990000 + i)).join(",")])
    assert.equal(managementDelegationSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_SITE_IDS: value }), false);
  assert.equal(managementDelegationSiteEnabled(siteId, {}), false);
  assert.equal(managementDelegationSiteEnabled(siteId, { ...env, FAOLLA_ATTENDANCE_MANAGEMENT_DELEGATIONS_ENABLED: "true" }), false);
  assert.equal(managementDelegationSiteEnabled(siteId.slice(1), env), false);
});
test("202 HTTP query round trips only exact read/recovery fields; cannot GET-dispatch a write", () => {
  const reads: ManagementDelegationQuery[] = [{ siteId, mode: "list", state: "all", afterId: null, delegatedAction: null }, { siteId, mode: "detail", grantId: id(2) },
    { siteId, mode: "recover", operationId: id(2) }];
  for (const q of reads) assert.deepEqual(parseManagementDelegationHttpQuery("https://www.faolla.com/x?" + managementDelegationQueryString(q)), q);
  for (const suffix of ["siteId=" + siteId + "&mode=write", managementDelegationQueryString(reads[0]) + "&siteId=" + siteId,
    managementDelegationQueryString(reads[0]) + "&allowGrant=true", managementDelegationQueryString(reads[0]) + "#private"])
    assert.throws(() => parseManagementDelegationHttpQuery("https://www.faolla.com/x?" + suffix));
});
test("202 service issues exactly one actual-actor RPC, even flag-off saved grant/revoke/recover, with no permission or artifact pregate", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: receipt(args.p_command === null ? command : args.p_command as ManagementDelegationCommand), error: null }; } };
  await executeManagementDelegation({ query, command, authUserId: actor }, service);
  assert.deepEqual(calls, [{ name: MANAGEMENT_DELEGATION_RPC, args: { p_query: query, p_auth_user_id: actor, p_command: command, p_allow_grant: false } }]);
  const recover: ManagementDelegationQuery = { siteId, mode: "recover", operationId: command.operationId };
  await executeManagementDelegation({ query: recover, authUserId: actor }, service); assert.equal(calls.length, 2); assert.equal(calls[1].args.p_command, null);
  const revoke: ManagementDelegationCommand = { action: "revoke", operationId: id(9), grantId: command.operationId, expectedRevision: 1, reason: "合成撤销" };
  await executeManagementDelegation({ query, command: revoke, authUserId: actor }, service); assert.equal(calls.length, 3); assert.equal(calls[2].args.p_allow_grant, false);
  assert.doesNotMatch(JSON.stringify(calls), /"(?:currentOwner|permissions?|source|authority|executor|pin|verifier|salt)"\s*:/);
});
test("202 service fails closed on hostile result/flag mismatch and does not retry unknown or known SQL failure", async () => {
  for (const data of [{ ...receipt(), private: "secret" }, { ...receipt(), actorId: id(90) }, { ...receipt(), receipt: { ...receipt().receipt, commandFingerprint: "0".repeat(64) } },
    { protocol: MANAGEMENT_DELEGATION_PROTOCOL, siteId, actorId: actor, readAt: at, kind: "list", items: [], nextId: null, canGrant: true }]) {
    const q: ManagementDelegationQuery = "items" in data ? { siteId, mode: "list", state: "all", afterId: null, delegatedAction: null } : query;
    await assert.rejects(executeManagementDelegation({ query: q, command: q.mode === "write" ? command : null, authUserId: actor },
      { rpc: async () => ({ data, error: null }) }), { code: "attendance_management_delegation_invalid" });
  }
  for (const message of ["attendance_operation_conflict", "attendance_access_denied", "private SQL internals"]) {
    let calls = 0; await assert.rejects(executeManagementDelegation({ query, command, authUserId: actor }, { rpc: async () => {
      calls++; return { data: null, error: { message } }; } }), { code: message.startsWith("private") ? "attendance_unavailable" : message }); assert.equal(calls, 1);
  }
  let calls = 0; await assert.rejects(executeManagementDelegation({ query, command, authUserId: actor }, { rpc: async () => {
    calls++; throw Error("unknown commit"); } }), { code: "attendance_unavailable" }); assert.equal(calls, 1);
});
test("202 aborted/late RPC cannot dispatch again or return projected success", async () => {
  let calls = 0; const controller = new AbortController(), service: AttendanceSelfRpc = { rpc: async () => { calls++; controller.abort(); return { data: receipt(), error: null }; } };
  await assert.rejects(executeManagementDelegation({ query, command, authUserId: actor, signal: controller.signal }, service), { code: "attendance_unavailable" });
  assert.equal(calls, 1);
  await assert.rejects(executeManagementDelegation({ query, command, authUserId: actor, signal: controller.signal }, service), { code: "attendance_unavailable" }); assert.equal(calls, 1);
});
