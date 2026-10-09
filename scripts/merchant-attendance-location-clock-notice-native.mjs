import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";

function check({ root, query, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", owner = id(77001), auth = id(77002), employee = id(77003), role = id(77004), worker = id(77005), place = id(77006), other = id(77007);
  const json = v => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const values = { purpose: "Synthetic clock test", notice: "Published version", contact: "Synthetic contact", alternative: "Manual review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
  const cmd = (op, action = "clock_in", seq = 0, extra = {}) => ({ operationId: id(op), locationId: place, action, expectedSequence: seq,
    settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false, ...extra });
  const call = (command = null, { assertion = "null", op = null, who = auth, expectedWorker = worker, allow = true, require = false } = {}) =>
    `public.faolla_attendance_location_clock_v2('${site}','${who}','${expectedWorker}',${command ? json(command) : "null"},${op ? `'${id(op)}'::uuid` : "null"},${assertion},${allow},${require})`;
  const punch = (op, action = "clock_in", seq = 0, extra = {}, options = {}) => call(cmd(op, action, seq, extra), { assertion: "pg_temp.guarded_assertion()", ...options });
  const finish = (op, action, seq, extra = {}, options = {}) => call(cmd(op, action, seq, { noticeRevision: null, safeFinish: true, ...extra }), options);
  const noticeQuery = access => ({ access, locationId: place, expectedWorkerId: access === "self" ? worker : null, operationId: null });
  const notice = (access, command) => `public.faolla_attendance_location_notice_v1('${site}','${access === "self" ? auth : owner}',${json(noticeQuery(access))},${json(command)},true)`;
  const publish = (op, rev = 0) => notice("owner", { action: "publish", operationId: id(op), expectedRevision: rev, draftRevision: 1, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Synthetic publication" });
  const withdraw = (op, rev = 1) => notice("owner", { action: "withdraw", operationId: id(op), expectedRevision: rev, draftRevision: null, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Synthetic withdrawal" });
  const ack = (op, rev = 1) => notice("self", { action: "acknowledge", operationId: id(op), expectedRevision: rev });
  const reject = (code, expression) => `begin perform ${expression};raise exception 'unexpected guard acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = [
    "unpublished or unacknowledged notices deny writes without automatic activation or acknowledgement",
    "exact published and acknowledged version binds atomically to each new location event",
    "withdrawal and republishing invalidate old prepared operations, but not their already committed receipts",
    "raw fence edits and configuration changes invalidate notice readiness without modifying historical records",
    "safe finish closes an existing shift without location, new notice, employment or operational enablement",
    "safe finish preserves original location/timezone after reassignment and cannot start shifts or breaks",
    "break finish and clock out remain two explicit ordered actions; original paid break flag is unchanged",
    "safe finish receipts recover exactly after pause; altered commands cannot impersonate an old receipt",
    "identity, role revocation, worker rebinding and foreign auth remain hard denials",
    "view-only role can recover but cannot finish; no ownership inheritance across employee replacement",
    "service v1 bypass and direct evidence-table access are denied; v2 is service only",
    "invalid protocol, version ceiling and locationless assertions are rejected",
    "notice-link insertion failure rolls back both event and minimized location summary",
    "ordinary web still denies geofence bypass and all added evidence is append-only",
  ];
  const result = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300071_merchant_attendance_location_precheck.sql", "202609300072_merchant_attendance_location_clock.sql", "202609300073_merchant_attendance_location_policy_drafts.sql", "202609300076_merchant_attendance_location_notices.sql", "202609300077_merchant_attendance_location_clock_notice_guard.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled,location_clock_enabled,web_break_paid) values('${site}','UTC',true,true,true,true);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic guarded clock',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${employee}','${site}','${auth}','guard@example.test','Synthetic employee','${role}','active');
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters)
      values('${place}','${site}','Synthetic place','Europe/Madrid',true,37.3,-5.9,100),('${other}','${site}','Other place','UTC',true,37.3,-5.9,100);
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${employee}','GUARD','Synthetic worker','${place}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01');
    create function pg_temp.guarded_assertion() returns jsonb language plpgsql as $f$ declare s jsonb; begin
      s:=${call()};return jsonb_build_object('policyFingerprint',s->>'internalPolicyFingerprint','algorithmVersion',1,'reason','inside',
        'capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'accuracyMeters',10,'distanceMeters',0);end;$f$;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->'channelEnabled'='false'::jsonb and a->'noticeGate'->>'reason'='unpublished','no notice';
      ${reject("attendance_notice_required", punch(77101))}
      ${reject("attendance_safe_finish_unavailable", finish(77199, "clock_out", 0))}
      perform public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${place}',${json({ operationId: id(77500), expectedRevision: 0, expectedSettingsVersion: 1, expectedLocationVersion: 1, values })},null,true);
      perform ${publish(77501)};
      a:=${call()};assert a->'noticeGate'->>'reason'='acknowledgement_required','publication not ack';
      ${reject("attendance_notice_required", punch(77101))}
      perform ${ack(77502)};
      a:=${call()};assert a->'noticeGate'->'ready'='true'::jsonb and a->'channelEnabled'='true'::jsonb,'ready';
      a:=${punch(77101)};assert a->'receiptGate'->>'noticeRevision'='1' and a->'receiptGate'->'safeFinish'='false'::jsonb,'linked notice';
      assert a->'state'->>'status'='working' and a->'finish'->>'locationId'='${place}','finish available after start';
      b:=${punch(77101)};assert b->'replayed'='true'::jsonb and b->'receipt'=a->'receipt','exact replay';
      ${reject("attendance_operation_conflict", punch(77101, "clock_in", 0, { noticeRevision: 3 }))}
      ${reject("attendance_operation_conflict", punch(77101, "clock_in", 0, { expectedSequence: 1 }))}
      ${reject("attendance_invalid_request", finish(77199, "clock_in", 1))}
      ${reject("attendance_invalid_request", finish(77199, "break_start", 1))}
    end $checks$;reset role;
    savepoint changed;
    update public.merchant_attendance_locations set latitude=38 where id='${place}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call()};assert a->'noticeGate'->>'reason'='fence_mismatch' and a->'channelEnabled'='false'::jsonb,'raw fence guard';
      ${reject("attendance_notice_required", punch(77102, "clock_out", 1))}
      a:=${finish(77102, "clock_out", 1)};assert a->'state'->>'status'='off' and a->'finish'='null'::jsonb,'fence-change finish';
    end $checks$;reset role;rollback to savepoint changed;
    savepoint withdrawn;
    set local role service_role;do $checks$ declare a jsonb;b jsonb;prepared_assertion jsonb;begin
      prepared_assertion:=pg_temp.guarded_assertion();
      perform ${withdraw(77503)};
      a:=${call()};assert a->'noticeGate'->>'reason'='withdrawn' and a->'finish'<>'null'::jsonb,'withdrawn but finish allowed';
      ${reject("attendance_notice_required", punch(77102, "clock_out", 1))}
      ${reject("attendance_notice_required", punch(77102, "clock_out", 1, {}, { assertion: "prepared_assertion" }))}
      b:=${punch(77101)};assert b->'receiptGate'->>'noticeRevision'='1' and b->'replayed'='true'::jsonb,'historical receipt';
      perform ${publish(77504, 2)};
      ${reject("attendance_notice_required", punch(77102, "clock_out", 1, { noticeRevision: 3 }))}
      perform ${ack(77505, 3)};
      ${reject("attendance_notice_required", punch(77102, "clock_out", 1))}
      a:=${punch(77102, "clock_out", 1, { noticeRevision: 3 })};assert a->'receiptGate'->>'noticeRevision'='3','new revision';
    end $checks$;reset role;rollback to savepoint withdrawn;
    savepoint disabled;
    update public.merchant_attendance_settings set enabled=false,web_clock_enabled=false,location_clock_enabled=false,version=9 where merchant_id='${site}';
    update public.merchant_attendance_workers set active=false,default_location_id='${other}',version=9 where id='${worker}';
    update public.merchant_attendance_locations set active=false,version=9,latitude=null,longitude=null,radius_meters=null where id='${place}';
    update public.merchant_attendance_employment_periods set ends_on='2000-01-02' where worker_id='${worker}';
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      a:=${call(null, { allow: false })};assert a->'finish'->>'locationId'='${place}' and a->>'locationId'='${other}','original place';
      ${reject("attendance_location_denied", finish(77102, "clock_out", 1, { locationId: other }))}
      a:=${finish(77102, "clock_out", 1, {}, { allow: false })};assert a->'receipt'->>'timeZone'='Europe/Madrid' and a->'receipt'->>'locationId'='${place}','original place and zone';
      assert a->'noticeGate'->>'reason'='unpublished' and a->'finish'='null'::jsonb,'closed shift no longer claims an open former-location shift';
      assert a->'locationResult'->>'reason'='not_provided' and a->'locationResult'->'capturedAt'='null'::jsonb and a->'receiptGate'->'safeFinish'='true'::jsonb,'locationless not verified';
      b:=${finish(77102, "clock_out", 1, {}, { allow: false })};assert b->'receipt'=a->'receipt' and b->'replayed'='true'::jsonb,'paused safe replay';
      ${reject("attendance_safe_finish_unavailable", finish(77103, "clock_out", 2))}
    end $checks$;reset role;rollback to savepoint disabled;
    savepoint breaks;
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${punch(77102, "break_start", 1)};assert a->'receipt'->'breakPaid'='true'::jsonb,'paid break';
      perform ${withdraw(77503)};
      ${reject("attendance_break_must_end", finish(77103, "clock_out", 2))}
      a:=${finish(77103, "break_end", 2, {}, { allow: false })};assert a->'state'->>'status'='working' and a->'finish'<>'null'::jsonb,'explicit break end';
      a:=${finish(77104, "clock_out", 3, {}, { allow: false })};assert a->'state'->>'status'='off','then clock out';
    end $checks$;reset role;
    do $checks$ begin assert (select break_paid from public.merchant_attendance_events where operation_id='${id(77102)}')=true,'original break retained';end $checks$;
    rollback to savepoint breaks;
    ${[
      ["merchant_enterprise_employees", "status='disabled'", `id='${employee}'`, "attendance_access_denied"],
      ["merchant_enterprise_roles", "status='archived'", `id='${role}'`, "attendance_access_denied"],
    ].map(([table, changes, where, code]) => `savepoint revoked;update public.${table} set ${changes} where ${where};set local role service_role;do $checks$ begin
      ${reject(code, call(null, { op: 77101 }))}${reject(code, finish(77102, "clock_out", 1))}end $checks$;reset role;rollback to savepoint revoked;`).join("\n")}
    set local role service_role;do $checks$ begin
      ${reject("attendance_access_denied", finish(77102, "clock_out", 1, {}, { who: id(77998) }))}
      ${reject("attendance_worker_changed", finish(77102, "clock_out", 1, {}, { expectedWorker: id(77998) }))}
      ${reject("attendance_invalid_request", finish(77102, "clock_out", 1, {}, { assertion: "pg_temp.guarded_assertion()" }))}
      ${reject("attendance_invalid_request", punch(77102, "clock_out", 1, { noticeRevision: 9007199254740991 }))}
      ${reject("attendance_invalid_request", punch(77102, "clock_out", 1, { noticeRevision: null }))}
      ${reject("attendance_invalid_request", call({ ...cmd(77102), latitude: 0 }))}
      ${reject("attendance_sequence_conflict", finish(77102, "clock_out", 0))}
      ${reject("attendance_location_verification_required", `public.faolla_attendance_self_v1('${site}','${auth}',${json({ expectedWorkerId: worker, operationId: id(77102), action: "clock_out", locationId: place, expectedSequence: 1 })},null)`)}
      begin perform public.faolla_attendance_location_clock_v1('${site}','${auth}','${worker}');raise exception 'v1 bypass';exception when insufficient_privilege then null;end;
      begin perform 1 from public.merchant_attendance_location_clock_notices;raise exception 'direct read';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    savepoint view_only;
    update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.self.view'] where id='${role}';
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call(null, { op: 77101 })};assert a->'receipt'<>'null'::jsonb and a->'finish'='null'::jsonb,'view only recovery';
      ${reject("attendance_access_denied", finish(77102, "clock_out", 1))}
    end $checks$;reset role;rollback to savepoint view_only;
    savepoint replaced;
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${id(77996)}','${site}','${id(77997)}','replacement@example.test','Replacement','${role}','active');
    update public.merchant_attendance_workers set employee_id='${id(77996)}' where id='${worker}';
    set local role service_role;do $checks$ begin
      ${reject("attendance_access_denied", call(null, { who: id(77997), op: 77101 }))}
      ${reject("attendance_access_denied", finish(77102, "clock_out", 1, {}, { who: id(77997) }))}
      ${reject("attendance_access_denied", punch(77102, "clock_out", 1, {}, { who: id(77997) }))}
    end $checks$;reset role;rollback to savepoint replaced;
    savepoint failing_link;
    create function pg_temp.reject_clock_notice_link() returns trigger language plpgsql as $f$ begin raise exception 'synthetic_link_failure';end;$f$;
    create trigger synthetic_link_failure before insert on public.merchant_attendance_location_clock_notices for each row execute function pg_temp.reject_clock_notice_link();
    set local role service_role;do $checks$ begin
      ${reject("synthetic_link_failure", punch(77102, "clock_out", 1))}
      ${reject("synthetic_link_failure", finish(77102, "clock_out", 1))}
    end $checks$;reset role;
    do $checks$ begin assert (select count(*) from public.merchant_attendance_events where worker_id='${worker}')=1 and (select count(*) from public.merchant_attendance_location_results)=1,'atomic rollback';end $checks$;
    rollback to savepoint failing_link;
    ${["anon", "authenticated"].map(r => `set local role ${r};do $checks$ begin perform ${call()};raise exception 'public v2';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    do $checks$ begin
      begin update public.merchant_attendance_location_clock_notices set command='{}';raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_clock_notices;raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_clock_notices;raise exception 'truncate';exception when insufficient_privilege then null;end;
    end $checks$;
    select '${JSON.stringify(labels)}'::jsonb;rollback;`);
  assert.deepEqual(JSON.parse(result), labels); labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(e => { console.error(e); process.exitCode = 1; });
