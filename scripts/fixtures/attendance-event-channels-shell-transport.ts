// Synthetic shell ONLY for the ownership-checked, isolated local attendance DB.
// No auth service, production endpoint, business mutation or arbitrary SQL/RPC
// is exposed. Attendance replies come from actual service-role migration RPCs.
import assert from "node:assert/strict";
import { getMissingMerchantEnterprisePermissionDependencies, isMerchantEnterpriseCollaborationPermission } from "../../src/lib/merchantEnterprise";
import { isMerchantStaffBusinessPermission } from "../../src/lib/merchantStaffBusiness";

export const siteNames = Object.freeze({ "99990001": "合成企业甲", "99990002": "合成企业乙" });
type SiteId = keyof typeof siteNames;
export type EventChannelsShellActor = Readonly<{ id: string; email: string }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const syntheticEmail = /^[^\s@]+@(?:[a-z0-9-]+\.)+test$/i;
const literal = (value: unknown) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
};
const isSite = (value: unknown): value is SiteId => typeof value === "string" && /^\d{8}$/.test(value) && Object.hasOwn(siteNames, value);
const rpcParameters = Object.freeze({
  faolla_attendance_self_v1: ["p_site_id", "p_auth_user_id", "p_command", "p_operation_id"],
  faolla_attendance_self_history_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_self_session_v1: ["p_site_id", "p_auth_user_id", "p_start_event_id"],
  faolla_attendance_self_context_v1: ["p_site_id", "p_auth_user_id"],
  faolla_attendance_correction_self_v3: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_platform_enabled"],
  faolla_attendance_scoped_period_report_v2: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_scoped_report_context_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_unified_report_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_event_channels_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_records_v1: ["p_site_id", "p_auth_user_id", "p_query"],
  faolla_attendance_choices_v1: ["p_site_id", "p_auth_user_id", "p_query"],
} satisfies Record<string, readonly string[]>);
export const eventChannelsShellRpcNames = Object.freeze(Object.keys(rpcParameters));
function validQuery(name: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const query = value as Record<string, unknown>;
  switch (name) {
    case "faolla_attendance_self_history_v1": return exact(query, ["fromAt", "toAt", "expectedWorkerId", "asOf", "cursorAt", "cursorId"]);
    case "faolla_attendance_correction_self_v3": return query.mode === "prepare" ? exact(query, ["mode", "expectedWorkerId", "startEventId"])
      : query.mode === "detail" ? exact(query, ["mode", "expectedWorkerId", "requestId", "operationId"])
        : query.mode === "list" && exact(query, ["mode", "expectedWorkerId", "cursorAt", "cursorId"]);
    case "faolla_attendance_scoped_period_report_v2": return exact(query, ["access", "fromDate", "throughDate", "workerId", "locationId", "expectedWorkerId"]);
    case "faolla_attendance_scoped_report_context_v1": return exact(query, ["access", "search", "cursor", "scopeRevision"]);
    case "faolla_attendance_unified_report_v1": return query.access === "owner" ? exact(query, ["access", "workerId", "fromDate", "throughDate"])
      : exact(query, ["access", "workerId", "locationId", "expectedWorkerId", "fromDate", "throughDate"]);
    case "faolla_attendance_event_channels_v1": return exact(query, ["access", "workerId", "locationId", "eventIds"]);
    case "faolla_attendance_records_v1": return exact(query, ["access", "fromAt", "toAt", "workerId", "locationId", "asOf", "cursorAt", "cursorId"]);
    case "faolla_attendance_choices_v1": return exact(query, ["kind", "search", "cursor"]) || exact(query, ["kind", "ids"]);
    default: return false;
  }
}
type Employee = {
  siteId: SiteId; id: string; displayName: string; email: string; roleId: string; roleName: string;
  employeeVersion: number; roleVersion: number; permissions: string[]; accessScope: "all" | "restricted"; allowedBoardIds: string[];
};
function employeeShape(value: unknown): value is Employee {
  if (!exact(value, ["siteId", "id", "displayName", "email", "roleId", "roleName", "employeeVersion", "roleVersion", "permissions", "accessScope", "allowedBoardIds"])) return false;
  return isSite(value.siteId) && typeof value.id === "string" && uuid.test(value.id)
    && typeof value.roleId === "string" && uuid.test(value.roleId)
    && typeof value.displayName === "string" && value.displayName.length > 0 && typeof value.roleName === "string"
    && typeof value.email === "string" && syntheticEmail.test(value.email)
    && Number.isSafeInteger(value.employeeVersion) && Number(value.employeeVersion) > 0
    && Number.isSafeInteger(value.roleVersion) && Number(value.roleVersion) > 0
    && Array.isArray(value.permissions) && value.permissions.every(permission => isMerchantEnterpriseCollaborationPermission(permission) || isMerchantStaffBusinessPermission(permission))
    && new Set(value.permissions).size === value.permissions.length && getMissingMerchantEnterprisePermissionDependencies(value.permissions).length === 0
    && value.permissions.includes("enterprise.view") && (value.accessScope === "all" || value.accessScope === "restricted")
    && Array.isArray(value.allowedBoardIds) && value.allowedBoardIds.every(board => typeof board === "string" && uuid.test(board));
}
const employeeJson = `jsonb_build_object('siteId',e.merchant_id,'id',e.id,'displayName',e.display_name,'email',e.email,
  'roleId',r.id,'roleName',r.name,'employeeVersion',e.version,'roleVersion',r.version,'permissions',r.permissions,
  'accessScope','all','allowedBoardIds','[]'::jsonb)`;
