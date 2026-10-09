// Run with node --import tsx; all SQL and schema changes roll back in the owned synthetic cluster.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import setupContract from "../src/lib/merchantAttendanceLocationSetup.ts";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
function check({ root, query, pass }) {
  const { parseLocationSetupResult } = setupContract;
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const site = "99990007", owner = id(78001), auth = id(78002), employee = id(78003), role = id(78004), worker = id(78005), place = id(78006), other = id(78007);
  const json = v => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const values = { purpose: "Synthetic setup", notice: "Synthetic published text", contact: "Synthetic owner", alternative: "Manual review", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
  const cmd = (op, action = "prepare", extra = {}) => ({ action, operationId: id(op), expectedSettingsVersion: 1, expectedLocationVersion: 1, expectedChannelVersion: 1, draftRevision: action === "prepare" ? 1 : null, reason: "Internal setup reason", ...extra });
  const call = (c = null, { loc = place, who = owner, allow = true, op = null } = {}) => `public.faolla_attendance_location_setup_v1('${site}','${who}','${loc}',${c ? json(c) : "null"},${op ? `'${id(op)}'::uuid` : "null"},${allow})`;
  const draft = (op, rev = 0, lv = 1, loc = place, v = values) => `public.faolla_attendance_location_policy_draft_v1('${site}','${owner}','${loc}',${json({ operationId: id(op), expectedRevision: rev, expectedSettingsVersion: 1, expectedLocationVersion: lv, values: v })},null,true)`;
  const publish = (op, rev = 0, dr = 1, lv = 1, loc = place) => `public.faolla_attendance_location_notice_v1('${site}','${owner}',${json({ access: "owner", locationId: loc, expectedWorkerId: null, operationId: null })},${json({ action: "publish", operationId: id(op), expectedRevision: rev, draftRevision: dr, expectedSettingsVersion: 1, expectedLocationVersion: lv, reason: "Public notice" })},true)`;
  const ack = (op, loc = place, who = auth, w = worker) => `public.faolla_attendance_location_notice_v1('${site}','${who}',${json({ access: "self", locationId: loc, expectedWorkerId: w, operationId: null })},${json({ action: "acknowledge", operationId: id(op), expectedRevision: 1 })},true)`;
  const clockCmd = (op, action = "clock_in", seq = 0, safe = false, lv = 2) => ({ operationId: id(op), locationId: place, action, expectedSequence: seq, settingsVersion: 1, workerVersion: 1, locationVersion: lv, noticeRevision: safe ? null : 1, safeFinish: safe });
  const clock = (c = null, assertion = "null", who = auth, w = worker) => `public.faolla_attendance_location_clock_v2('${site}','${who}','${w}',${c ? json(c) : "null"},null,${assertion},true,false)`;
  const basicClock = (op, action, sequence) => `public.faolla_attendance_self_v1('${site}','${auth}',${json({ operationId: id(op), locationId: place, expectedWorkerId: worker, action, expectedSequence: sequence })},null)`;
  const reject = (code, expression) => `begin perform ${expression};raise exception 'unexpected setup acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const read = name => readFileSync(path.join(root, "scripts/supabase-migrations", name), "utf8").replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const labels = ["owner-only reads are inert and setup never grants employee permissions", "prepare atomically applies one fence and appends a rebased draft, not a publication",
    "publication and self acknowledgement remain separate before guarded clock becomes ready", "channel enable and pause preserve notice/settings/location versions and existing acknowledgements",
    "pause remains available with stale config or platform paused but is channel-CAS protected", "an open shift can safely finish after pause or later fence preparation",
    "preparing a new fence invalidates only that location and preserves another location's working notice", "receipt replay is actor/target/full-command bound, even after current state changes",
    "replacing the owner denies old owner access and hides their operation receipts from the new owner", "malformed requests, missing publication, stale versions and unchanged commands are rejected",
    "audit insert failure rolls back fence, rebased draft and channel changes together", "setup audit is service-only and immutable; raw events are never rewritten",
    "real SQL responses survive server whitelist plus JSON and client parsing",
    "open ordinary web shifts block fence preparation until explicit break-end and clock-out, even for inactive workers"];
  const output = query(`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300071_merchant_attendance_location_precheck.sql", "202609300072_merchant_attendance_location_clock.sql", "202609300073_merchant_attendance_location_policy_drafts.sql", "202609300076_merchant_attendance_location_notices.sql", "202609300077_merchant_attendance_location_clock_notice_guard.sql", "202609300078_merchant_attendance_location_setup.sql"].map(read).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','UTC',true,true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${place}','${site}','Synthetic A','Europe/Madrid',true);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active,latitude,longitude,radius_meters) values('${other}','${site}','Synthetic B','UTC',true,37.3,-5.9,100);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic self',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values
      ('${employee}','${site}','${auth}','setup-a@example.test','Synthetic A','${role}','active'),('${id(78008)}','${site}','${id(78009)}','setup-b@example.test','Synthetic B','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values
      ('${worker}','${site}','${employee}','SETUP-A','A','${place}',true),('${id(78010)}','${site}','${id(78008)}','SETUP-B','B','${other}',true);
    insert into public.merchant_attendance_employment_periods(merchant_id,worker_id,starts_on) values('${site}','${worker}','2000-01-01'),('${site}','${id(78010)}','2000-01-01');
    create temp table setup_contracts(op uuid,value jsonb);grant insert,select on setup_contracts to service_role;
    create function pg_temp.setup_assertion() returns jsonb language plpgsql as $f$ declare s jsonb;begin s:=${clock()};return jsonb_build_object('policyFingerprint',s->>'internalPolicyFingerprint','algorithmVersion',1,'reason','not_provided','capturedAt',null,'accuracyMeters',null,'distanceMeters',null);end;$f$;
    savepoint ordinary_shift;
    set local role service_role;do $checks$ declare a jsonb;begin
      perform ${draft(78500)};perform ${basicClock(78090, "clock_in", 0)};
      a:=${call()};assert a->'openWebShift'='true'::jsonb and a->'canPrepare'='false'::jsonb,'plain shift prevents fence';
      ${reject("attendance_setup_open_web_shift", call(cmd(78094)))}
      perform ${basicClock(78091, "break_start", 1)};
      ${reject("attendance_setup_open_web_shift", call(cmd(78094)))}
    end $checks$;reset role;
    update public.merchant_attendance_workers set active=false where id='${worker}';
    set local role service_role;do $checks$ begin
      ${reject("attendance_setup_open_web_shift", call(cmd(78094)))}
    end $checks$;reset role;
    update public.merchant_attendance_workers set active=true where id='${worker}';
    set local role service_role;do $checks$ declare a jsonb;begin
      perform ${basicClock(78092, "break_end", 2)};
      ${reject("attendance_setup_open_web_shift", call(cmd(78094)))}
      perform ${basicClock(78093, "clock_out", 3)};
      a:=${call()};assert a->'openWebShift'='false'::jsonb and a->'canPrepare'='true'::jsonb,'closed plain shift unblocks';
      a:=${call(cmd(78094))};assert a->'location'->>'version'='2','prepare after closure';
    end $checks$;reset role;rollback to savepoint ordinary_shift;
    set local role service_role;
    do $checks$ declare a jsonb;b jsonb;begin
      a:=${call()};assert a->'channelEnabled'='false'::jsonb and a->'draft'='null'::jsonb and a->'canPrepare'='false'::jsonb,'initial inert';
      insert into setup_contracts values(null,a);
      ${reject("attendance_access_denied", call(null, { who: auth }))}
      ${reject("attendance_setup_not_ready", call(cmd(78100, "enable")))}
      ${reject("attendance_platform_paused", call(cmd(78100), { allow: false }))}
      perform ${draft(78501)};perform ${draft(78502, 0, 1, other)};perform ${publish(78503, 0, 1, 1, other)};perform ${ack(78504, other, id(78009), id(78010))};
      a:=${call()};assert a->'canPrepare'='true'::jsonb and a->'canEnable'='false'::jsonb,'prepare allowed';
      ${reject("attendance_version_conflict", call(cmd(78101, "prepare", { expectedLocationVersion: 2 })))}
      a:=${call(cmd(78101))};assert a->'location'->>'version'='2' and a->'draft'->>'revision'='2' and a->'draft'->>'locationVersion'='2','rebased';
      assert a->>'settingsVersion'='1' and a->>'channelVersion'='1' and a->'notice'='null'::jsonb and a->'channelEnabled'='false'::jsonb,'not published or activated';
      insert into setup_contracts values('${id(78101)}',a);
      b:=${call(cmd(78101), { allow: false })};assert b->'receipt'=a->'receipt','prepare paused replay';
      ${reject("attendance_operation_conflict", call(cmd(78101, "prepare", { reason: "Changed reason" })))}
      ${reject("attendance_setup_unchanged", call(cmd(78102, "prepare", { expectedLocationVersion: 2, draftRevision: 2 })))}
      ${reject("attendance_setup_not_ready", call(cmd(78102, "enable", { expectedLocationVersion: 2 })))}
      perform ${publish(78505, 0, 2, 2)};perform ${ack(78506)};
      a:=${call(cmd(78102, "enable", { expectedLocationVersion: 2 }))};assert a->'channelEnabled'='true'::jsonb and a->>'channelVersion'='2' and a->'noticeMatches'='true'::jsonb,'enabled';
      insert into setup_contracts values('${id(78102)}',a);
      b:=${clock(clockCmd(78601), "pg_temp.setup_assertion()")};assert b->'receiptGate'->>'noticeRevision'='1','end-to-end guarded write';
      a:=${call(cmd(78103, "pause", { expectedLocationVersion: 999, expectedSettingsVersion: 999, expectedChannelVersion: 2 }), { allow: false })};
      assert a->'channelEnabled'='false'::jsonb and a->>'channelVersion'='3' and a->'noticeMatches'='true'::jsonb,'paused without invalidating notice';
      insert into setup_contracts values('${id(78103)}',a);
      b:=${clock()};assert b->'channelEnabled'='false'::jsonb and b->'finish'<>'null'::jsonb,'paused with finish';
      ${reject("attendance_location_clock_disabled", clock(clockCmd(78602, "clock_out", 1), "pg_temp.setup_assertion()"))}
      ${reject("attendance_version_conflict", call(cmd(78199, "pause", { expectedChannelVersion: 2 })))}
      a:=${call(cmd(78104, "enable", { expectedLocationVersion: 2, expectedChannelVersion: 3 }))};assert a->'noticeMatches'='true'::jsonb and a->>'channelVersion'='4','resume old notice';
      b:=${clock()};assert b->'channelEnabled'='true'::jsonb,'no duplicate employee acknowledgement';
      b:=${call(cmd(78102, "enable", { expectedLocationVersion: 2 }), { allow: false })};assert b->>'channelVersion'='4' and b->'receipt'->'after'->>'channelVersion'='2','historical receipt separate';
      ${reject("attendance_operation_conflict", call(cmd(78102, "enable", { expectedLocationVersion: 2 }), { loc: other }))}
    end $checks$;reset role;
    savepoint failure;
    create function pg_temp.fail_setup_audit() returns trigger language plpgsql as $f$ begin raise exception 'synthetic_setup_audit_failure';end;$f$;
    create trigger synthetic_setup_audit_failure before insert on public.merchant_attendance_location_setup_operations for each row execute function pg_temp.fail_setup_audit();
    set local role service_role;do $checks$ begin ${reject("synthetic_setup_audit_failure", call(cmd(78105, "pause", { expectedChannelVersion: 4 })))}
      perform ${draft(78507, 2, 2, place, { ...values, latitude: 38, radiusMeters: 150 })};
      ${reject("synthetic_setup_audit_failure", call(cmd(78106, "prepare", { expectedLocationVersion: 2, expectedChannelVersion: 4, draftRevision: 3 })))}
    end $checks$;reset role;
    do $checks$ begin assert (select location_clock_enabled and location_channel_version=4 and version=1 from public.merchant_attendance_settings where merchant_id='${site}'),'channel rollback';
      assert (select version=2 and latitude=37.3 from public.merchant_attendance_locations where id='${place}'),'fence rollback';
      assert (select max(revision) from public.merchant_attendance_location_policy_drafts where location_id='${place}')=3,'rebase rollback';end $checks$;
    rollback to savepoint failure;
    set local role service_role;do $checks$ declare a jsonb;b jsonb;begin
      perform ${draft(78507, 2, 2, place, { ...values, latitude: 38, radiusMeters: 150 })};
      a:=${call(cmd(78105, "prepare", { expectedLocationVersion: 2, expectedChannelVersion: 4, draftRevision: 3 }))};
      assert a->'noticeMatches'='false'::jsonb and a->'channelEnabled'='true'::jsonb and a->>'settingsVersion'='1','only this notice invalidated';
      insert into setup_contracts values('${id(78105)}',a);
      b:=${call(null, { loc: other })};assert b->'noticeMatches'='true'::jsonb and b->'location'->>'version'='1','other place preserved';
      b:=${clock(null, "null", id(78009), id(78010))};assert b->'channelEnabled'='true'::jsonb,'other employee still ready';
      ${reject("attendance_notice_required", clock(clockCmd(78602, "clock_out", 1), "pg_temp.setup_assertion()"))}
      b:=${clock(clockCmd(78602, "clock_out", 1, true))};assert b->'receiptGate'->'safeFinish'='true'::jsonb,'safe finish after fence change';
      ${reject("attendance_invalid_request", call({ ...cmd(78999), latitude: 0 }))}
      ${reject("attendance_invalid_request", call(cmd(78999, "enable", { draftRevision: 1 })))}
      ${reject("attendance_invalid_request", call(cmd(78999, "prepare", { draftRevision: 9007199254740990 })))}
      ${reject("attendance_invalid_request", call(cmd(78999, "prepare", { expectedChannelVersion: 0 })))}
      begin perform 1 from public.merchant_attendance_location_setup_operations;raise exception 'direct audit access';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    savepoint ownership;
    update public.merchants set user_id='${id(78999)}',auth_user_id=null,owner_user_id=null,owner_id=null,auth_id=null,created_by=null,created_by_user_id=null where id='${site}';
    set local role service_role;do $checks$ declare a jsonb;begin
      ${reject("attendance_access_denied", call(null, { op: 78101 }))}
      a:=${call(null, { op: 78101, who: id(78999) })};assert a->'receipt'='null'::jsonb,'no inherited receipt';
      ${reject("attendance_operation_conflict", call(cmd(78101), { who: id(78999) }))}
    end $checks$;reset role;rollback to savepoint ownership;
    ${["anon", "authenticated"].map(r => `set local role ${r};do $checks$ begin perform ${call()};raise exception 'public RPC';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    do $checks$ begin
      begin update public.merchant_attendance_location_setup_operations set command='{}';raise exception 'rewrite';exception when insufficient_privilege then null;end;
      begin delete from public.merchant_attendance_location_setup_operations;raise exception 'delete';exception when insufficient_privilege then null;end;
      begin truncate public.merchant_attendance_location_setup_operations;raise exception 'truncate';exception when insufficient_privilege then null;end;
      assert (select count(*) from public.merchant_attendance_location_notice_acknowledgements)=2,'no automatic acknowledgements';
      assert (select count(*) from public.merchant_attendance_events where worker_id='${worker}')=2,'no unexpected punches';
    end $checks$;
    select jsonb_agg(jsonb_build_object('operationId',op,'value',value)) from setup_contracts;rollback;`);
  for (const sample of JSON.parse(output)) {
    const expected = { siteId: site, locationId: place, ownerId: owner, operationId: sample.operationId };
    const projected = parseLocationSetupResult(sample.value, expected);
    assert.deepEqual(parseLocationSetupResult(JSON.parse(JSON.stringify(projected)), expected), projected);
  }
  labels.forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2), check).catch(e => { console.error(e); process.exitCode = 1; });
