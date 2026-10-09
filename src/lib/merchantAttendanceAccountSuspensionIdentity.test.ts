import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as enterprise from "./merchantEnterprise";
import * as nextServer from "next/server";
import * as attendanceEntitlement from "./merchantAttendanceEntitlement";
import { accountSuspensionId as id } from "../../scripts/fixtures/attendance-account-suspension-model";

// Execute the unchanged exported functions with only their external I/O ports
// replaced; this is a pure unit harness, not a Supabase/DB runtime.
function load<T>(relative: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8"), compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, sandboxModule = { exports };
  runInNewContext(compiled, { exports, module: sandboxModule, Request, Response, URL, Promise, Error, Set, Array, Object, console,
    process: { env: {} },
    require: (name: string) => { assert(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; } });
  return sandboxModule.exports as T;
}
const siteId = "99990001", authId = id(1), employeeId = id(2), roleId = id(3);
const employeeRow = { id: employeeId, merchant_id: siteId, auth_user_id: authId, email: "synthetic@example.invalid", display_name: "Synthetic employee", role_id: roleId,
  status: "active", version: 1, invited_at: "2026-10-06T08:00:00.000Z", accepted_at: "2026-10-06T08:01:00.000Z", last_active_at: null,
  created_at: "2026-10-06T08:00:00.000Z", updated_at: "2026-10-06T08:01:00.000Z" };
function authFixture(options: { owner?: boolean; methods?: string[]; missingEmployee?: boolean; missingRole?: boolean; deniedEntitlement?: boolean; badSubject?: boolean; permissions?: string[] } = {}) {
  const calls: string[] = [];
  const service = { from(table: string) { calls.push(table); const value = table === "merchants" ? options.owner ? { id: siteId, name: "Synthetic owner" } : null
    : table === "merchant_enterprise_employees" ? options.missingEmployee ? null : employeeRow
    : options.missingRole ? null : { id: roleId, merchant_id: siteId, name: "Synthetic role", description: "", permissions: options.permissions ?? ["enterprise.view"], access_scope: "all", status: "active", is_system: false, version: 1, created_at: employeeRow.created_at, updated_at: employeeRow.updated_at };
    const builder = { select() { return builder; }, eq() { return builder; }, or() { return builder; }, limit() { return builder; }, async maybeSingle() { return { data: value, error: null }; } }; return builder; } };
  const auth = load<typeof import("./merchantEnterpriseAuth.server")>("./merchantEnterpriseAuth.server.ts", {
    "@/lib/merchantEnterprise": enterprise, "@/lib/merchantAuthSession": { readMerchantRequestAccessTokens: () => ["synthetic"] },
    "@/lib/publishedMerchantService": { loadAuthoritativeCurrentMerchantSnapshotSites: async () => [{ id: siteId, permissionConfig: { allowEnterpriseManagement: !options.deniedEntitlement } }] },
    "@/lib/superAdminServer": { createServerSupabaseServiceClient: () => service, createServerSupabaseAuthClient: () => ({ auth: {
      getClaims: async () => ({ data: { claims: { sub: options.badSubject ? id(99) : authId, amr: options.methods ?? ["password"] } }, error: null }),
      getUser: async () => ({ data: { user: { id: authId, email: "actor@example.invalid" } }, error: null }),
    } }) },
  }); return { auth, calls };
}
test("authorized Auth observer reports real Auth for owner/employee only after all original gates, with no default actor change", async () => {
  for (const owner of [true, false]) { const f = authFixture({ owner }), observed: string[] = [];
    const actor = await f.auth.resolveMerchantEnterpriseActor(new Request("https://www.faolla.com/test"), { siteId, requiredPermission: "enterprise.view", onAuthorizedAuthUserId: auth => { observed.push(auth); assert.equal(f.calls.at(-1), owner ? "merchants" : "merchant_enterprise_roles"); } });
    assert.deepEqual(observed, [authId]); assert.equal(actor.id, owner ? authId : employeeId);
    const legacy = await f.auth.resolveMerchantEnterpriseActor(new Request("https://www.faolla.com/test"), { siteId, requiredPermission: "enterprise.view" }); assert.equal(JSON.stringify(legacy), JSON.stringify(actor));
  }
});
test("bad signed subject, entitlement, password, membership, role and requested permission never emit caller Auth", async () => {
  for (const options of [{ badSubject: true }, { deniedEntitlement: true }, { methods: ["magiclink"] }, { missingEmployee: true }, { missingRole: true }, { permissions: [] }]) {
    const f = authFixture(options); let emitted = false;
    await assert.rejects(f.auth.resolveMerchantEnterpriseActor(new Request("https://www.faolla.com/test"), { siteId, requiredPermission: "enterprise.view", onAuthorizedAuthUserId: () => { emitted = true; } })); assert.equal(emitted, false);
  }
});
test("overview sends only verified currentAuthUserId separately and keeps all employee Auth fields redacted", async () => {
  const actor: enterprise.MerchantEnterpriseActor = { type: "employee", id: employeeId, siteId, displayName: "Synthetic", email: "actor@example.invalid", roleId,
    permissions: ["enterprise.view", "employees.view"], accessScope: "all", allowedBoardIds: [] };
  const employee = enterprise.normalizeMerchantEnterpriseEmployee(employeeRow)!;
  const snapshot: enterprise.MerchantEnterpriseSnapshot = { roles: [], boards: [], columns: [], tasks: [], employees: [employee, { ...employee, id: id(8), authUserId: id(9) }] };
  let authenticated = 0;
  const route = load<typeof import("../app/api/merchant-enterprise/overview/route-handler")>("../app/api/merchant-enterprise/overview/route-handler.ts", {
    "next/server": nextServer, "@/lib/merchantEnterprise": enterprise,
    "@/lib/merchantAttendanceEntitlement": attendanceEntitlement,
    "@/lib/merchantEnterpriseAuth.server": { resolveMerchantEnterpriseActor: async (_request: Request, input: { requiredPermission: string; onAuthorizedAuthUserId?: (id: string) => void }) => { assert.equal(input.requiredPermission, "enterprise.view"); authenticated++; input.onAuthorizedAuthUserId?.(authId); return actor; }, requireMerchantEnterpriseEntitlement: async () => ({}), requireMerchantEnterpriseAllBoardAccess: () => {}, toMerchantEnterpriseAccessResponse: () => ({ body: { ok: false }, status: 503 }) },
    "@/lib/merchantEnterpriseStore.server": { loadMerchantEnterpriseSnapshot: async () => snapshot, merchantEnterpriseWorkspaceNeedsBootstrap: async () => false },
    "@/lib/merchantIdentity": { isMerchantNumericId: (v: string) => /^\d{8}$/.test(v) }, "@/lib/mutationOperationId": {}, "@/lib/requestMutationGuard": {}, "@/lib/superAdminServer": { createServerSupabaseServiceClient: () => ({}) },
  });
  const response = await route.GET(new Request(`https://www.faolla.com/api/merchant-enterprise/overview?siteId=${siteId}&currentAuthUserId=${id(99)}`));
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.currentAuthUserId, authId); assert.equal(authenticated, 1); assert.equal(body.actor.id, employeeId);
  assert.deepEqual(body.snapshot.employees.map((e: { authUserId: string }) => e.authUserId), ["", ""]);
  assert.equal(body.attendanceEnabled, false);
});
test("manager synchronizes current Auth with the same request epoch and clears it with actor or explicit authorization denial", () => {
  const source = readFileSync(new URL("../components/admin/MerchantEnterpriseManager.tsx", import.meta.url), "utf8");
  const load = source.slice(source.indexOf("const loadOverview = useCallback"), source.indexOf("const refreshOverview = useCallback"));
  assert.match(load, /setActor\(payload.actor\);\s*setCurrentAuthUserId\(typeof payload.currentAuthUserId === "string" \? payload.currentAuthUserId : null\)/);
  assert.equal((load.match(/setActor\(null\);\s*setAttendanceAdmission\(null\);\s*setCurrentAuthUserId\(null\)/g) ?? []).length, 2);
  assert.ok(load.indexOf("requestSequence !== overviewRequestSequenceRef.current", load.indexOf("await response.json")) < load.indexOf("setCurrentAuthUserId(typeof payload"));
  assert.match(load, /accountStatusScope.current.accountStatusAuthId = "";\s*periodDelegationScope.current.token\+\+;\s*setCurrentAuthUserId\(null\);\s*onAuthorizationInvalid/);
  assert.doesNotMatch(source, /snapshot\.employees\.find\(employee => employee\.id === actor\.id\)\?\.authUserId/);
});
