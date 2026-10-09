import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadMerchantEnterpriseSnapshot, merchantEnterpriseWorkspaceNeedsBootstrap, type MerchantEnterpriseStoreClient } from "../../src/lib/merchantEnterpriseStore.server";
import { loadAuthoritativeStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "../../src/lib/platformMerchantSnapshotStore";
import { createAttendanceEmployeeManagementReadTransport } from "./attendance-employee-management-read-transport";

const site = "99990001", origin = "https://attendance-auth.invalid", service = "attendance-synthetic-service";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ownerColumns = ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"];
const ownerQuery = () => ({ select: "id,name,email", id: "eq." + site, or: "(" + ownerColumns.map(c => c + ".eq." + id(99)).join(",") + ")", limit: "1" });
function request(table: string, query: Record<string, string>, extra: RequestInit = {}) {
  const headers = new Headers({ apikey: service, authorization: "Bearer " + service, accept: "application/json" });
  new Headers(extra.headers).forEach((value, key) => headers.set(key, value));
  return new Request(origin + "/rest/v1/" + table + "?" + new URLSearchParams(query), { ...extra, headers });
}
function fixture(run: (sql: string) => string = () => "[]", enabled: () => boolean = () => true) {
  const queries: string[] = [];
  const adapter = createAttendanceEmployeeManagementReadTransport(sql => { queries.push(sql); return run(sql); }, { syntheticAuthUserIds: [id(99), id(1)], enterpriseEnabled: enabled });
  const client = createClient(origin, service, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => adapter.read(new Request(input, init)) } });
  return { adapter, queries, client };
}

test("actual snapshot store and installed SDK use exactly seven fixed 500-row paginated reads", async () => {
  const f = fixture();
  const snapshot = await loadMerchantEnterpriseSnapshot(f.client as unknown as MerchantEnterpriseStoreClient, site);
  assert.deepEqual(snapshot, { roles: [], employees: [], boards: [], columns: [], tasks: [] });
  assert.equal(f.queries.length, 7);
  assert.deepEqual(f.adapter.calls.map(c => c.table).sort(), ["merchant_enterprise_roles", "merchant_enterprise_role_boards", "merchant_enterprise_employees", "merchant_task_boards", "merchant_task_columns", "merchant_tasks", "merchant_task_assignees"].sort());
  for (const sql of f.queries) {
    assert.match(sql, /^begin read only; set local role service_role; select /);
    assert.match(sql, /where merchant_id='99990001' order by [a-z_, ]+ limit 500 offset 0\) q; rollback;$/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|grant|truncate|drop)\b/i);
  }
  assert(f.adapter.calls.every(c => c.shape === "snapshot-page" && c.offset === 0 && c.limit === 500 && !c.object));
  assert.deepEqual(f.adapter.errors, []);
});

test("actual bootstrap reads exact role keys, default board and its exact column keys without mutation or HEAD", async () => {
  let complete = true;
  const f = fixture(sql => {
    if (sql.includes("from public.merchant_enterprise_roles")) return JSON.stringify((complete ? ["administrator", "supervisor", "employee"] : ["employee"]).map(system_key => ({ system_key })));
    if (sql.includes("from public.merchant_task_boards")) return JSON.stringify([{ id: id(20), system_key: "default" }]);
    assert.match(sql, /board_id='00000000-0000-4000-8000-000000000020'/);
    return JSON.stringify(["todo", "in_progress", "blocked", "done"].map(system_key => ({ system_key })));
  });
  assert.equal(await merchantEnterpriseWorkspaceNeedsBootstrap(f.client as unknown as MerchantEnterpriseStoreClient, site), false);
  assert.deepEqual(f.adapter.calls.map(c => c.shape), ["bootstrap-roles", "bootstrap-board", "bootstrap-columns"]);
  complete = false;
  assert.equal(await merchantEnterpriseWorkspaceNeedsBootstrap(f.client as unknown as MerchantEnterpriseStoreClient, site), true);
  assert.equal(f.queries.length, 5, "missing bootstrap facts must not fabricate default columns");
});

