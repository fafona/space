import assert from "node:assert/strict";
import test from "node:test";
import { createAttendanceLeaveShellTransport, leaveShellRpcNames } from "./attendance-leave-shell-transport";
import { databaseActors, databaseId as id } from "./attendance-database-transport";

const site = "99990001", employee = databaseActors[1].id, owner = databaseActors[0].id;
const leave = (access = "self", requestId: string | null = null) => ({ siteId: site, access, requestId, operationId: null, beforeAt: null, beforeId: null });
const notice = (notificationId: string | null = null) => ({ siteId: site, expectedEmployeeId: id(101), expectedWorkerId: notificationId ? id(201) : null, notificationId, beforeAt: null, beforeId: null });
const args = (p_query: unknown, p_command: unknown = null, p_auth_user_id = employee) => ({ p_query, p_auth_user_id, p_command, p_allow_write: true });
const submit = (reason = "Synthetic leave") => ({ action: "submit", operationId: id(1001), reason, expectedWorkerId: id(201), expectedSettingsVersion: 1,
  timeZone: "UTC", startAt: "2026-10-06T08:00:00.000Z", endAt: "2026-10-06T16:00:00.000Z" });
const decision = (action = "approve") => ({ action, operationId: id(2001), reason: "Synthetic decision", requestId: id(1001), expectedRevision: action === "cancel" ? 2 : 1 });
function harness() {
  const sql: string[] = [], state = { error: null as Error | null, role: "service_role", data: { untouchedRpcReply: true } as unknown, owner: false };
  const transport = createAttendanceLeaveShellTransport(statement => {
    sql.push(statement); if (state.error) throw state.error;
    if (statement.startsWith("select count(*)")) return state.owner ? "1" : "0";
    if (statement.startsWith("select coalesce")) return JSON.stringify({ id: id(101), displayName: "Synthetic employee", email: databaseActors[1].email,
      roleId: id(30), roleName: "Synthetic role", version: 1, permissions: ["enterprise.view", "attendance.self.view", "attendance.self.leave"] });
    return JSON.stringify({ role: state.role, data: state.data });
  });
  return { ...transport, sql, db: state };
}

test("leave shell construction is inert and exposes exactly five RPCs", () => {
  const h = harness(); assert.deepEqual(h.sql, []); assert.deepEqual(h.calls, []); assert.deepEqual(h.errors, []);
  assert.deepEqual([...leaveShellRpcNames].sort(), ["faolla_attendance_self_v1", "faolla_attendance_admin_v1", "faolla_attendance_leave_v1", "faolla_attendance_leave_notify_v1", "faolla_attendance_leave_notifications_v1"].sort());
});

test("original self/admin reads and all leave dispatches return only their supplied SQL results", async () => {
  const h = harness(), original = { p_site_id: site, p_auth_user_id: employee, p_command: null, p_operation_id: null };
  const invocations: [string, Record<string, unknown>][] = [
    ["faolla_attendance_self_v1", original],
    ["faolla_attendance_admin_v1", { ...original, p_auth_user_id: owner, p_query: { view: "settings", cursor: null, search: "" } }],
    ["faolla_attendance_leave_v1", args(leave())], ["faolla_attendance_leave_v1", args(leave(), submit())],
    ["faolla_attendance_leave_v1", args(leave("self", id(1001)), decision("withdraw"))],
    ...["approve", "reject", "cancel"].map(action => ["faolla_attendance_leave_notify_v1", args(leave("owner", id(1001)), decision(action), owner)] as [string, Record<string, unknown>]),
    ["faolla_attendance_leave_notifications_v1", args(notice())],
    ["faolla_attendance_leave_notifications_v1", args(notice(id(2001)), { action: "mark_read", notificationId: id(2001) })],
  ];
  for (const [name, input] of invocations) assert.deepEqual(await h.rpc(name, input), { data: h.db.data, error: null });
  assert.equal(h.calls.length, invocations.length); assert.equal(h.sql.length, invocations.length);
  assert(h.sql.every(statement => statement.startsWith("set local standard_conforming_strings=on;set local role service_role;select jsonb_build_object('role',current_user,'data',public.faolla_attendance_")));
  assert(h.sql[0].includes(`('${site}','${employee}',null,null)`));
  assert(h.sql[3].includes(`::jsonb,'${employee}',`) && h.sql[3].endsWith("::jsonb,true));"));
  assert.deepEqual(h.calls.map(call => call.action), [null, null, null, "submit", "withdraw", "approve", "reject", "cancel", null, "mark_read"]);
});

