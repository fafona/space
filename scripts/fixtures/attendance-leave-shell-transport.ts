// Local synthetic shell only. The caller must provide the ownership-checked
// namespace exec from prepareLeaveNotificationsNativeFixture. Importing or
// constructing this adapter starts no service and performs no SQL.
import assert from "node:assert/strict";
import { parseLeaveBody, parseLeaveQuery } from "../../src/lib/merchantAttendanceLeave";
import { parseNotificationBody, parseNotificationQuery } from "../../src/lib/merchantAttendanceLeaveNotifications";
import { createAttendanceDatabaseTransport, databaseActors } from "./attendance-database-transport";

const site = "99990001";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const actorIds = new Set(databaseActors.map(actor => actor.id));
const rpcParameters = Object.freeze({
  faolla_attendance_self_v1: ["p_site_id", "p_auth_user_id", "p_command", "p_operation_id"],
  faolla_attendance_admin_v1: ["p_site_id", "p_auth_user_id", "p_query", "p_command", "p_operation_id"],
  faolla_attendance_leave_v1: ["p_query", "p_auth_user_id", "p_command", "p_allow_write"],
  faolla_attendance_leave_notify_v1: ["p_query", "p_auth_user_id", "p_command", "p_allow_write"],
  faolla_attendance_leave_notifications_v1: ["p_query", "p_auth_user_id", "p_command", "p_allow_write"],
} satisfies Record<string, readonly string[]>);
export const leaveShellRpcNames = Object.freeze(Object.keys(rpcParameters));
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const literal = (value: unknown) => value === null ? "null" : "'" + String(value).replaceAll("'", "''") + "'";
const json = (value: unknown) => value === null ? "null" : literal(JSON.stringify(value)) + "::jsonb";
const nullableUuid = (value: unknown) => value === null || typeof value === "string" && uuid.test(value);
type Call = { name: string; actor: string; siteId: string; action: string | null; operationId: string | null };

export function createAttendanceLeaveShellTransport(exec: (sql: string) => string) {
  assert.equal(typeof exec, "function", "leave_shell_owned_exec_required");
  const base = createAttendanceDatabaseTransport(exec);
  const calls: Call[] = [], errors: string[] = [];
  const rpc = async (name: string, args: Record<string, unknown>) => {
    assert(Object.hasOwn(rpcParameters, name), "leave_shell_unexpected_rpc");
    const fields = rpcParameters[name as keyof typeof rpcParameters];
    assert(exact(args, fields), "leave_shell_invalid_rpc_arguments");
    assert(typeof args.p_auth_user_id === "string" && actorIds.has(args.p_auth_user_id), "leave_shell_actor_denied");
    let action: string | null = null, operationId: string | null = null;
    if (name === "faolla_attendance_self_v1" || name === "faolla_attendance_admin_v1") {
      assert.equal(args.p_site_id, site, "leave_shell_site_denied");
      assert.equal(args.p_command, null, "leave_shell_non_leave_write_denied");
      assert(nullableUuid(args.p_operation_id), "leave_shell_invalid_operation");
      operationId = args.p_operation_id as string | null;
      if (name === "faolla_attendance_admin_v1") {
        const query = args.p_query;
        assert(exact(query, ["view", "cursor", "search"]), "leave_shell_invalid_admin_query");
        assert(["settings", "locations", "workers", "employees"].includes(String(query.view))
          && nullableUuid(query.cursor) && typeof query.search === "string" && query.search.length <= 80
          && query.search === query.search.trim() && !/[\u0000-\u001f\u007f]/.test(query.search), "leave_shell_invalid_admin_query");
      }
    } else {
      assert.equal(typeof args.p_allow_write, "boolean", "leave_shell_invalid_write_flag");
      if (name === "faolla_attendance_leave_notifications_v1") {
        const query = parseNotificationQuery(args.p_query);
        assert.equal(query.siteId, site, "leave_shell_site_denied");
        if (args.p_command !== null) action = parseNotificationBody({ query, command: args.p_command }).command.action;
      } else {
        const query = parseLeaveQuery(args.p_query);
        assert.equal(query.siteId, site, "leave_shell_site_denied");
        if (args.p_command !== null) {
          const command = parseLeaveBody({ query, command: args.p_command }).command;
          action = command.action; operationId = command.operationId;
          assert(name === "faolla_attendance_leave_notify_v1"
            ? ["approve", "reject", "cancel"].includes(action) : ["submit", "withdraw"].includes(action), "leave_shell_writer_mismatch");
        } else assert.notEqual(name, "faolla_attendance_leave_notify_v1", "leave_shell_capture_command_required");
      }
    }
    const params = fields.map(field => field === "p_query" || field === "p_command" ? json(args[field])
      : field === "p_allow_write" ? String(args[field]) : literal(args[field]));
    // Diagnostics contain only fixed protocol identifiers and synthetic IDs.
    // Never retain commands, free-text reasons, credentials or raw SQL errors.
    calls.push({ name, actor: args.p_auth_user_id, siteId: site, action, operationId });
    try {
      const result: unknown = JSON.parse(exec(`set local standard_conforming_strings=on;set local role service_role;select jsonb_build_object('role',current_user,'data',public.${name}(${params.join(",")}));`));
      assert(exact(result, ["role", "data"]) && result.role === "service_role", "leave_shell_wrong_database_role");
      return { data: result.data, error: null };
    } catch (error) {
      const code = String(error).match(/ERROR:\s+(attendance_[a-z_]+)(?=\r?\n|$)/)?.[1];
      if (code) return { data: null, error: { message: code } };
      errors.push("leave_shell_rpc_failed"); throw Error("leave_shell_rpc_failed");
    }
  };
  const serveShell = async (request: Request, authUserId: string) => {
    assert(actorIds.has(authUserId), "leave_shell_actor_denied");
    const url = new URL(request.url), accepting = url.pathname === "/api/merchant-enterprise/employees/accept";
    assert(["/api/merchant-enterprise/memberships", "/api/merchant-enterprise/employees/accept", "/api/merchant-business/capabilities", "/api/merchant-enterprise/overview"].includes(url.pathname), "leave_shell_unknown_endpoint");
    assert.equal(request.method, accepting ? "POST" : "GET", "leave_shell_method_denied");
    if (accepting || url.pathname.endsWith("/memberships")) assert.equal([...url.searchParams].length, 0, "leave_shell_invalid_query");
    else assert([...url.searchParams].length === 1 && url.searchParams.get("siteId") === site, "leave_shell_site_denied");
    if (accepting) {
      const body: unknown = await request.clone().json();
      assert(exact(body, ["siteId"]) && body.siteId === site, "leave_shell_invalid_acceptance");
    }
    if (url.pathname === "/api/merchant-business/capabilities" && authUserId === databaseActors[0].id) {
      // Only the employee portal needs this synthetic outer capability read.
      // Do not reinterpret the owner's separate employee membership as owner
      // business authorization or simulate an enabled business rollout.
      const currentOwner = exec(`select count(*) from public.merchants where id='${site}' and user_id=${literal(authUserId)};`) === "1";
      return Response.json({ ok: false, error: currentOwner ? "synthetic_owner_business_out_of_scope" : "merchant_employee_access_denied" }, { status: 403 });
    }
    return base.serveShell(request, authUserId);
  };
  return { state: base.state, rpc, serveShell, calls, errors };
}
