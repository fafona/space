import assert from "node:assert/strict";
import test from "node:test";
import { createEventChannelsShellTransport, eventChannelsShellRpcNames, siteNames } from "./fixtures/attendance-event-channels-shell-transport";

const id = (n: number) => `12345678-1234-4000-8000-${String(n).padStart(12, "0")}`;
const actors = [{ id: id(99), email: "owner@sampleexample.test" }, { id: id(5), email: "employee@example.test" }];
const actor = actors[1].id, site = "99990001", secondSite = "99990002";
const employee = (siteId = site, number = 10) => ({ siteId, id: id(number), displayName: `合成员工${number}`, email: "employee@example.test",
  roleId: id(number + 10), roleName: "合成考勤角色", employeeVersion: 2, roleVersion: 3,
  permissions: ["enterprise.view", "attendance.self.view"], accessScope: "all", allowedBoardIds: [] as string[] });
const request = (path: string, method = "GET", body?: unknown) => new Request(`https://local.example.test${path}`, {
  method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
function harness() {
  const sql: string[] = [];
  const state = { memberships: [employee(), employee(secondSite, 11)], owner: false,
    current: { [site]: employee(), [secondSite]: employee(secondSite, 11) } as Record<string, ReturnType<typeof employee> | null>,
    role: "service_role", error: null as Error | null, rpcData: { fromActualRpc: true } as unknown };
  const transport = createEventChannelsShellTransport(statement => {
    sql.push(statement); if (state.error) throw state.error;
    const data = statement.includes("current_memberships") ? state.memberships
      : /public\.faolla_attendance_/.test(statement) ? state.rpcData
        : { owner: state.owner, employee: state.current[statement.includes(`where id='${secondSite}'`) ? secondSite : site] };
    return JSON.stringify({ role: state.role, data });
  }, actors);
  return { ...transport, db: state, sql };
}
const queryArgs = (p_query: unknown, p_site_id = site) => ({ p_site_id, p_auth_user_id: actor, p_query });
const readQueries: Record<string, Record<string, unknown>> = {
  faolla_attendance_self_history_v1: { fromAt: "2026-10-01T00:00:00.000Z", toAt: "2026-10-02T00:00:00.000Z", expectedWorkerId: id(30), asOf: null, cursorAt: null, cursorId: null },
  faolla_attendance_scoped_period_report_v2: { access: "self", fromDate: "2026-10-01", throughDate: "2026-10-01", workerId: null, locationId: null, expectedWorkerId: id(30) },
  faolla_attendance_scoped_report_context_v1: { access: "manager", search: "", cursor: null, scopeRevision: null },
  faolla_attendance_unified_report_v1: { access: "self", workerId: null, locationId: null, expectedWorkerId: id(30), fromDate: "2026-10-01", throughDate: "2026-10-01" },
  faolla_attendance_event_channels_v1: { access: "self", workerId: id(30), locationId: null, eventIds: [id(40)] },
  faolla_attendance_records_v1: { access: "manager", fromAt: "2026-10-01T00:00:00.000Z", toAt: "2026-10-02T00:00:00.000Z", workerId: id(30), locationId: id(50), asOf: null, cursorAt: null, cursorId: null },
  faolla_attendance_choices_v1: { kind: "workers", search: "", cursor: null },
};

test("explicit synthetic actors are required, copied and not tied to old databaseActors IDs", async () => {
  for (const invalid of [[], [{ id: actor, email: "real@example.com" }], [{ id: "garbage", email: "a@example.test" }],
    [{ id: actor.toUpperCase(), email: "a@example.test" }].map(value => ({ ...value, id: value.id.replace("8000", "A000") })),
    [actors[0], actors[0]], [{ ...actors[0], token: "not-allowed" }]]) {
    assert.throws(() => createEventChannelsShellTransport(() => { throw Error("must not query"); }, invalid));
  }
  const supplied = [{ ...actors[0] }];
  const transport = createEventChannelsShellTransport(() => JSON.stringify({ role: "service_role", data: { owner: true, employee: null } }), supplied);
  supplied[0].email = "changed@example.test";
  const response = await transport.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), actors[0].id);
  assert.equal((await response.json()).actor.email, actors[0].email);
  assert.equal((await transport.serveShell(request("/api/merchant-enterprise/memberships"), id(123))).status, 403);
});