test("current owner, current employee, role and role-board reads retain SQL tenant and active filters", async () => {
  const f = fixture();
  await f.client.from("merchants").select("id,name,email").eq("id", site).or(ownerQuery().or.slice(1, -1)).limit(1).maybeSingle();
  await f.client.from("merchant_enterprise_employees").select("id,merchant_id,auth_user_id,email,display_name,role_id,status,invited_at,accepted_at,last_active_at,version,created_at,updated_at").eq("merchant_id", site).eq("auth_user_id", id(1)).eq("status", "active").limit(1).maybeSingle();
  await f.client.from("merchant_enterprise_roles").select("id,merchant_id,name,description,permissions,access_scope,status,is_system,version,created_at,updated_at").eq("merchant_id", site).eq("id", id(31)).eq("status", "active").limit(1).maybeSingle();
  await f.client.from("merchant_enterprise_role_boards").select("board_id").eq("merchant_id", site).eq("role_id", id(31)).order("board_id", { ascending: true });
  await f.client.from("merchant_enterprise_employees").select("id").eq("auth_user_id", id(1)).limit(1);
  assert.deepEqual(f.adapter.calls.map(c => c.shape), ["current-owner", "current-employee", "current-role", "current-role-boards", "synthetic-tenant-staff-principal"]);
  assert.match(f.queries[0], /where id='99990001' and \(user_id=/);
  assert.match(f.queries[1], /where merchant_id='99990001' and auth_user_id='[^']+' and status='active'/);
  assert.match(f.queries[2], /where merchant_id='99990001' and id='[^']+' and status='active'/);
  assert.match(f.queries[4], /where merchant_id='99990001' and auth_user_id='[^']+' limit 1/);
});

test("GET object Accept emits only a single object; SDK maybeSingle empty remains null and multiple rows fail", async () => {
  const row = { id: site, name: "Synthetic", email: "owner@example.test" };
  const f = fixture(() => JSON.stringify([row]));
  const one = f.adapter.read(request("merchants", ownerQuery(), { headers: { accept: "application/vnd.pgrst.object+json" } }));
  assert.deepEqual(await one.json(), row);
  const none = fixture();
  const empty = none.adapter.read(request("merchants", ownerQuery(), { headers: { accept: "application/vnd.pgrst.object+json" } }));
  assert.equal(empty.status, 406); assert.equal((await empty.json()).code, "PGRST116");
  const queried = await none.client.from("merchants").select("id,name,email").eq("id", site).or(ownerQuery().or.slice(1, -1)).limit(1).maybeSingle();
  assert.equal(queried.error, null); assert.equal(queried.data, null);
  const invalid = fixture(() => JSON.stringify([row, row]));
  assert.throws(() => invalid.adapter.read(request("merchants", ownerQuery())), /employee_management_read_forbidden/);
});

test("Range and SDK offset pagination preserve fixed order and bounds, including page20", () => {
  const f = fixture(), query = { select: "merchant_id,task_id,employee_id,assigned_at", merchant_id: "eq." + site, order: "assigned_at.asc,task_id.asc,employee_id.asc" };
  f.adapter.read(request("merchant_task_assignees", query, { headers: { range: "500-999", "range-unit": "items" } }));
  f.adapter.read(request("merchant_task_assignees", { ...query, offset: "9500", limit: "500" }));
  assert.match(f.queries[0], /order by assigned_at asc,task_id asc,employee_id asc limit 500 offset 500/);
  assert.match(f.queries[1], /limit 500 offset 9500/);
  const bad = [request("merchant_task_assignees", query, { headers: { range: "0-500" } }),
    request("merchant_task_assignees", query, { headers: { range: "1-500" } }),
    request("merchant_task_assignees", { ...query, offset: "10000", limit: "500" }),
    request("merchant_task_assignees", { ...query, offset: "0", limit: "500" }, { headers: { range: "0-499" } }),
    request("merchant_task_assignees", { ...query, offset: "0", limit: "500", order: "assigned_at.desc" })];
  for (const r of bad) assert.throws(() => f.adapter.read(r), /employee_management_read_forbidden/);
  assert.equal(f.queries.length, 2);
});

test("authoritative entitlement loader consumes only explicit synthetic primary platform blocks, never DB pages", async () => {
  let enabled = true;
  const f = fixture(() => { throw Error("pages must not reach SQL"); }, () => enabled);
  const original = process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE;
  try {
    process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = "off";
    const load = () => loadAuthoritativeStoredPlatformMerchantSnapshot(f.client as unknown as PlatformMerchantSnapshotStoreClient);
    const active = await load(); assert.equal(active.error, null); assert.equal(active.payload?.snapshot.length, 1);
    assert.equal(active.payload?.snapshot[0].id, site); assert.equal(active.payload?.snapshot[0].permissionConfig?.allowEnterpriseManagement, true);
    enabled = false;
    assert.equal((await load()).payload?.snapshot[0].permissionConfig?.allowEnterpriseManagement, false);
    assert.equal(f.queries.length, 0); assert(f.adapter.calls.every(c => c.shape === "synthetic-platform-entitlement"));
  } finally { if (original === undefined) delete process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE; else process.env.FAOLLA_PLATFORM_SNAPSHOT_WRITE_MODE = original; }
});

test("mutation, foreign tenant/auth, arbitrary projection/filter/order/schema and malformed URLs are rejected before exec", () => {
  const f = fixture(), owner = ownerQuery();
  const denied = [request("merchants", owner, { method: "PATCH", body: "{}" }), request("merchants", owner, { method: "HEAD" }),
    request("merchants", { ...owner, id: "eq.99990002" }), request("merchants", { ...owner, select: "*" }),
    request("merchants", { ...owner, or: "(user_id.eq." + id(99) + ")" }), request("merchants", { ...owner, order: "id" }),
    request("merchants", { ...owner, limit: "1;delete from merchants" }), request("merchants", owner, { headers: { prefer: "count=exact" } }),
    request("merchants", owner, { headers: { "accept-profile": "another_schema" } }), request("merchants", owner, { headers: { apikey: "other" } }),
    request("rpc/anything", owner), request("merchant_enterprise_employees", { select: "id", auth_user_id: "eq." + id(700), limit: "1" }),
    request("merchant_enterprise_employees", { select: "id", auth_user_id: "eq.x' or true--", limit: "1" }),
    request("pages", { select: "id,blocks", merchant_id: "is.null", slug: "eq.__platform_merchant_snapshot_backup__", limit: "1" })];
  denied.push(new Request(request("merchants", owner).url + "&limit=1", { headers: request("merchants", owner).headers }));
  denied.push(new Request(request("merchants", owner).url.replace(origin, "https://production.example.test"), { headers: request("merchants", owner).headers }));
  for (const r of denied) assert.throws(() => f.adapter.read(r), /^Error: employee_management_read_forbidden$/);
  assert.equal(f.queries.length, 0);
  assert.throws(() => createAttendanceEmployeeManagementReadTransport(() => "[]", { syntheticAuthUserIds: ["foreign-auth"] }), /forbidden/);
});

test("SQL failures and malformed output fail closed without exposing query or server details", () => {
  for (const execute of [() => { throw Error("secret-db-location credential-value"); }, () => "not json"]) {
    const f = fixture(execute);
    assert.throws(() => f.adapter.read(request("merchants", ownerQuery())), /^Error: employee_management_read_unavailable$/);
    assert.deepEqual(f.adapter.errors, ["employee_management_read_unavailable"]);
  }
  for (const value of ["null", "{}", "[null]", "[1]"]) {
    const f = fixture(() => value); assert.throws(() => f.adapter.read(request("merchants", ownerQuery())), /^Error: employee_management_read_forbidden$/);
  }
});
