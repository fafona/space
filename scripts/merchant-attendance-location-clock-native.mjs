import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";

function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", foreign = "99990008", auth = id(72001), employee = id(72002), role = id(72003), worker = id(72004), place = id(72005);
  const json = value => `'${JSON.stringify(value)}'::jsonb`;
  const command = (op, action = "clock_in", expectedSequence = 0, extra = {}) => json({ operationId: id(op), locationId: place, action, expectedSequence, settingsVersion: 1, workerVersion: 1, locationVersion: 1, ...extra });
  const call = (cmd = "null", options = {}) => `public.faolla_attendance_location_clock_v1('${options.site ?? site}','${options.auth ?? auth}','${options.worker ?? worker}',${cmd},${options.op ? `'${id(options.op)}'::uuid` : "null"},${options.assertion ?? "null"},${options.allow ?? "true"},${options.require ?? "false"})`;
  const reject = (code, statement) => `begin perform ${statement};raise exception 'unexpected location clock acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const evidence = (reason = "inside", seconds = 0) => `pg_temp.location_assertion('${reason}',${seconds})`;
  const punch = (op, action, seq, reason = "inside", seconds = 0, options = {}) => call(command(op, action, seq), { assertion: evidence(reason, seconds), ...options });
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = [
    "atomic location clock is default off and introduces no grants for existing employees",
    "server time and sequence are shared with original web events; location summary matches event in one transaction",
    "inside/outside/uncertain and explicit failures record facts without fabricated verification",
    "age/future classification is recomputed with database time, not trusted from an earlier check",
    "lost-response retry returns original event and summary, with current state separately reported",
    "paused or changed policies do not erase an authorized previous receipt",
    "current employee/role revocation denies access, while view-only role can read but not POST",
    "foreign tenant/auth/worker/operation cannot target another employee or reuse ordinary web receipts",
    "settings/worker/location version mismatch and unversioned fence edits block new writes",
    "invalid or client-shaped assertions cannot become committed evidence",
    "platform pause denies new starts but permits closing and receipt replay",
    "ordinary web still rejects geofence bypass and every action obeys the original state machine",
    "failure in summary insert rolls back the preceding event insert",
    "location results reject direct role access and all update/delete/truncate attempts",
    "worker/place/employment/channel disablement denies new writes without hiding authorized recovery",
    "all successful writes have one summary; rejected writes leave no event or summary",
  ];
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${read("202609300071_merchant_attendance_location_precheck.sql")}
    ${read("202609300072_merchant_attendance_location_clock.sql")}
    insert into public.merchants(id) values('${site}'),('${foreign}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',true,true),('${foreign}','UTC',true,true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic atomic location',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status)
      values('${employee}','${site}','${auth}','location-clock@example.test','Synthetic atomic location','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters)
      values('${place}','${site}','Synthetic atomic place','UTC',true,37.3,-5.9,100);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,active,default_location_id)
      values('${worker}','${site}','${employee}','LOC-CLOCK','Synthetic atomic worker',true,'${place}');
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    create function pg_temp.location_assertion(reason text,offset_seconds integer default 0) returns jsonb language plpgsql as $fixture$
    declare snapshot jsonb;begin
      snapshot:=${call()};
      return jsonb_build_object('policyFingerprint',snapshot->>'internalPolicyFingerprint','algorithmVersion',1,'reason',reason,
        'capturedAt',case when reason in ('inside','outside','uncertain') then to_char((clock_timestamp()+offset_seconds*interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end,
        'accuracyMeters',case when reason in ('inside','outside','uncertain') then 10 else null end,
        'distanceMeters',case when reason='inside' then 0 when reason='outside' then 200 when reason='uncertain' then 95 else null end);
    end;$fixture$;
    do $checks$ declare r jsonb;begin
      assert not exists(select 1 from public.merchant_attendance_settings where location_clock_enabled),'closed defaults';
      r:=${call()};assert r->'channelEnabled'='false'::jsonb,'default read';
      ${reject("attendance_location_clock_disabled", punch(72101, "clock_in", 0))}
    end $checks$;
    update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id='${site}';
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;begin
      a:=${punch(72101, "clock_in", 0)};assert a->'state'->>'sequence'='1' and a->'state'->>'status'='working','first state';
      assert a->'receipt'->>'id'=a->'locationResult'->>'eventId','event summary pair';
      assert a->'locationResult'->>'reason'='inside' and a->'locationResult'->'needsReview'='false'::jsonb,'range';
      assert abs(extract(epoch from (clock_timestamp()-(a->'receipt'->>'occurredAt')::timestamptz)))<10,'server clock';
      ${reject("attendance_already_clocked_in", punch(72199, "clock_in", 1))}
      ${reject("attendance_sequence_conflict", punch(72199, "clock_out", 0))}
      b:=${punch(72102, "break_start", 1, "uncertain")};assert b->'receipt'->'breakPaid'='false'::jsonb,'server break policy';
      assert b->'locationResult'->'needsReview'='true'::jsonb,'uncertain review';
      ${reject("attendance_break_must_end", punch(72199, "clock_out", 2))}
      b:=${punch(72103, "break_end", 2, "denied")};assert b->'locationResult'->'capturedAt'='null'::jsonb,'no fabricated sample';
      b:=${punch(72104, "clock_out", 3, "inside", -61)};assert b->'locationResult'->>'reason'='stale','commit freshness';
      b:=${punch(72101, "clock_in", 0, "inside", 600)};
      assert b->'replayed'='true'::jsonb and b->'receipt'=a->'receipt' and b->'locationResult'=a->'locationResult','exact old receipt';
      assert b->'state'->>'sequence'='4' and b->'state'->>'status'='off','latest state not old replay state';
      ${reject("attendance_operation_conflict", punch(72101, "clock_out", 4))}
      b:=${call("null", { op: 72101 })};assert b->'receipt'=a->'receipt','GET recovery';
      b:=${call("null", { op: 72999 })};assert b->'receipt'='null'::jsonb and b->'locationResult'='null'::jsonb,'unknown operation';
      ${reject("attendance_access_denied", call(command(72199, "clock_in", 4), { site: foreign }))}
      ${reject("attendance_access_denied", call(command(72199, "clock_in", 4), { auth: id(72999) }))}
      ${reject("attendance_worker_changed", call(command(72199, "clock_in", 4), { worker: id(72999) }))}
      ${reject("attendance_location_denied", call(command(72199, "clock_in", 4, { locationId: id(72999) })))}
    end $checks$;reset role;

    savepoint disabled_recovery;
    update public.merchant_attendance_settings set enabled=false,web_clock_enabled=false,location_clock_enabled=false,version=9 where merchant_id='${site}';
    update public.merchant_attendance_workers set active=false,version=9 where id='${worker}';
    update public.merchant_attendance_locations set active=false,version=9 where id='${place}';
    update public.merchant_attendance_employment_periods set ends_on='2000-01-02' where worker_id='${worker}';
    do $checks$ declare r jsonb;begin
      r:=${call(command(72101), { allow: "false" })};assert r->'replayed'='true'::jsonb and r->'channelEnabled'='false'::jsonb,'recover after all pauses';
      assert r->'locationResult'->>'settingsVersion'='1' and r->'policy'->>'settingsVersion'='9','snapshot and current policy separate';
    end $checks$;rollback to savepoint disabled_recovery;

    ${[
      ["merchant_enterprise_employees", "id", employee, "status='disabled'", "status='active'", "attendance_access_denied"],
      ["merchant_enterprise_roles", "id", role, "status='archived'", "status='active'", "attendance_access_denied"],
      ["merchant_attendance_workers", "id", worker, "active=false", "active=true", "attendance_access_denied"],
      ["merchant_attendance_locations", "id", place, "active=false", "active=true", "attendance_location_denied"],
      ["merchant_attendance_employment_periods", "worker_id", worker, "ends_on='2000-01-02'", "ends_on=null", "attendance_not_employed"],
      ["merchant_attendance_settings", "merchant_id", site, "enabled=false", "enabled=true", "attendance_disabled"],
      ["merchant_attendance_settings", "merchant_id", site, "web_clock_enabled=false", "web_clock_enabled=true", "attendance_web_disabled"],
    ].map(([table, key, value, change, restore, code]) => `update public.${table} set ${change} where ${key}='${value}';
      do $checks$ begin ${reject(code, call(command(72199, "clock_in", 4)))}end $checks$;update public.${table} set ${restore} where ${key}='${value}';`).join("\n")}
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    do $checks$ declare r jsonb;begin
      r:=${call("null", { op: 72101 })};assert r->'receipt'->>'operationId'='${id(72101)}','view only recovery';
      ${reject("attendance_access_denied", call(command(72101)))}
      ${reject("attendance_access_denied", call("null", { op: 72101, require: "true" }))}
    end $checks$;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view','attendance.self.clock'] where id='${role}';

    do $checks$ begin
      ${["settingsVersion", "workerVersion", "locationVersion"].map(key => reject("attendance_location_policy_changed", call(command(72199, "clock_in", 4, { [key]: 2 }), { assertion: evidence() }))).join("\n")}
      ${["null", `'{}'::jsonb`, `${evidence()}||'{"latitude":37.3}'::jsonb`, `jsonb_set(${evidence()},'{algorithmVersion}','2'::jsonb)`,
        `jsonb_set(${evidence()},'{reason}','"future"'::jsonb)`, `jsonb_set(${evidence()},'{accuracyMeters}','-1'::jsonb)`,
        `jsonb_set(${evidence()},'{distanceMeters}','1.5'::jsonb)`, `jsonb_set(${evidence()},'{capturedAt}','"not-a-time"'::jsonb)`,
        `jsonb_set(${evidence("denied")},'{accuracyMeters}','0'::jsonb)`]
        .map(assertion => reject("attendance_invalid_request", call(command(72199, "clock_in", 4), { assertion }))).join("\n")}
      ${reject("attendance_location_policy_changed", call(command(72199, "clock_in", 4), { assertion: `jsonb_set(${evidence()},'{policyFingerprint}','"${"0".repeat(32)}"'::jsonb)` }))}
    end $checks$;
    savepoint changed_fence;
    create temporary table prepared_assertion as select ${evidence()} value;
    update public.merchant_attendance_locations set latitude=38 where id='${place}';
    do $checks$ begin ${reject("attendance_location_policy_changed", call(command(72199, "clock_in", 4), { assertion: "(select value from prepared_assertion)" }))}end $checks$;
    rollback to savepoint changed_fence;

    savepoint pause_and_classification;
    do $checks$ declare r jsonb;begin
      ${reject("attendance_platform_paused", punch(72105, "clock_in", 4, "inside", 0, { allow: "false" }))}
      r:=${punch(72105, "clock_in", 4, "outside")};assert r->'locationResult'->>'reason'='outside' and r->'locationResult'->'needsReview'='true'::jsonb,'outside fact review';
      ${reject("attendance_platform_paused", punch(72106, "break_start", 5, "inside", 0, { allow: "false" }))}
      r:=${punch(72106, "clock_out", 5, "inside", 6, { allow: "false" })};assert r->'locationResult'->>'reason'='future','locked server future check';
      r:=${punch(72101, "clock_in", 0, "denied", 0, { allow: "false" })};assert r->'replayed'='true'::jsonb,'paused replay';
    end $checks$;rollback to savepoint pause_and_classification;

    savepoint failing_summary;
    create function pg_temp.reject_location_summary() returns trigger language plpgsql as $fixture$ begin raise exception 'synthetic_summary_failure';end;$fixture$;
    create trigger synthetic_summary_failure before insert on public.merchant_attendance_location_results for each row execute function pg_temp.reject_location_summary();
    do $checks$ begin
      ${reject("synthetic_summary_failure", punch(72199, "clock_in", 4))}
      assert not exists(select 1 from public.merchant_attendance_events where worker_id='${worker}' and operation_id='${id(72199)}'),'event rollback after summary failure';
      assert (select count(*) from public.merchant_attendance_location_results)=4,'summary count unchanged';
    end $checks$;rollback to savepoint failing_summary;

    do $checks$ begin
      ${reject("attendance_location_verification_required", `public.faolla_attendance_self_v1('${site}','${auth}',${json({ expectedWorkerId: worker, operationId: id(72199), locationId: place, action: "clock_in", expectedSequence: 4 })},null)`)}
    end $checks$;
    savepoint ordinary_collision;
    update public.merchant_attendance_locations set latitude=null,longitude=null,radius_meters=null where id='${place}';
    do $checks$ declare r jsonb;begin
      perform public.faolla_attendance_self_v1('${site}','${auth}',${json({ expectedWorkerId: worker, operationId: id(72199), locationId: place, action: "clock_in", expectedSequence: 4 })},null);
      ${reject("attendance_operation_conflict", call(command(72199, "clock_in", 4)))}
      ${reject("attendance_operation_conflict", call("null", { op: 72199, require: "true" }))}
      r:=${call("null", { op: 72199 })};assert r->'receipt'='null'::jsonb,'ordinary event is not a location receipt';
    end $checks$;rollback to savepoint ordinary_collision;

    ${["anon", "authenticated"].map(roleName => `set local role ${roleName};do $checks$ begin perform ${call()};raise exception 'unexpected RPC access';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    set local role service_role;do $checks$ begin
      begin perform 1 from public.merchant_attendance_location_results;raise exception 'direct summary read';exception when insufficient_privilege then null;end;
      begin update public.merchant_attendance_events set source='kiosk';raise exception 'direct event write';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    do $checks$ begin
      begin update public.merchant_attendance_location_results set needs_review=false;raise exception 'rewrite summary';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_results;raise exception 'delete summary';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_results;raise exception 'truncate summary';exception when insufficient_privilege then null;end;
      assert (select count(*) from public.merchant_attendance_events where worker_id='${worker}')=4,'exact events';
      assert (select count(*) from public.merchant_attendance_location_results)=4,'exact summaries';
      assert (select bool_and(e.actor_employee_id='${employee}' and e.merchant_id='${site}') from public.merchant_attendance_location_results l join public.merchant_attendance_events e on e.id=l.event_id),'actor binding';
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(output), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(error => { console.error(error); process.exitCode = 1; });
