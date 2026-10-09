import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", owner = id(76001), auth = id(76002), employee = id(76003), role = id(76004), worker = id(76005), place = id(76006), other = id(76007);
  const values = { purpose: "Synthetic attendance notice", notice: "Version one", contact: "Synthetic contact", alternative: "Manual review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
  const json = v => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const draft = (n, revision = 0, version = 1) => `public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${place}',${json({ operationId: id(76500 + n), expectedRevision: revision, expectedSettingsVersion: 1, expectedLocationVersion: 1, values: { ...values, notice: `Version ${version}` } })},null,true)`;
  const q = (access = "owner", operationId = null, locationId = place) => ({ access, locationId, expectedWorkerId: access === "self" ? worker : null, operationId });
  const publish = (n, expectedRevision = 0, draftRevision = 1) => ({ action: "publish", operationId: id(76100 + n), expectedRevision, draftRevision, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Employee-visible release reason" });
  const withdraw = (n, rev = 1) => ({ ...publish(n, rev), action: "withdraw", draftRevision: null, reason: "Employee-visible withdrawal reason" });
  const ack = (n, expectedRevision = 1) => ({ action: "acknowledge", operationId: id(76200 + n), expectedRevision });
  const call = (query = q(), command = null, who = query.access === "self" ? auth : owner, allow = true, tenant = site) =>
    `public.faolla_attendance_location_notice_v1('${tenant}','${who}',${json(query)},${command ? json(command) : "null"},${allow})`;
  const denied = (code, expression) => `begin perform ${expression};raise exception 'unexpected acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = ["reads create neither releases nor employee acknowledgements", "owner publishes exact current draft without changing operational settings",
    "employees see immutable published notice but no unpublished drafts or fence coordinates", "explicit employee acknowledgement binds exact release and is idempotent",
    "new drafts do not silently change published content; withdrawal invalidates current acknowledgement",
    "republishing requires a fresh employee confirmation and old receipts remain recoverable", "pause blocks publication but permits withdrawal and existing receipts",
    "configuration changes invalidate notice readiness without rewriting historical text", "employee/role/current owner/binding/location permissions precede all receipt recovery",
    "strict protocol and cross-actor operation collisions are rejected", "both ledgers are service-only and append-only, with original data unchanged"];
  const result = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${read("202609300073_merchant_attendance_location_policy_drafts.sql")}
    ${read("202609300076_merchant_attendance_location_notices.sql")}
    insert into public.merchants(id,user_id) values('${site}','${owner}'),('99990008','${id(76999)}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone) values('${site}','UTC'),('99990008','UTC');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Notice self view',array['enterprise.view','attendance.self.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${auth}','notice@example.test','Synthetic employee','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${place}','${site}','Synthetic notice location','UTC',true),('${other}','${site}','Other place','UTC',true);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
      values('${worker}','${site}','${employee}','NOTICE','Synthetic worker','${place}',true);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${id(76008)}','${site}','${id(76009)}','notice-other@example.test','Another synthetic employee','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active)
      values('${id(76010)}','${site}','${id(76008)}','NOTICE-OTHER','Another synthetic worker','${place}',true);
    create temp table original_notice_settings as select * from public.merchant_attendance_settings;
    create temp table original_notice_locations as select * from public.merchant_attendance_locations;
    create temp table original_notice_events as select * from public.merchant_attendance_events;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->'current'='null'::jsonb and a->'canPublish'='false'::jsonb,'empty read';
      a:=${call(q("self"))};assert a->'draft'='null'::jsonb and a->'canAcknowledge'='false'::jsonb,'self empty read';
      ${denied("attendance_notice_unavailable", call(q("self"), ack(1)))}
      perform ${draft(1)};
      a:=${call()};assert a->'canPublish'='true'::jsonb,'publish available';
      ${denied("attendance_platform_paused", call(q(), publish(1), owner, false))}
      a:=${call(q(), publish(1))};assert a->'current'->>'revision'='1' and a->'current'->>'action'='publish' and a->'canPublish'='false'::jsonb,'first publication';
      b:=${call(q(), publish(1), owner, false)};assert b->'receipt'=a->'receipt','paused exact replay';
      ${denied("attendance_notice_unchanged", call(q(), publish(2, 1)))}
      ${denied("attendance_version_conflict", call(q(), publish(2)))}
      b:=${call(q("self"))};assert b->'draft'='null'::jsonb and b->'canAcknowledge'='true'::jsonb and b->'acknowledgedAt'='null'::jsonb,'GET not ACK';
      assert not(b->'current'->'values' ? 'latitude') and not(b->'current'->'values' ? 'longitude') and not(b ? 'actor_auth_user_id'),'self projection';
      a:=${call(q("self"), ack(1), auth, false)};assert a->'receipt'->>'revision'='1' and a->'canAcknowledge'='false'::jsonb,'explicit acknowledgement while paused';
      b:=${call(q("self"), ack(1))};assert b->'receipt'=a->'receipt','ack replay';
      ${denied("attendance_notice_already_acknowledged", call(q("self"), ack(2)))}
      ${denied("attendance_operation_conflict", call(q("self"), ack(1, 2)))}
      perform ${draft(2, 1, 2)};
      b:=${call(q("self"))};assert b->'current'->'values'->>'notice'='Version 1' and b->'acknowledgedAt'=a->'acknowledgedAt','unpublished edits invisible';
      b:=${call(q(), withdraw(3), owner, false)};assert b->'current'->>'action'='withdraw' and b->'noticeCurrent'='false'::jsonb,'withdraw while paused';
      b:=${call(q("self", id(76201)))};assert b->'receipt'=a->'receipt' and b->'acknowledgedAt'='null'::jsonb and b->'canAcknowledge'='false'::jsonb,'old ack not current';
      ${denied("attendance_notice_unavailable", call(q("self"), ack(3, 2)))}
      b:=${call(q(), publish(4, 2, 2))};assert b->'current'->>'revision'='3' and b->'current'->'values'->>'notice'='Version 2','republish';
      b:=${call(q("self", id(76201)))};assert b->'receipt'=a->'receipt' and b->'acknowledgedAt'='null'::jsonb and b->'canAcknowledge'='true'::jsonb,'new release needs confirmation';
      ${denied("attendance_version_conflict", call(q("self"), ack(4, 1)))}
      b:=${call(q("self"), ack(5, 3))};assert b->'receipt'->>'revision'='3','new confirmation';
      b:=${call({ ...q("self", id(76201)), expectedWorkerId: id(76010) }, null, id(76009))};
      assert b->'receipt'='null'::jsonb and b->'acknowledgedAt'='null'::jsonb and b->'canAcknowledge'='true'::jsonb,'another employee cannot inherit confirmation';
      ${denied("attendance_operation_conflict", call({ ...q("self"), expectedWorkerId: id(76010) }, ack(1), id(76009)))}
      ${denied("attendance_access_denied", call(q(), null, auth))}
      ${denied("attendance_access_denied", call(q("self"), null, owner))}
      ${denied("attendance_access_denied", call(q(), null, owner, true, "99990008"))}
      ${denied("attendance_location_denied", call(q("self", null, other)))}
      ${denied("attendance_worker_changed", call({ ...q("self"), expectedWorkerId: id(76998) }))}
      ${[{ ...q(), actor: auth }, { ...q(), expectedWorkerId: worker }, { ...q("self"), expectedWorkerId: null }].map(v => denied("attendance_invalid_request", call(v))).join("\n")}
      ${[{ ...publish(9, 3, 2), enabled: true }, { ...publish(9, 3, 2), expectedRevision: "3" }, { ...publish(9, 3, 2), reason: "a\nb" }, { ...withdraw(9, 3), draftRevision: 2 }].map(v => denied("attendance_invalid_request", call(q(), v))).join("\n")}
      ${denied("attendance_invalid_request", call(q("self"), { ...ack(9, 3), consent: true }))}
      ${denied("attendance_invalid_request", call(q("self"), publish(9, 3, 2)))}
    end $checks$;reset role;
    savepoint changed_config;
    update public.merchant_attendance_settings set version=2 where merchant_id='${site}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call(q("self"))};assert a->'noticeCurrent'='false'::jsonb and a->'canAcknowledge'='false'::jsonb,'settings change invalidates notice';
      a:=${call(q(), publish(1))};assert a->'receipt'->>'revision'='1','old publish receipt';
      ${denied("attendance_notice_unavailable", call(q("self"), ack(9, 3)))}
      a:=${call(q(), withdraw(9, 3), owner, false)};assert a->'current'->>'action'='withdraw','withdraw stale configuration';
    end $checks$;reset role;rollback to savepoint changed_config;
    savepoint bindings;
    update public.merchant_attendance_workers set default_location_id='${other}' where id='${worker}';
    set local role service_role;do $checks$ begin ${denied("attendance_location_denied", call(q("self", id(76201))))} end $checks$;reset role;
    rollback to savepoint bindings;
    savepoint inactive_worker;
    update public.merchant_attendance_workers set active=false where id='${id(76010)}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call({ ...q("self"), expectedWorkerId: id(76010) }, null, id(76009))};assert a->'canAcknowledge'='false'::jsonb and a->'current'->>'revision'='3','inactive worker read only';
      ${denied("attendance_notice_unavailable", call({ ...q("self"), expectedWorkerId: id(76010) }, ack(9, 3), id(76009)))}
    end $checks$;reset role;rollback to savepoint inactive_worker;
    savepoint inactive_employee;
    update public.merchant_enterprise_employees set status='disabled' where id='${employee}';
    set local role service_role;do $checks$ begin ${denied("attendance_access_denied", call(q("self", id(76201))))} end $checks$;reset role;rollback to savepoint inactive_employee;
    savepoint revoked;
    update public.merchant_enterprise_roles set status='archived' where id='${role}';
    set local role service_role;do $checks$ begin ${denied("attendance_access_denied", call(q("self", id(76201))))} end $checks$;reset role;rollback to savepoint revoked;
    savepoint transfer;
    update public.merchants set user_id='${id(76997)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';
    set local role service_role;do $checks$ declare a jsonb;begin
      ${denied("attendance_access_denied", call(q("owner", id(76101))))}
      a:=${call(q("owner", id(76101)), null, id(76997))};assert a->'receipt'='null'::jsonb and a->'current'->>'revision'='3','new owner not old receipt';
      ${denied("attendance_operation_conflict", call(q(), publish(1), id(76997)))}
    end $checks$;reset role;rollback to savepoint transfer;
    savepoint revision_ceiling;
    insert into public.merchant_attendance_location_notices(merchant_id,location_id,revision,action,draft_revision,operation_id,actor_auth_user_id,command,recorded_at)
      select merchant_id,location_id,9007199254740990,action,draft_revision,'${id(76996)}',actor_auth_user_id,
        command||jsonb_build_object('operationId','${id(76996)}','expectedRevision',9007199254740989),clock_timestamp()
      from public.merchant_attendance_location_notices where merchant_id='${site}' and location_id='${place}' and revision=3;
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call(q("self"), ack(99, 9007199254740990))};assert a->'receipt'->>'revision'='9007199254740990','largest supported release remains acknowledgeable';
    end $checks$;reset role;rollback to savepoint revision_ceiling;
    ${["anon", "authenticated"].map(r => `set local role ${r};do $checks$ begin perform ${call()};raise exception 'RPC accepted';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    ${["merchant_attendance_location_notices", "merchant_attendance_location_notice_acknowledgements"].map(table => `set local role service_role;do $checks$ begin
      begin perform 1 from public.${table};raise exception 'direct read';exception when insufficient_privilege then null;end;end $checks$;reset role;
      do $checks$ begin
      begin update public.${table} set command='{}';raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.${table};raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.${table}${table.endsWith("notices") ? ",public.merchant_attendance_location_notice_acknowledgements" : ""};raise exception 'truncate';exception when insufficient_privilege then null;end;end $checks$;`).join("\n")}
    do $checks$ begin
      assert (select count(*) from public.merchant_attendance_location_notices)=3 and (select count(*) from public.merchant_attendance_location_notice_acknowledgements)=2,'no duplicate releases or confirmations';
      ${["settings", "locations", "events"].map(t => `assert not exists((select * from original_notice_${t} except select * from public.merchant_attendance_${t}) union all (select * from public.merchant_attendance_${t} except select * from original_notice_${t})),'${t} unchanged';`).join("\n")}
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(result), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(e => { console.error(e); process.exitCode = 1; });
