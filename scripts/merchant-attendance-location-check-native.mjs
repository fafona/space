import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";

function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", foreign = "99990008", auth = id(71001), employee = id(71002), role = id(71003), worker = id(71004), place = id(71005);
  const versions = "'{\"settingsVersion\":1,\"workerVersion\":1,\"locationVersion\":1}'::jsonb";
  const call = (v = "null", who = auth, tenant = site, w = worker, l = place) => `public.faolla_attendance_location_policy_v1('${tenant}','${who}','${w}','${l}',${v})`;
  const reject = (code, sql = call()) => `begin perform ${sql};raise exception 'unexpected location policy acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const migration = readFileSync(path.join(root, "scripts/supabase-migrations/202609300071_merchant_attendance_location_precheck.sql"), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = ["location checking defaults off, including existing settings",
    "policy reads only current self worker and default place; expected IDs grant no authority",
    "both clock and self-view permission, active employee/role/worker/place and employment are required",
    "settings, worker and location versions each reject stale checks",
    "platform-independent enterprise and web pause switches reject this diagnostic",
    "only service role can read policy; no direct event/table grants are introduced",
    "successful check is explicitly diagnostic, not a receipt/token; original web geofence remains closed",
    "no attendance events, configuration receipts or scopes are changed by policy reads"];
  const output = query(`begin; set local lock_timeout='3s'; set local statement_timeout='10s';${migration}
    do $checks$ begin assert not exists(select 1 from public.merchant_attendance_settings where location_check_enabled),'existing defaults off';end $checks$;
    insert into public.merchants(id) values('${site}'),('${foreign}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled)
      values('${site}','UTC',true,true),('${foreign}','UTC',true,true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic location role',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${auth}','location@example.test','Synthetic location','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters)
      values('${place}','${site}','Synthetic workplace','UTC',true,37.3,-5.9,100);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
      values('${worker}','${site}','${employee}','LOC-A','Synthetic worker',true,'${place}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    create temporary table before_location_check as select
      (select count(*) from public.merchant_attendance_events) events,
      (select count(*) from public.merchant_attendance_config_operations) configs,
      (select count(*) from public.merchant_attendance_scope_operations) scopes;
    do $checks$ begin ${reject("attendance_location_check_disabled")} end $checks$;
    update public.merchant_attendance_settings set location_check_enabled=true where merchant_id in ('${site}','${foreign}');
    set local role service_role;
    do $checks$ declare r jsonb;begin
      r:=${call()};assert r->>'workerId'='${worker}' and r->>'employeeId'='${employee}','self binding';
      assert r->'diagnosticOnly'='true'::jsonb and r->'punchRecorded'='false'::jsonb,'not a punch';
      assert not(r ?| array['token','receipt','operationId','authUserId','events']),'no proof';
      assert r->'fence'->>'radiusMeters'='100','server policy';perform ${call(versions)};
      ${reject("attendance_access_denied", call("null", id(71099)))}
      ${reject("attendance_access_denied", call("null", auth, foreign))}
      ${reject("attendance_worker_changed", call("null", auth, site, id(71099)))}
      ${reject("attendance_location_denied", call("null", auth, site, worker, id(71099)))}
      ${["settingsVersion", "workerVersion", "locationVersion"].map(key => reject("attendance_location_policy_changed", call(`jsonb_set(${versions},'{${key}}','2'::jsonb)`))).join("\n")}
      ${["'null'::jsonb", "'[]'::jsonb", "'{}'::jsonb", `jsonb_set(${versions},'{settingsVersion}','null'::jsonb)`, `jsonb_set(${versions},'{workerVersion}','1.5'::jsonb)`, `jsonb_set(${versions},'{locationVersion}','9007199254740992'::jsonb)`].map(v => reject("attendance_invalid_request", call(v))).join("\n")}
      ${reject("attendance_location_verification_required", `public.faolla_attendance_self_v1('${site}','${auth}','${JSON.stringify({ expectedWorkerId: worker, operationId: id(71999), locationId: place, action: "clock_in", expectedSequence: 0 })}'::jsonb,null)`)}
    end $checks$;reset role;
    ${[
      ["merchant_attendance_settings", "merchant_id", site, "enabled=false", "enabled=true", "attendance_disabled"],
      ["merchant_attendance_settings", "merchant_id", site, "web_clock_enabled=false", "web_clock_enabled=true", "attendance_web_disabled"],
      ["merchant_enterprise_employees", "id", employee, "status='disabled'", "status='active'", "attendance_access_denied"],
      ["merchant_enterprise_roles", "id", role, "permissions=array['enterprise.view','attendance.self.view']", "permissions=array['enterprise.view','attendance.self.view','attendance.self.clock']", "attendance_access_denied"],
      ["merchant_enterprise_roles", "id", role, "status='archived'", "status='active'", "attendance_access_denied"],
      ["merchant_attendance_workers", "id", worker, "active=false", "active=true", "attendance_access_denied"],
      ["merchant_attendance_locations", "id", place, "active=false", "active=true", "attendance_location_denied"],
      ["merchant_attendance_locations", "id", place, "latitude=null,longitude=null,radius_meters=null", "latitude=37.3,longitude=-5.9,radius_meters=100", "attendance_location_not_configured"],
      ["merchant_attendance_employment_periods", "worker_id", worker, "ends_on='2000-01-02'", "ends_on=null", "attendance_not_employed"],
    ].map(([table, key, value, change, restore, code]) => `update public.${table} set ${change} where ${key}='${value}';do $checks$ begin ${reject(code)}end $checks$;update public.${table} set ${restore} where ${key}='${value}';`).join("\n")}
    set local role anon;do $checks$ begin perform ${call()};raise exception 'anon execute';exception when insufficient_privilege then null;end $checks$;reset role;
    set local role authenticated;do $checks$ begin perform ${call()};raise exception 'authenticated execute';exception when insufficient_privilege then null;end $checks$;reset role;
    do $checks$ begin
      assert not has_table_privilege('service_role','public.merchant_attendance_events','INSERT'),'no event DML';
      assert (select events from before_location_check)=(select count(*) from public.merchant_attendance_events),'events unchanged';
      assert (select configs from before_location_check)=(select count(*) from public.merchant_attendance_config_operations),'config receipts unchanged';
      assert (select scopes from before_location_check)=(select count(*) from public.merchant_attendance_scope_operations),'scope receipts unchanged';
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(error => { console.error(error); process.exitCode = 1; });