test("unknown names, identities, sites, writes and malformed request shapes fail before SQL", async () => {
  const h = harness(), input = args(leave());
  const denied: [string, Record<string, unknown>][] = [
    ["toString", input], ["faolla_attendance_leave_review_v1", input], ["faolla_attendance_self_v1);drop schema public;--", input],
    ["faolla_attendance_leave_v1", { ...input, extra: true }], ["faolla_attendance_leave_v1", { ...input, p_auth_user_id: id(101) }],
    ["faolla_attendance_leave_v1", args({ ...leave(), siteId: "99990002" })],
    ["faolla_attendance_leave_v1", { ...input, p_allow_write: "true" }],
    ["faolla_attendance_leave_v1", args({ ...leave(), extra: true })], ["faolla_attendance_leave_v1", args(null)],
    ["faolla_attendance_leave_v1", args(leave(), { ...submit(), extra: true })],
    ["faolla_attendance_leave_v1", args(leave("owner", id(1001)), decision(), owner)],
    ["faolla_attendance_leave_notify_v1", args(leave(), submit())], ["faolla_attendance_leave_notify_v1", args(leave("owner"), null, owner)],
    ["faolla_attendance_leave_notifications_v1", args({ ...notice(), expectedEmployeeId: employee, siteId: "99990002" })],
    ["faolla_attendance_leave_notifications_v1", args(notice(id(2001)), { action: "mark_read", notificationId: id(2002) })],
    ["faolla_attendance_self_v1", { p_site_id: site, p_auth_user_id: employee, p_command: {}, p_operation_id: null }],
    ["faolla_attendance_self_v1", { p_site_id: site, p_auth_user_id: employee, p_command: null, p_operation_id: "invalid" }],
    ["faolla_attendance_admin_v1", { p_site_id: site, p_auth_user_id: owner, p_command: null, p_operation_id: null, p_query: { view: "settings", cursor: null, search: "", extra: true } }],
  ];
  for (const [name, values] of denied) await assert.rejects(h.rpc(name, values));
  assert.deepEqual(h.sql, []); assert.deepEqual(h.calls, []);
});

test("reasons are safely SQL encoded but absent from transport diagnostics", async () => {
  const h = harness(), reason = "O'Reilly\\'; select pg_sleep(99); --";
  await h.rpc("faolla_attendance_leave_v1", args(leave(), submit(reason)));
  assert(h.sql[0].includes("'" + JSON.stringify(submit(reason)).replaceAll("'", "''") + "'::jsonb"));
  assert(!JSON.stringify(h.calls).includes(reason));
  assert.deepEqual(Object.keys(h.calls[0]).sort(), ["action", "actor", "name", "operationId", "siteId"]);
});

test("database errors reveal only attendance codes and unexpected failures reveal no raw diagnostic", async () => {
  const h = harness(); h.db.error = Error("ERROR: attendance_access_denied\nDETAIL: PRIVATE-REASON");
  assert.deepEqual(await h.rpc("faolla_attendance_leave_v1", args(leave())), { data: null, error: { message: "attendance_access_denied" } });
  assert.deepEqual(h.errors, []);
  h.db.error = Error("connection failed PRIVATE-CREDENTIAL");
  await assert.rejects(h.rpc("faolla_attendance_leave_v1", args(leave())), /^Error: leave_shell_rpc_failed$/);
  h.db.error = null; h.db.role = "postgres";
  await assert.rejects(h.rpc("faolla_attendance_leave_v1", args(leave())), /^Error: leave_shell_rpc_failed$/);
  assert.deepEqual(h.errors, ["leave_shell_rpc_failed", "leave_shell_rpc_failed"]);
});

test("outer shell reuses SQL membership identities and never writes acceptance or owner capabilities", async () => {
  const h = harness(), request = (path: string, method = "GET", body?: unknown) => new Request("https://www.faolla.com" + path,
    { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const overview = await (await h.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), employee)).json();
  assert.equal(overview.actor.id, id(101)); assert.notEqual(overview.actor.id, employee); assert.equal(overview.actor.type, "employee");
  assert.deepEqual(overview.snapshot, { roles: [], employees: [], boards: [], columns: [], tasks: [] });
  assert.deepEqual(await (await h.serveShell(request("/api/merchant-enterprise/employees/accept", "POST", { siteId: site }), employee)).json(), { ok: true });
  h.db.owner = true;
  const ownerOverview = await (await h.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), owner)).json();
  assert.equal(ownerOverview.actor.id, owner); assert.equal(ownerOverview.actor.type, "owner");
  const capabilities = await h.serveShell(request(`/api/merchant-business/capabilities?siteId=${site}`), owner);
  assert.equal(capabilities.status, 403); assert.equal((await capabilities.json()).error, "synthetic_owner_business_out_of_scope");
  assert(h.sql.every(statement => !/\b(?:insert|update|delete|alter|create|drop|truncate)\b/i.test(statement)));
  const count = h.sql.length;
  for (const invalid of [request("/api/merchant-enterprise/tasks"), request(`/api/merchant-enterprise/overview?siteId=99990002`),
    request(`/api/merchant-enterprise/overview?siteId=${site}&siteId=${site}`), request("/api/merchant-enterprise/employees/accept", "POST", { siteId: site, employeeId: id(101) })])
    await assert.rejects(h.serveShell(invalid, employee));
  await assert.rejects(h.serveShell(request("/api/merchant-enterprise/memberships"), id(101)));
  assert.equal(h.sql.length, count);
});