test("memberships expose both current-enterable tenants with distinct names and current DB role IDs", async () => {
  const h = harness(), response = await h.serveShell(request("/api/merchant-enterprise/memberships"), actor), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.memberships.map((value: { siteId: string }) => value.siteId), [site, secondSite]);
  assert.deepEqual(body.memberships.map((value: { siteName: string }) => value.siteName), [siteNames[site], siteNames[secondSite]]);
  assert.notEqual(siteNames[site], siteNames[secondSite]);
  assert.deepEqual(body.memberships[1], { siteId: secondSite, siteName: siteNames[secondSite], employeeId: id(11), displayName: "合成员工11",
    roleId: id(21), roleName: "合成考勤角色", status: "active", enterable: true });
  assert.match(h.sql[0], /e.merchant_id in \('99990001','99990002'\)/);
  assert.ok(h.sql[0].includes(`e.auth_user_id='${actor}'`));
  assert.match(h.sql[0], /r.merchant_id=e.merchant_id and r.id=e.role_id/);
  assert.match(h.sql[0], /e.status='active' and r.status='active' and 'enterprise.view'=any\(r.permissions\)/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  h.db.memberships = [employee(secondSite, 11)];
  assert.deepEqual((await (await h.serveShell(request("/api/merchant-enterprise/memberships"), actor)).json()).memberships.map((value: { siteId: string }) => value.siteId), [secondSite]);
  h.db.memberships = []; assert.deepEqual((await (await h.serveShell(request("/api/merchant-enterprise/memberships"), actor)).json()).memberships, []);
});

test("invalid role dependencies, duplicate permissions and foreign fixture sites are not enterable", async () => {
  const h = harness();
  h.db.memberships = [{ ...employee(), permissions: ["enterprise.view", "attendance.self.clock"] },
    { ...employee(), permissions: ["enterprise.view", "enterprise.view"] }, { ...employee(), siteId: "12345678" },
    { ...employee(), permissions: ["enterprise.view", "not.a.permission"] }];
  const body = await (await h.serveShell(request("/api/merchant-enterprise/memberships"), actor)).json();
  assert.deepEqual(body.memberships, []);
});

test("capabilities are freshly site-scoped and include employee/role version and role-change cache boundaries", async () => {
  const h = harness(), url = `/api/merchant-business/capabilities?siteId=${secondSite}`;
  const first = await (await h.serveShell(request(url), actor)).json();
  assert.deepEqual(first.actor, { type: "employee", displayName: "合成员工11", principalKey: `employee:${id(11)}`, authorizationVersion: "2:3" });
  assert.deepEqual(first.workspace, { siteId: secondSite, siteName: siteNames[secondSite], siteCountryCode: "ES" });
  assert.deepEqual(first.collaborationPermissions, ["enterprise.view", "attendance.self.view"]); assert.deepEqual(first.permissions, []);
  assert.ok(h.sql[0].includes(`e.merchant_id='${secondSite}' and e.auth_user_id='${actor}'`));
  assert.match(h.sql[0], /'employeeVersion',e.version,'roleVersion',r.version/);
  h.db.current[secondSite] = { ...employee(secondSite, 11), employeeVersion: 4, roleVersion: 6, roleId: id(80), permissions: ["enterprise.view"] };
  const changed = await (await h.serveShell(request(url), actor)).json();
  assert.equal(changed.actor.authorizationVersion, "4:6"); assert.notEqual(changed.cacheNamespace, first.cacheNamespace);
  assert.deepEqual(changed.collaborationPermissions, ["enterprise.view"]);
  h.db.current[secondSite] = null; assert.equal((await h.serveShell(request(url), actor)).status, 403);
  assert.equal(h.sql.length, 3);
});

test("synthetic acceptance acknowledges only current active membership and never writes or promotes an invite", async () => {
  const h = harness(), accept = () => request("/api/merchant-enterprise/employees/accept", "POST", { siteId: secondSite });
  assert.deepEqual(await (await h.serveShell(accept(), actor)).json(), { ok: true });
  assert.equal(h.shellCalls[0].siteId, secondSite); assert.match(h.sql[0], /e.status='active' and r.status='active'/);
  h.db.current[secondSite] = null; h.db.owner = true;
  assert.equal((await h.serveShell(accept(), actor)).status, 403, "ownership is not employee invitation acceptance");
  h.db.current[secondSite] = { ...employee(secondSite, 11), permissions: ["enterprise.view", "attendance.self.clock"] };
  assert.equal((await h.serveShell(accept(), actor)).status, 403);
  assert(h.sql.every(sql => !/\b(?:insert|update|delete|alter|create|drop|truncate)\b/i.test(sql)));
});