// The concurrency sandbox contains the initial employee/role DDL only. Board
// access is synthetic all/[] with an empty board snapshot, not a claim to test
// real board authorization. Attendance worker/location grant scopes stay real.
// The SQL permission validator is private to security-definer functions. Shell
// reads use service-role SELECT grants and validate dependencies with the actual
// application's pure validator, without granting/calling that private helper.
const activeMembership = `e.status='active' and r.status='active' and 'enterprise.view'=any(r.permissions)`;

export function createEventChannelsShellTransport(exec: (sql: string) => string, actors: readonly EventChannelsShellActor[]) {
  assert(Array.isArray(actors) && actors.length > 0, "event_channels_shell_synthetic_actors_required");
  const actorMap = new Map<string, EventChannelsShellActor>();
  for (const actor of actors) {
    assert(exact(actor, ["id", "email"]) && typeof actor.id === "string" && uuid.test(actor.id)
      && typeof actor.email === "string" && syntheticEmail.test(actor.email) && !actorMap.has(actor.id), "event_channels_shell_invalid_synthetic_actor");
    actorMap.set(actor.id, { id: actor.id, email: actor.email });
  }
  const state = { moduleEnabled: true };
  const calls: { name: string; actor: string; siteId: string; operationId: string | null; command: null; query: unknown }[] = [];
  const shellCalls: { path: string; method: string; actor: string; siteId: string | null }[] = [];
  const errors: string[] = [];
  const read = (expression: string): unknown => {
    // Standard string literals make quoted query values safe even if the
    // fixture connection inherited a nondefault backslash setting.
    const result = JSON.parse(exec(`set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',${expression});`));
    assert(exact(result, ["role", "data"]) && result.role === "service_role", "event_channels_shell_wrong_database_role");
    return result.data;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    assert(Object.hasOwn(rpcParameters, name), "event_channels_shell_unexpected_rpc");
    const fields = rpcParameters[name as keyof typeof rpcParameters];
    assert(exact(args, fields), "event_channels_shell_invalid_rpc_arguments");
    assert(isSite(args.p_site_id) && typeof args.p_auth_user_id === "string" && actorMap.has(args.p_auth_user_id), "event_channels_shell_rpc_scope_denied");
    if (Object.hasOwn(args, "p_command")) assert.equal(args.p_command, null, "event_channels_shell_business_write_denied");
    if (Object.hasOwn(args, "p_operation_id")) assert(args.p_operation_id === null || typeof args.p_operation_id === "string" && uuid.test(args.p_operation_id), "event_channels_shell_invalid_operation");
    if (Object.hasOwn(args, "p_start_event_id")) assert(typeof args.p_start_event_id === "string" && uuid.test(args.p_start_event_id), "event_channels_shell_invalid_event");
    if (Object.hasOwn(args, "p_platform_enabled")) assert.equal(typeof args.p_platform_enabled, "boolean", "event_channels_shell_invalid_platform_flag");
    if (Object.hasOwn(args, "p_query")) assert(validQuery(name, args.p_query), "event_channels_shell_invalid_query");
    const params = fields.map(field => field === "p_query" ? literal(JSON.stringify(args[field])) + "::jsonb"
      : field === "p_platform_enabled" ? String(args[field]) : literal(args[field]));
    calls.push({ name, actor: args.p_auth_user_id, siteId: args.p_site_id, operationId: args.p_operation_id as string | null ?? null, command: null, query: args.p_query ?? null });
    try { return { data: read(`public.${name}(${params.join(",")})`), error: null }; }
    catch (error) {
      const code = String(error).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1];
      if (code) return { data: null, error: { message: code } };
      errors.push(String(error).slice(0, 1600)); throw error;
    }
  };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  const deny = (status = 403, error = "merchant_employee_access_denied") => reply({ ok: false, error }, status);
  const serveShell = async (request: Request, authUserId: string) => {
    const identity = actorMap.get(authUserId);
    if (!identity) return deny();
    const url = new URL(request.url), path = url.pathname;
    if (!["/api/merchant-enterprise/memberships", "/api/merchant-enterprise/employees/accept", "/api/merchant-business/capabilities", "/api/merchant-enterprise/overview"].includes(path))
      return deny(404, "event_channels_shell_unknown_endpoint");
    const accepting = path === "/api/merchant-enterprise/employees/accept", memberships = path === "/api/merchant-enterprise/memberships";
    if (request.method !== (accepting ? "POST" : "GET")) return deny(405, "event_channels_shell_read_only");
    let siteId: SiteId | null = null;
    if (memberships || accepting) {
      if ([...url.searchParams].length !== 0) return deny(400, "event_channels_shell_invalid_query");
    } else {
      if ([...url.searchParams].length !== 1 || !url.searchParams.has("siteId") || !isSite(url.searchParams.get("siteId")))
        return deny(400, "event_channels_shell_invalid_site");
      siteId = url.searchParams.get("siteId") as SiteId;
    }
    if (accepting) {
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return deny(415, "event_channels_shell_invalid_content_type");
      try {
        const text = await request.text();
        if (Buffer.byteLength(text, "utf8") > 512) return deny(413, "event_channels_shell_body_too_large");
        const body: unknown = JSON.parse(text);
        if (!exact(body, ["siteId"]) || !isSite(body.siteId)) return deny(400, "event_channels_shell_invalid_site");
        siteId = body.siteId;
      } catch { return deny(400, "event_channels_shell_invalid_request"); }
    }
    shellCalls.push({ path, method: request.method, actor: authUserId, siteId });
    if (memberships) {
      const rows = read(`(select coalesce(jsonb_agg(member order by member->>'siteId'),'[]'::jsonb) from
        (select ${employeeJson} as member from public.merchant_enterprise_employees e
          join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
          where e.merchant_id in ('99990001','99990002') and e.auth_user_id=${literal(authUserId)} and ${activeMembership}) current_memberships)`);
      assert(Array.isArray(rows), "event_channels_shell_invalid_memberships_result");
      return reply({ ok: true, memberships: rows.filter(employeeShape).map(employee => ({ siteId: employee.siteId, siteName: siteNames[employee.siteId],
        employeeId: employee.id, displayName: employee.displayName, roleId: employee.roleId, roleName: employee.roleName, status: "active", enterable: true })) });
    }
    assert(siteId !== null);
    const current = read(`jsonb_build_object('owner',exists(select 1 from public.merchants where id=${literal(siteId)} and user_id=${literal(authUserId)}),
      'employee',(select ${employeeJson} from public.merchant_enterprise_employees e
        join public.merchant_enterprise_roles r on r.merchant_id=e.merchant_id and r.id=e.role_id
        where e.merchant_id=${literal(siteId)} and e.auth_user_id=${literal(authUserId)} and ${activeMembership}))`);
    assert(exact(current, ["owner", "employee"]) && typeof current.owner === "boolean", "event_channels_shell_invalid_current_membership");
    const employee = employeeShape(current.employee) ? current.employee : null;
    assert(employee === null || employee.siteId === siteId, "event_channels_shell_foreign_membership");
    // Acceptance is a synthetic acknowledgment of a CURRENT active membership,
    // never invitation acceptance, status promotion, or a write to the database.
    if (accepting) return employee ? reply({ ok: true }) : deny();
    if (path === "/api/merchant-business/capabilities") {
      if (!employee) return deny();
      const authorizationVersion = `${employee.employeeVersion}:${employee.roleVersion}`;
      return reply({ ok: true, schemaVersion: 1, actor: { type: "employee", displayName: employee.displayName,
        principalKey: `employee:${employee.id}`, authorizationVersion },
      cacheNamespace: `event-channels-shell:${siteId}:${employee.id}:${employee.roleId}:${authorizationVersion}`,
      collaborationPermissions: employee.permissions.filter(isMerchantEnterpriseCollaborationPermission),
      permissions: employee.permissions.filter(isMerchantStaffBusinessPermission), workspace: { siteId, siteName: siteNames[siteId], siteCountryCode: "ES" } });
    }
    if (!current.owner && !employee) return deny();
    const actor = current.owner ? { type: "owner", id: authUserId, siteId, displayName: "合成负责人", email: identity.email,
      permissions: [], accessScope: "all", allowedBoardIds: [] } : { type: "employee", id: employee!.id, siteId,
      displayName: employee!.displayName, email: employee!.email, roleId: employee!.roleId, permissions: employee!.permissions,
      accessScope: employee!.accessScope, allowedBoardIds: employee!.allowedBoardIds };
    return reply({ ok: true, actor, needsBootstrap: current.owner, snapshot: { roles: [], employees: [], boards: [], columns: [], tasks: [] } });
  };
  return { state, calls, errors, shellCalls, siteNames, rpc, serveShell };
}
