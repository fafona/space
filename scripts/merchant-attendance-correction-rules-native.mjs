// Reuse ONLY the existing owned, stopped synthetic cluster; all changes roll back.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import contract from "../src/lib/merchantAttendanceCorrection.ts";
import review from "../src/lib/merchantAttendanceCorrectionReview.ts";
import controlContract from "../src/lib/merchantAttendanceCorrectionControls.ts";
import {runAttendanceLabelsReuse} from "./merchant-attendance-choice-labels-reuse-native.mjs";
async function check({root,querySteps,pass}) {
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const site="99990009",owner=id(95001),auth=id(95002),emp=id(95003),role=id(95004),worker=id(95005),loc=id(95006);
  const day=new Date(Date.now()-2*86400000).toISOString().slice(0,10),next=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const json=x=>x===null?"null":`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
  const migration=name=>readFileSync(path.join(root,"scripts/supabase-migrations",name),"utf8").replace(/^begin;$/m,"").replace(/^commit;$/m,"");
  const proposal={startAt:`${day}T08:00:00.000000Z`,endAt:`${day}T17:00:00.000000Z`,breaks:[]};
  const base={action:"submit",operationId:id(95201),expectedRevision:0,reason:"Synthetic rule-bound declaration",startEventId:id(95101),expectedLastEventId:id(95102),proposal};
  const submit={...base,operationId:id(95203),expectedRevision:2,expectedPolicyRevision:1};
  const prepare={mode:"prepare",expectedWorkerId:worker,startEventId:id(95101)};
  const detail=(req=id(95201),op=null)=>({mode:"detail",expectedWorkerId:worker,requestId:req,operationId:op});
  const call=(q=prepare,c=null,who=auth,enabled=true,version=2)=>`public.faolla_attendance_correction_self_v${version}('${site}','${who}',${json(q)},${json(c)},${enabled})`;
  const submitCall=c=>call(detail(c.operationId),c);
  const ownerCall=req=>`public.faolla_attendance_correction_owner_review_v2('${site}','${owner}',${json({mode:"detail",requestId:req})})`;
  const controls=c=>`public.faolla_attendance_correction_controls_v2('${site}','${owner}',${json(c)},null,null,true)`;
  const policy=(revision,days)=>({action:"set_policy",operationId:id(95300+revision),expectedRevision:revision,expectedSettingsVersion:1,reason:"Synthetic policy",submissionWindowDays:days});
  const reject=(expr,code)=>`begin perform ${expr};raise exception 'unexpected acceptance ${code}';exception when sqlstate 'P0001' then if sqlerrm<>'${code}' then raise;end if;end;`;
  const out=(expr,q,kind="self")=>`insert into rule_contracts values('${kind}',${json({siteId:site,...q})},${expr});`;
  const withdraw={action:"withdraw",operationId:id(95202),requestId:base.operationId,expectedRevision:1,reason:"Synthetic withdrawal"};
  const lock={action:"lock_period",operationId:id(95401),expectedRevision:2,expectedSettingsVersion:1,reason:"Synthetic close",fromDate:day,throughDate:day};
  const output=await querySteps([`begin;set local lock_timeout='3s';set local statement_timeout='10s';
    ${["202609300070_merchant_attendance_self_session.sql","202609300081_merchant_attendance_request_permission.sql","202609300082_merchant_attendance_correction_requests.sql","202609300083_merchant_attendance_correction_owner_review.sql","202609300084_merchant_attendance_correction_controls.sql"].map(migration).join("\n")}
    insert into public.merchants(id,user_id) values('${site}','${owner}');
    insert into public.merchant_attendance_settings(merchant_id,time_zone,enabled,web_clock_enabled) values('${site}','Europe/Madrid',false,false);
    insert into public.merchant_attendance_locations(id,merchant_id,name,time_zone,active) values('${loc}','${site}','Synthetic rules','Europe/Madrid',false);
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values('${role}','${site}','Synthetic rules',array['enterprise.view','attendance.self.view','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status) values('${emp}','${site}','${auth}','rules@example.test','Synthetic rules','${role}','active');
    insert into public.merchant_attendance_workers(id,merchant_id,employee_id,worker_no,display_name,default_location_id,active) values('${worker}','${site}','${emp}','RULES','Synthetic rules','${loc}',false);
    ${[[1,"clock_in",proposal.startAt],[2,"clock_out",`${day}T16:00:00Z`],[3,"clock_in",`${next}T08:00:00Z`]].map(([n,a,t])=>`insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,occurred_at,time_zone,actor_employee_id)
      values('${id(95100+n)}','${site}','${worker}','${loc}','${id(96100+n)}',${n},'${a}','web','${t}','Europe/Madrid','${emp}');`).join("\n")}
    select ${call(detail(),base,auth,true,1)};
    ${migration("202609300085_merchant_attendance_correction_rule_binding.sql")}
    create temp table rule_contracts(kind text,query jsonb,value jsonb);grant insert,select on rule_contracts to service_role;
    create temp table rules_facts as select md5(jsonb_agg(to_jsonb(e) order by id)::text) value from public.merchant_attendance_events e;
    set local role service_role;do $checks$ declare a jsonb;begin
      a:=${call()};assert a->'rules'->'issues' ? 'policy_missing';${out(call(),prepare)}
      a:=${call(detail(),base,auth,false)};assert a->'rules'->>'binding'='legacy' and a->'receipt'->>'operationId'='${base.operationId}';
      ${out(call(detail(base.operationId,base.operationId)),detail(base.operationId,base.operationId))}
      ${reject(call(detail(),{...base,expectedPolicyRevision:1}),'attendance_operation_conflict')}
      ${reject(call(prepare,null,owner),'attendance_access_denied')}
      ${reject(call({...prepare,expectedWorkerId:id(99999)}),'attendance_worker_changed')}
      perform ${call(detail(),withdraw,auth,false)};
      ${reject(submitCall(submit),'attendance_correction_policy_required')}
    end $checks$;reset role;
    do $checks$ begin assert (select count(*) from public.merchant_attendance_correction_entries where merchant_id='${site}')=2,'rejected insert rolled back';
      assert not exists(select 1 from public.merchant_attendance_correction_rule_bindings),'no partial binding';end $checks$;
    set local role service_role;do $checks$ declare a jsonb;begin
      perform ${controls(policy(0,7))};${out(call(),prepare)}${out(controls(null),{operationId:null,beforeRevision:null},"controls")}
      ${reject(submitCall({...submit,expectedPolicyRevision:2}),'attendance_correction_policy_changed')}
      ${reject(submitCall({...base,operationId:submit.operationId,expectedRevision:2}),'attendance_correction_policy_required')}
      a:=${submitCall(submit)};assert a->'rules'->>'binding'='bound' and a->'rules'->'policy'->'revision'='1'::jsonb;
      ${out(call(detail(submit.operationId,submit.operationId)),detail(submit.operationId,submit.operationId))}
      perform ${controls(policy(1,0))};
      a:=${call(detail(submit.operationId),submit,auth,false)};assert a->'rules'->'policy'->'revision'='1'::jsonb and a->'rules'->'issues'='[]'::jsonb,'later shortening does not expire old receipt';
      ${reject(submitCall({...submit,expectedPolicyRevision:2}),'attendance_operation_conflict')}
      ${out(ownerCall(submit.operationId),{mode:"detail",requestId:submit.operationId},"owner")}
      ${out(ownerCall(base.operationId),{mode:"detail",requestId:base.operationId},"owner")}
      perform ${controls(lock)};
      a:=${call(detail(submit.operationId),submit,auth,false)};assert a->'rules'->'issues' ? 'period_locked' and a->'receipt'->>'operationId'='${submit.operationId}';
      ${out(call(detail(submit.operationId,submit.operationId)),detail(submit.operationId,submit.operationId))}
      ${out(ownerCall(submit.operationId),{mode:"detail",requestId:submit.operationId},"owner")}
      perform ${call(detail(submit.operationId),{...withdraw,operationId:id(95204),requestId:submit.operationId,expectedRevision:3},auth,false)};
      ${reject(submitCall({...submit,operationId:id(95205),expectedRevision:4,expectedPolicyRevision:2}),'attendance_correction_window_expired')}
      perform ${controls(policy(3,7))};
      ${reject(submitCall({...submit,operationId:id(95205),expectedRevision:4,expectedPolicyRevision:4,proposal:{...proposal,startAt:`${next}T08:00:00.000000Z`,endAt:`${next}T17:00:00.000000Z`}}),'attendance_correction_period_locked')}
      ${reject(submitCall({...submit,operationId:id(95206),expectedRevision:0,expectedPolicyRevision:4,startEventId:id(95103),expectedLastEventId:id(95103)}),'attendance_correction_period_locked')}
      perform ${controls({action:"unlock_period",operationId:id(95402),expectedRevision:4,expectedSettingsVersion:1,reason:"Synthetic reopen",periodId:lock.operationId})};
      a:=${submitCall({...submit,operationId:id(95206),expectedRevision:0,expectedPolicyRevision:4,startEventId:id(95103),expectedLastEventId:id(95103),proposal:{...proposal,startAt:`${next}T08:00:00.000000Z`,endAt:`${next}T17:00:00.000000Z`}})};
      assert a->'rules'->'issues'='[]'::jsonb,'missing checkout can be declared but not approved';
      ${out(call(detail(id(95206),id(95206))),detail(id(95206),id(95206)))}
      ${reject(call({...prepare,siteId:'99990008'}),'attendance_invalid_request')}
      begin perform ${call(detail(),base,auth,true,1)};raise exception 'v1 write bypass';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_correction_owner_review_v1('${site}','${owner}',${json({mode:"detail",requestId:base.operationId})});raise exception 'v1 read bypass';exception when insufficient_privilege then null;end;
      begin perform public.faolla_attendance_correction_rules_v1('${site}',a);raise exception 'helper exposure';exception when insufficient_privilege then null;end;
      begin select count(*) from public.merchant_attendance_correction_rule_bindings;raise exception 'table exposure';exception when insufficient_privilege then null;end;
    end $checks$;reset role;`,
    `do $checks$ begin
      assert (select count(*) from public.merchant_attendance_correction_rule_bindings)=2,'only confirmed new submissions bind';
      assert (select count(*) from public.merchant_attendance_correction_entries where merchant_id='${site}')=5,'no failed append survived';
      assert (select value from rules_facts)=(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.merchant_attendance_events e),'raw facts unchanged';
      begin update public.merchant_attendance_correction_rule_bindings set command='{}';raise exception 'binding mutable';exception when insufficient_privilege then if sqlerrm<>'attendance_events_append_only' then raise;end if;end;
    end $checks$;
    ${['anon','authenticated'].map(w=>`set local role ${w};do $checks$ begin perform ${call()};raise exception 'public rpc';exception when insufficient_privilege then null;end $checks$;reset role;`).join("\n")}
    select 'contracts:'||jsonb_agg(jsonb_build_object('kind',kind,'query',query,'value',value))::text from rule_contracts;
    rollback;`]);
  const line=output.split("\n").find(s=>s.startsWith("contracts:"));assert.ok(line);
  for(const {kind,query,value} of JSON.parse(line.slice(10))) {
    if(kind==="self")contract.parseCorrectionResult(value,query,true);else if(kind==="controls")controlContract.parseCorrectionControlResult(value,query,true);else review.parseCorrectionReviewResult(value,query,true);
    assert.doesNotMatch(JSON.stringify(value),new RegExp(`${auth}|${owner}|Synthetic close`));
  }
  ["legacy receipt replay/withdrawal remains available; no retroactive binding",
    "missing/changed policy rejects and rolls back both ledger and binding",
    "new submission binds exact policy and full immutable command",
    "later shortening, locking and pause cannot erase committed receipts",
    "deadline anchored to original date, not moved declaration",
    "original and proposed lock ranges both enforced; unlock permits explicit new operation",
    "open shift declaration still allowed without closing raw facts",
    "owner review reads pinned policy and current locks but cannot approve",
    "v1 bypass, direct tables and internal helpers denied; binding append-only",
    "real SQL responses pass strict live parsers; all changes roll back"].forEach(pass);
}
await runAttendanceLabelsReuse(process.argv.slice(2),check).catch(e=>{console.error(e);process.exitCode=1;});