test("overview returns the current DB employee actor and canonical owner with explicit synthetic board context", async () => {
  const h = harness();
  const own = await (await h.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), actor)).json();
  assert.equal(own.actor.type, "employee"); assert.equal(own.actor.id, id(10)); assert.equal(own.actor.roleId, id(20));
  assert.deepEqual(own.actor.allowedBoardIds, []); assert.equal(own.actor.accessScope, "all"); assert.equal(own.needsBootstrap, false);
  assert.match(h.sql[0], /'accessScope','all','allowedBoardIds','\[\]'::jsonb/); assert.doesNotMatch(h.sql[0], /role_boards|r.access_scope/);
  assert.deepEqual(own.snapshot, { roles: [], employees: [], boards: [], columns: [], tasks: [] });
  h.db.current[site] = null; assert.equal((await h.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), actor)).status, 403);
  h.db.owner = true;
  const owner = await (await h.serveShell(request(`/api/merchant-enterprise/overview?siteId=${site}`), actors[0].id)).json();
  assert.equal(owner.actor.type, "owner"); assert.equal(owner.actor.id, actors[0].id); assert.equal(owner.actor.email, actors[0].email);
  assert.match(h.sql.at(-1)!, /public.merchants where id='99990001' and user_id=/); assert.doesNotMatch(h.sql.at(-1)!, /owner_id/);
  assert.equal((await h.serveShell(request(`/api/merchant-business/capabilities?siteId=${site}`), actors[0].id)).status, 403);
});

test("shell endpoints, methods, queries, actors and tenant IDs fail closed before SQL", async () => {
  const h = harness();
  const denied: [Request, number][] = [
    [request("/api/merchant-enterprise/tasks"), 404], [request("/api/merchant-enterprise/overview", "POST", { siteId: site }), 405],
    [request("/api/merchant-enterprise/employees/accept"), 405], [request("/api/merchant-enterprise/memberships?siteId=99990001"), 400],
    [request("/api/merchant-enterprise/overview"), 400], [request("/api/merchant-enterprise/overview?siteId=99990003"), 400],
    [request("/api/merchant-enterprise/overview?siteId=99990001&siteId=99990002"), 400],
    [request("/api/merchant-enterprise/overview?siteId=99990001&other=1"), 400], [request("/api/merchant-enterprise/overview?siteId=%2099990001"), 400],
    [request("/api/merchant-enterprise/employees/accept?siteId=99990001", "POST", { siteId: site }), 400],
    [request("/api/merchant-enterprise/employees/accept", "POST", { siteId: site, employeeId: id(50) }), 400],
    [request("/api/merchant-enterprise/employees/accept", "POST", { siteId: "99990003" }), 400],
    [request("/api/merchant-enterprise/employees/accept", "POST", { siteId: "x".repeat(600) }), 413],
    [new Request("https://local.example.test/api/merchant-enterprise/employees/accept", { method: "POST", body: "{}" }), 415],
    [new Request("https://local.example.test/api/merchant-enterprise/employees/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), 400],
  ];
  for (const [input, status] of denied) assert.equal((await h.serveShell(input, actor)).status, status, input.url);
  assert.equal((await h.serveShell(request("/api/merchant-enterprise/memberships"), id(777))).status, 403);
  assert.equal(h.sql.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.shellCalls.length, 0);
});

test("RPC adapter has exactly the documented read allowlist and uses actual service-role SQL for both tenants", async () => {
  const h = harness();
  assert.deepEqual([...eventChannelsShellRpcNames].sort(), [...Object.keys(readQueries), "faolla_attendance_self_v1", "faolla_attendance_self_session_v1",
    "faolla_attendance_self_context_v1", "faolla_attendance_correction_self_v3"].sort());
  for (const currentSite of [site, secondSite]) {
    for (const [name, query] of Object.entries(readQueries)) assert.deepEqual(await h.rpc(name, queryArgs(query, currentSite)), { data: h.db.rpcData, error: null });
    assert.deepEqual(await h.rpc("faolla_attendance_self_v1", { p_site_id: currentSite, p_auth_user_id: actor, p_command: null, p_operation_id: null }), { data: h.db.rpcData, error: null });
    await h.rpc("faolla_attendance_self_session_v1", { p_site_id: currentSite, p_auth_user_id: actor, p_start_event_id: id(40) });
    await h.rpc("faolla_attendance_self_context_v1", { p_site_id: currentSite, p_auth_user_id: actor });
    await h.rpc("faolla_attendance_correction_self_v3", { ...queryArgs({ mode: "prepare", expectedWorkerId: id(30), startEventId: id(40) }, currentSite), p_command: null, p_platform_enabled: false });
  }
  assert.equal(h.calls.length, eventChannelsShellRpcNames.length * 2);
  assert(h.calls.every(call => call.actor === actor && call.command === null));
  assert(h.sql.every(sql => sql.startsWith("set standard_conforming_strings=on;set role service_role;select jsonb_build_object('role',current_user,'data',public.faolla_attendance_")));
  assert(h.sql.some(sql => sql.includes(`('${secondSite}','${actor}'`))); assert.deepEqual(h.errors, []);
});

test("read receipt, correction list/detail, owner unified and choice-label variants keep exact parameter order", async () => {
  const h = harness();
  await h.rpc("faolla_attendance_self_v1", { p_site_id: site, p_auth_user_id: actor, p_command: null, p_operation_id: id(66) });
  assert.ok(h.sql.at(-1)?.includes(`public.faolla_attendance_self_v1('${site}','${actor}',null,'${id(66)}')`));
  for (const p_query of [{ mode: "detail", expectedWorkerId: id(30), requestId: id(60), operationId: null },
    { mode: "list", expectedWorkerId: id(30), cursorAt: null, cursorId: null }]) {
    await h.rpc("faolla_attendance_correction_self_v3", { ...queryArgs(p_query), p_command: null, p_platform_enabled: true });
    assert.match(h.sql.at(-1)!, /::jsonb,null,true\)\);$/);
  }
  await h.rpc("faolla_attendance_unified_report_v1", queryArgs({ access: "owner", workerId: id(30), fromDate: "2026-10-01", throughDate: "2026-10-02" }));
  await h.rpc("faolla_attendance_choices_v1", queryArgs({ kind: "workers", ids: [id(30)] }));
  assert.equal(h.calls[0].operationId, id(66));
});

