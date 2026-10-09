import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import controls from "../src/lib/merchantAttendanceCorrectionControls.ts";
import { runAttendanceLabelsReuse } from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({ root, querySteps, pass }) {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site = "99990009", owner = id(91001), other = id(91002), policyId = id(91201), lockId = id(91202);
  const json = v => `'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
  const policy = { action: "set_policy", operationId: policyId, expectedRevision: 0, expectedSettingsVersion: 1, reason: "Synthetic policy", submissionWindowDays: 7 };
  const lock = { action: "lock_period", operationId: lockId, expectedRevision: 1, expectedSettingsVersion: 1, reason: "Synthetic close period", fromDate: "2026-03-28", throughDate: "2026-03-29" };
  const unlock = { action: "unlock_period", operationId: id(91203), expectedRevision: 2, expectedSettingsVersion: 1, reason: "Synthetic reopen reason", periodId: lockId };
  const call = (c = null, op = null, before = null, who = owner, allow = true, tenant = site) => `public.faolla_attendance_correction_controls_v1('${tenant}','${who}',${c ? json(c) : "null"},${op ? `'${op}'` : "null"},${before ?? "null"},${allow})`;
  const reject = (expr, code) => `begin perform ${expr};raise exception 'unexpected controls acceptance';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const out = (expr, op = null, before = null) => `insert into controls_contracts values(${json({ siteId: site, operationId: op, beforeRevision: before })},${expr});`;
  const migration = readFileSync(path.join(root,"scripts/supabase-migrations/202609300084_merchant_attendance_correction_controls.sql"),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const result = await querySteps([`begin;set local statement_timeout='10s';set local lock_timeout='3s';${migration}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',false,false);
    create temp table controls_contracts(query jsonb,value jsonb);grant insert,select on controls_contracts to service_role;
    create temp table controls_original as select (select md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'')) from public.merchant_attendance_events e) facts,
      (select md5(jsonb_agg(to_jsonb(s) order by merchant_id)::text) from public.merchant_attendance_settings s) settings;
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call()};assert a->'revision'='0'::jsonb and a->'policy'='null'::jsonb and a->'activePeriods'='[]'::jsonb;
      ${out(call())}
      ${reject(call(null,null,null,other),'attendance_access_denied')}
      ${reject(call(null,null,null,owner,true,'99990007'),'attendance_access_denied')}
      ${reject(call(policy,null,null,owner,false),'attendance_platform_paused')}
      ${reject(call({...policy,actor:other}),'attendance_invalid_request')}
      ${reject(call({...policy,submissionWindowDays:366}),'attendance_invalid_request')}
      ${reject(call({...policy,reason:""}),'attendance_invalid_request')}
      ${out(call(policy),policyId)}
      a:=${call(policy,null,null,owner,false)};assert a->'revision'='1'::jsonb;
      ${reject(call({...policy,submissionWindowDays:8}),'attendance_operation_conflict')}
      ${reject(call({...policy,operationId:id(91301)}),'attendance_version_conflict')}
      ${out(call(lock),lockId)}
      a:=${call()};assert a->'activePeriods'->0->>'startAt'='2026-03-27T23:00:00.000000Z';assert a->'activePeriods'->0->>'endAt'='2026-03-29T22:00:00.000000Z';
      ${reject(call({...lock,operationId:id(91302),expectedRevision:2}),'attendance_period_overlap')}
      ${reject(call({...lock,operationId:id(91303),expectedRevision:2,fromDate:"2099-01-01",throughDate:"2099-01-02"}),'attendance_period_future')}
      ${reject(call({...lock,operationId:id(91303),expectedRevision:2,fromDate:"2026-02-30"}),'attendance_invalid_date')}
      ${reject(call({...unlock,periodId:id(99999)}),'attendance_period_not_locked')}
      ${out(call(unlock),unlock.operationId)}
      a:=${call()};assert a->'activePeriods'='[]'::jsonb;
      ${out(call(lock),lockId)}
      a:=${call(lock)};assert a->'receipt'->'revision'='2'::jsonb and a->'revision'='3'::jsonb and a->'activePeriods'='[]'::jsonb,'replay cannot relock';
      ${reject(call({...unlock,operationId:id(91304),expectedRevision:3}),'attendance_period_not_locked')}
    end $checks$;reset role;
    savepoint timezone_change;update public.merchant_attendance_settings set time_zone='America/Havana',version=2 where merchant_id='${site}';
    set local role service_role;do $checks$ begin ${reject(call({...policy,operationId:id(91305),expectedRevision:3}),'attendance_version_conflict')}
      ${out(call({...lock,operationId:id(91306),expectedRevision:3,expectedSettingsVersion:2,fromDate:"2025-11-02",throughDate:"2025-11-02"}),id(91306))}
    end $checks$;reset role;
    select 'scenario:'||jsonb_agg(jsonb_build_object('query',query,'value',value))::text from controls_contracts where value->'receipt'->>'operationId'='${id(91306)}';rollback to savepoint timezone_change;
    savepoint skipped;update public.merchant_attendance_settings set time_zone='Pacific/Apia',version=2 where merchant_id='${site}';set local role service_role;
    do $checks$ begin
      ${reject(call({...lock,operationId:id(91307),expectedRevision:3,expectedSettingsVersion:2,fromDate:"2011-12-30",throughDate:"2011-12-30"}),'attendance_local_date_does_not_exist')}
      ${out(call({...lock,operationId:id(91308),expectedRevision:3,expectedSettingsVersion:2,fromDate:"2011-12-29",throughDate:"2011-12-31"}),id(91308))}
    end $checks$;reset role;select 'scenario:'||jsonb_agg(jsonb_build_object('query',query,'value',value))::text from controls_contracts where value->'receipt'->>'operationId'='${id(91308)}';rollback to savepoint skipped;
    savepoint owner_change;update public.merchants set user_id='${other}' where id='${site}';set local role service_role;do $checks$ declare a jsonb;begin
      ${reject(call(),'attendance_access_denied')}
      a:=${call(null,policyId,null,other)};assert a->'receipt'='null'::jsonb;
      ${reject(call(policy,null,null,other),'attendance_operation_conflict')}
    end $checks$;reset role;rollback to savepoint owner_change;`,
    `set local role service_role;do $checks$ declare i integer;c jsonb;a jsonb;begin
      for i in 4..30 loop c:=${json(policy)}||jsonb_build_object('operationId',('00000000-0000-4000-8000-'||lpad((92000+i)::text,12,'0'))::uuid,'expectedRevision',i-1,'submissionWindowDays',i);
        perform public.faolla_attendance_correction_controls_v1('${site}','${owner}',c,null,null,true);end loop;
      a:=${call()};assert jsonb_array_length(a->'entries')=25 and a->'nextBeforeRevision'='6'::jsonb;
      ${out(call())}${out(call(null,null,6),null,6)}${out(call(null,policyId),policyId)}
      a:=${call(null,null,6)};assert jsonb_array_length(a->'entries')=5 and a->'nextBeforeRevision'='null'::jsonb;
      begin perform 1 from public.merchant_attendance_correction_controls;raise exception 'direct ledger read';exception when insufficient_privilege then null;end;
      begin update public.merchant_attendance_correction_periods set locked=true;raise exception 'direct state write';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_control_day_boundary_v1('2026-01-01','UTC');raise exception 'public helper';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_correction_control_check_v1('${site}',now(),null,now()-interval '1 hour',now(),now());raise exception 'public precheck';exception when insufficient_privilege then null;end;
    end $checks$;reset role;
    ${['anon','authenticated'].map(r=>`set local role ${r};do $checks$ begin perform ${call()};raise exception 'public RPC';exception when insufficient_privilege then null;end $checks$;reset role;`).join('\n')}
    do $checks$ declare a jsonb;submitted timestamptz;raw_start timestamptz;expected_deadline timestamptz;begin
      begin update public.merchant_attendance_correction_controls set reason='rewrite';raise exception 'append guard missing';exception when others then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;
      assert (select facts from controls_original)=(select md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'')) from public.merchant_attendance_events e),'raw unchanged';
      assert (select settings from controls_original)=(select md5(jsonb_agg(to_jsonb(s) order by merchant_id)::text) from public.merchant_attendance_settings s),'settings unchanged';
      select recorded_at into submitted from public.merchant_attendance_correction_controls where merchant_id='${site}' and revision=1;
      raw_start:=(date_trunc('day',submitted at time zone 'UTC') at time zone 'UTC')-interval '2 days'+interval '8 hours';
      a:=public.faolla_attendance_correction_control_check_v1('${site}',raw_start,raw_start+interval '8 hours',raw_start,raw_start+interval '9 hours',submitted);
      assert a->'policyRevision'='1'::jsonb and a->'issues'='[]'::jsonb and a->'approvalAvailable'='false'::jsonb,'policy pinned to submission instant';
      expected_deadline:=(((raw_start at time zone 'Europe/Madrid')::date+8)::timestamp at time zone 'Europe/Madrid');
      assert (a->>'deadlineAt')::timestamptz=expected_deadline,'natural date deadline';
      a:=public.faolla_attendance_correction_control_check_v1('${site}',raw_start-interval '30 days',raw_start-interval '29 days',raw_start,raw_start+interval '9 hours',submitted);
      assert a->'issues' ? 'submission_window_expired','proposal cannot move deadline anchor';
      a:=public.faolla_attendance_correction_control_check_v1('${site}',raw_start,null,raw_start,raw_start+interval '9 hours',submitted-interval '1 second');
      assert a->'issues' ? 'policy_missing_at_submission' and a->'issues' ? 'original_session_open','old requests are not retroactively assigned a policy';
      expected_deadline:=(((raw_start at time zone 'Europe/Madrid')::date+31)::timestamp at time zone 'Europe/Madrid');
      a:=public.faolla_attendance_correction_control_check_v1('${site}',raw_start,raw_start+interval '8 hours',raw_start,raw_start+interval '9 hours',expected_deadline-interval '1 microsecond');
      assert not(a->'issues' ? 'submission_window_expired'),'one microsecond before deadline allowed';
      a:=public.faolla_attendance_correction_control_check_v1('${site}',raw_start,raw_start+interval '8 hours',raw_start,raw_start+interval '9 hours',expected_deadline);
      assert a->'issues' ? 'submission_window_expired','exact deadline expires';
    end $checks$;
    savepoint active_guard;
    set local role service_role;select ${call({...lock,operationId:id(94000),expectedRevision:30,fromDate:'2026-09-28',throughDate:'2026-09-28'})};reset role;
    do $checks$ declare a jsonb;begin
      a:=public.faolla_attendance_correction_control_check_v1('${site}','2026-09-28T08:00:00Z','2026-09-28T16:00:00Z','2026-09-29T08:00:00Z','2026-09-29T17:00:00Z',clock_timestamp());
      assert a->'issues' ? 'period_locked','moving proposal outside locked period cannot bypass original evidence';
      a:=public.faolla_attendance_correction_control_check_v1('${site}','2026-09-29T08:00:00Z','2026-09-29T16:00:00Z','2026-09-28T08:00:00Z','2026-09-28T17:00:00Z',clock_timestamp());
      assert a->'issues' ? 'period_locked','moving proposal into locked period also blocked';
      a:=public.faolla_attendance_correction_control_check_v1('${site}','2026-09-28T22:00:00Z','2026-09-28T23:00:00Z','2026-09-28T22:00:00Z','2026-09-28T23:00:00Z',clock_timestamp());
      assert not(a->'issues' ? 'period_locked'),'half-open endpoints may touch';
      a:=public.faolla_attendance_correction_control_check_v1('${site}','2026-09-27T22:00:00Z','2026-09-27T22:00:00Z','2026-09-29T08:00:00Z','2026-09-29T17:00:00Z',clock_timestamp());
      assert a->'issues' ? 'period_locked','zero-duration raw anchor is still protected';
    end $checks$;
    rollback to savepoint active_guard;
    select 'result:'||jsonb_agg(jsonb_build_object('query',query,'value',value))::text from controls_contracts;rollback;`]);
  let count=0;for(const line of result.split(/\r?\n/).filter(l=>l.startsWith('scenario:')||l.startsWith('result:'))) for(const row of JSON.parse(line.slice(line.indexOf(':')+1))) {
    const r=controls.parseCorrectionControlResult(row.value,row.query);assert.equal(r.rulesEnforced,false);assert.equal(r.approvalAvailable,false);count++;
  }
  assert.ok(count>=10);
  ["current owner and tenant authorization; no default policy", "policy/lock/unlock append audited revisions without altering raw facts/settings",
    "exact replay works while paused; lost old lock receipt cannot relock after unlock", "stale revision/settings and same operation conflicts reject",
    "overlapping/future/invalid periods and absent unlock reject", "DST repeated midnight, skipped-day boundaries agree with TypeScript",
    "owner transfer denies old owner and hides prior-owner receipt", "30 audit entries page 25/5; original receipt survives policy changes",
    "direct table/helper access denied and audit append-only", "policy at submission is not changed retroactively; raw start anchors deadline",
    "period precheck protects both original and proposed instants, including zero-duration raw anchor",
    "actual SQL response parses; all schema/data rolled back"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
