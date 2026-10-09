// Reuses only the explicitly named stopped synthetic cluster. Every SQL change rolls back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import contract from "../src/lib/merchantAttendanceSelfContext.ts";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", owner = id(79001), auth = id(79002), employee = id(79003), role = id(79004), worker = id(79005), place = id(79006);
  const json = v => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const context = (who = auth, tenant = site) => `public.faolla_attendance_self_context_v1('${tenant}','${who}')`;
  const reject = (code, expression) => `begin perform ${expression};raise exception 'unexpected context acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const command = (op, action = "clock_in", seq = 0, safe = false) => ({ operationId: id(op), locationId: place, action, expectedSequence: seq,
    settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: safe ? null : 1, safeFinish: safe });
  const clock = (c = null, assertion = "null", allow = true) => `public.faolla_attendance_location_clock_v2('${site}','${auth}','${worker}',${c ? json(c) : "null"},null,${assertion},${allow},false)`;
  const values = { purpose: "Synthetic context", notice: "Synthetic only", contact: "Synthetic owner", alternative: "Manual review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300071_merchant_attendance_location_precheck.sql", "202609300072_merchant_attendance_location_clock.sql", "202609300073_merchant_attendance_location_policy_drafts.sql", "202609300076_merchant_attendance_location_notices.sql", "202609300077_merchant_attendance_location_clock_notice_guard.sql", "202609300079_merchant_attendance_self_context.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled,location_clock_enabled) values('${site}','UTC',true,true,true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters) values('${place}','${site}','Synthetic A','Europe/Madrid',true,37.3,-5.9,100);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic self',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','context@example.test','Synthetic','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${employee}','CONTEXT-A','Synthetic','${place}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    create temp table context_contracts(value jsonb);grant insert,select on context_contracts to service_role;
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      a:=${context()};assert a=jsonb_build_object('siteId','${site}','employeeId','${employee}','workerId','${worker}','locationId','${place}'),'minimal context';
      insert into context_contracts values(a);
      ${reject("attendance_access_denied", context(owner))}
      ${reject("attendance_access_denied", context(id(79999)))}
      ${reject("attendance_access_denied", context(auth, "99990008"))}
      ${reject("attendance_invalid_request", "public.faolla_attendance_self_context_v1(null,null)")}
      perform public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${place}',${json({ operationId: id(79010), expectedRevision: 0, expectedSettingsVersion: 1, expectedLocationVersion: 1, values })},null,true);
      perform public.faolla_attendance_location_notice_v1('${site}','${owner}',${json({ access: "owner", locationId: place, expectedWorkerId: null, operationId: null })},${json({ action: "publish", operationId: id(79011), expectedRevision: 0, draftRevision: 1, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Synthetic publication" })},true);
      perform public.faolla_attendance_location_notice_v1('${site}','${auth}',${json({ access: "self", locationId: place, expectedWorkerId: worker, operationId: null })},${json({ action: "acknowledge", operationId: id(79012), expectedRevision: 1 })},true);
      b:=${clock()};
      b:=${clock(command(79013), "jsonb_build_object('policyFingerprint',b->>'internalPolicyFingerprint','algorithmVersion',1,'reason','not_provided','capturedAt',null,'accuracyMeters',null,'distanceMeters',null)")};
      assert b->'state'->>'status'='working','open synthetic shift';
    end $checks$;reset role;
    update public.merchant_attendance_settings set enabled=false,web_clock_enabled=false,location_clock_enabled=false where merchant_id='${site}';
    update public.merchant_attendance_workers set active=false,default_location_id=null where id='${worker}';
    update public.merchant_attendance_locations set active=false where id='${place}';
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      a:=${context()};assert a->'locationId'='null'::jsonb and a->>'workerId'='${worker}','paused identity discoverable';
      insert into context_contracts values(a);
      b:=public.faolla_attendance_location_clock_v2('${site}','${auth}',(a->>'workerId')::uuid,null,null,null,false,false);
      assert b->'channelEnabled'='false'::jsonb and b->'finish'->>'locationId'='${place}','discover original safe finish';
      b:=${clock(command(79014, "clock_out", 1, true), "null", false)};
      assert b->'state'->>'status'='off' and b->'receiptGate'->'safeFinish'='true'::jsonb,'explicit finish still succeeds';
    end $checks$;reset role;
    savepoint view_only;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    set local role service_role;do $checks$ begin perform ${context()};end $checks$;reset role;rollback to savepoint view_only;
    savepoint revoked;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where id='${role}';
    set local role service_role;do $checks$ begin ${reject("attendance_access_denied", context())} end $checks$;reset role;rollback to savepoint revoked;
    savepoint inactive;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role;do $checks$ begin ${reject("attendance_access_denied", context())} end $checks$;reset role;rollback to savepoint inactive;
    savepoint rebind;
    update public.merchant_enterprise_employees set auth_user_id='${id(79099)}' where id='${employee}';
    set local role service_role;do $checks$ declare a jsonb;begin ${reject("attendance_access_denied", context())}
      a:=${context(id(79099))};assert a->>'employeeId'='${employee}','current auth only';end $checks$;reset role;rollback to savepoint rebind;
    ${["anon", "authenticated"].map(r => `set local role ${r};do $checks$ begin perform ${context()};raise exception 'public RPC';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    do $checks$ begin
      assert (select count(*) from public.merchant_attendance_events where merchant_id='${site}')=2,'only explicit punches';
      assert (select count(*) from public.merchant_attendance_location_notice_acknowledgements where merchant_id='${site}')=1,'only explicit acknowledgement';
      assert (select count(*) from public.merchant_attendance_workers where merchant_id='${site}')=1,'no discovery provisioning';
    end $checks$;
    select jsonb_agg(value) from context_contracts;rollback;`);
  for (const value of JSON.parse(output)) assert.deepEqual(contract.parseAttendanceSelfContext(value, site), value);
  ["minimal server-resolved identity is read-only and whitelisted", "owner and other-account/tenant requests are denied", "paused flags/inactive worker/null default preserve safe-finish discovery",
    "context worker feeds v2 GET and explicit old-location safe finish", "view-only permitted; revoked role/inactive employee denied", "current auth binding and service-only execution enforced",
    "discovery creates no workers, acknowledgements or punches", "real SQL JSON survives the TypeScript parser"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(e => { console.error(e); process.exitCode = 1; });