test("unknown RPCs, writes, malformed argument sets and unauthorized fixture scope never execute SQL", async () => {
  const h = harness(), context = { p_site_id: site, p_auth_user_id: actor }, channels = queryArgs(readQueries.faolla_attendance_event_channels_v1);
  const denied: [string, Record<string, unknown>][] = [
    ["faolla_attendance_admin_v1", context], ["faolla_attendance_onsite_clock_v1", context], ["faolla_attendance_scopes_v1", context],
    ["faolla_attendance_period_report_v2", channels], ["faolla_attendance_self_v1);delete from public.merchants;--", context], ["toString", context],
    ["faolla_attendance_self_v1", { ...context, p_command: {}, p_operation_id: null }],
    ["faolla_attendance_self_v1", { ...context, p_command: undefined, p_operation_id: null }],
    ["faolla_attendance_self_v1", { ...context, p_command: null, p_operation_id: "not-a-uuid" }],
    ["faolla_attendance_correction_self_v3", { ...queryArgs({ mode: "list", expectedWorkerId: id(30), cursorAt: null, cursorId: null }), p_command: { action: "withdraw" }, p_platform_enabled: false }],
    ["faolla_attendance_correction_self_v3", { ...queryArgs({ mode: "list", expectedWorkerId: id(30), cursorAt: null, cursorId: null }), p_command: null, p_platform_enabled: "false" }],
    ["faolla_attendance_self_session_v1", { ...context, p_start_event_id: null }],
    ["faolla_attendance_self_context_v1", { ...context, p_command: null }],
    ["faolla_attendance_self_context_v1", { p_site_id: site }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_site_id: "99990003" }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_site_id: "99990001' OR true--" }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_auth_user_id: id(600) }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_query: null }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_query: [] }],
    ["faolla_attendance_event_channels_v1", { ...channels, p_query: { ...readQueries.faolla_attendance_event_channels_v1, command: "clock_in" } }],
  ];
  for (const [name, args] of denied) await assert.rejects(h.rpc(name, args));
  assert.equal(h.sql.length, 0); assert.equal(h.calls.length, 0);
});

test("query text is serialized and SQL-quoted under explicit standard-conforming strings", async () => {
  const h = harness(), search = "O'Reilly\\'; select pg_sleep(99); --";
  await h.rpc("faolla_attendance_choices_v1", queryArgs({ kind: "workers", search, cursor: null }));
  const expected = JSON.stringify({ kind: "workers", search, cursor: null }).replaceAll("'", "''");
  assert.ok(h.sql[0].includes(`'${expected}'::jsonb`)); assert.ok(h.sql[0].startsWith("set standard_conforming_strings=on;"));
  assert.deepEqual(h.calls[0].query, { kind: "workers", search, cursor: null });
});

test("expected attendance SQL errors are sanitized; unexpected SQL and wrong execution role fail loudly", async () => {
  const h = harness(); h.db.error = Error("ERROR: attendance_access_denied\nDETAIL: synthetic private details");
  assert.deepEqual(await h.rpc("faolla_attendance_event_channels_v1", queryArgs(readQueries.faolla_attendance_event_channels_v1)),
    { data: null, error: { message: "attendance_access_denied" } });
  assert.deepEqual(h.errors, []);
  h.db.error = Error("connection fixture failed");
  await assert.rejects(h.rpc("faolla_attendance_event_channels_v1", queryArgs(readQueries.faolla_attendance_event_channels_v1)), /connection fixture failed/);
  assert.equal(h.errors.length, 1);
  h.db.error = null; h.db.role = "postgres";
  await assert.rejects(h.rpc("faolla_attendance_self_context_v1", { p_site_id: site, p_auth_user_id: actor }), /wrong_database_role/);
});
